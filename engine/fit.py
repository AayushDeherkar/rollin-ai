"""
Rollin' fit engine: can a specific wheelchair reach every room of a Matterport model?

Usage:
    (keys come from .env; live fetches are cached in data/cache/<sid>.json)
    python fit.py redacted-unit-03              # default chair 27 x 42 in
    python fit.py redacted-unit-03 25 40        # chair width, length in inches
    python fit.py --file model.json        # run on a saved API response
    python fit.py --file model.json --hinges   # what-if: offset hinges on every door

Outputs (in ./out/):
    <id>_fit.json  per-room verdicts, door widths, turning space, chair paths (for the UI animation)
    <id>_fit.png   floor plan: reachable area green, blocked rooms red, unknown rooms grey, paths blue

Method (state these on stage):
  * Walls and doors come from Matterport's wall graph (floors.edges, openings.width).
  * Clear width = opening width minus 5 cm for door leaf and stop (an ESTIMATE).
  * The chair is a rectangle; we search over (x, y, heading) on a 5 cm grid, 16 headings.
    Turning in place between adjacent headings is approximated (no sweep check).
  * Rooms with no measured door are UNKNOWN, never failed.
  * Fixtures (toilet, vanity, tub) are not in the wall graph; the vision pass on defurnished
    panoramas adds them later. Turning space here is walls-only.
"""
import os, sys, json, math
from collections import deque

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, Polygon, MultiPolygon
from shapely.ops import polygonize, unary_union

RES = 0.05            # metres per grid cell
N_HEAD = 16           # headings over [0, pi): a rectangle is symmetric front/back
DOOR_STOP = 0.05      # metres lost to door leaf + stop (estimate)
TURN_DIAM_IN = 60.0   # ADA turning circle, inches
IN = 0.0254
HINGE_GAIN = 1.75 * IN        # offset (swing-clear) hinges recover roughly 1.5-2 in of clear width
MIN_REAL_OPENING = 18 * IN   # narrower "openings" are treated as scan artifacts


def fetch(model_id):
    """Live or cached model via the split-query client (engine/matterport.py)."""
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from engine.matterport import get_model
    return get_model(model_id)


def rect_kernel(w, l, th):
    """Boolean footprint of a w x l rectangle rotated by th, on the grid (rows go down)."""
    n = int(math.ceil(math.hypot(w, l) / 2 / RES))
    rows, cols = np.mgrid[-n:n + 1, -n:n + 1]
    X, Y = cols * RES, -rows * RES
    u = X * math.cos(th) + Y * math.sin(th)
    v = -X * math.sin(th) + Y * math.cos(th)
    return (np.abs(u) <= l / 2) & (np.abs(v) <= w / 2)


class Grid:
    def __init__(self, geom, margin=0.5):
        minx, miny, maxx, maxy = geom.bounds
        self.minx, self.maxy = minx - margin, maxy + margin
        self.W = int((maxx + margin - self.minx) / RES) + 1
        self.H = int((self.maxy - (miny - margin)) / RES) + 1

    def to_px(self, x, y):           # (col, row) floats
        return ((x - self.minx) / RES, (self.maxy - y) / RES)

    def to_rc(self, x, y):
        c, r = self.to_px(x, y)
        return int(round(r)), int(round(c))

    def to_xy(self, r, c):
        return (self.minx + c * RES, self.maxy - r * RES)

    def raster(self, geom):
        img = Image.new("L", (self.W, self.H), 0)
        d = ImageDraw.Draw(img)
        for g in getattr(geom, "geoms", [geom]):
            if g.is_empty or not isinstance(g, Polygon):
                continue
            d.polygon([self.to_px(*p) for p in g.exterior.coords], fill=1)
            for h in g.interiors:
                d.polygon([self.to_px(*p) for p in h.coords], fill=0)
        return np.array(img, dtype=bool)


def analyze_floor(floor, room_list, chair_w, chair_l, hinges=False):
    V = {v["id"]: np.array([v["position"]["x"], v["position"]["y"]], float) for v in floor["vertices"]}
    E = {e["id"]: e for e in floor["edges"]}

    def seg(e):
        a, b = (V[v["id"]] for v in e["vertices"])
        return a, b

    # Openings, located along their wall edge.
    openings, artifacts = [], []
    for e in floor["edges"]:
        a, b = seg(e)
        L = float(np.linalg.norm(b - a)) or 1e-9
        for o in e.get("openings") or []:
            rc, w = o["relativeCenter"], o["width"]
            if w < MIN_REAL_OPENING:      # scan artifact (seen: 1", 8"); flagged, not used
                artifacts.append({"edge": e["id"], "width_in": round(w / IN, 1)})
                continue
            openings.append({
                "edge": e["id"], "type": o["type"], "width_m": w,
                "clear_m": w - DOOR_STOP + (HINGE_GAIN if hinges else 0),
                "center": (a + (b - a) * rc).tolist(),
                "t0": max(0.0, rc - w / 2 / L), "t1": min(1.0, rc + w / 2 / L),
            })

    # Rooms (Void dropped), polygons from their boundary edges.
    rooms, edge_rooms = [], {}
    for r in room_list:
        label = (r.get("classifications") or [{"label": "unlabelled"}])[0]["label"]
        if label == "Void":
            continue
        ids = [x["id"] for x in (r.get("boundary") or {}).get("edges", []) if x["id"] in E]
        polys = list(polygonize([LineString(seg(E[i])) for i in ids]))
        if not polys:
            continue
        for i in ids:
            edge_rooms.setdefault(i, []).append(r["id"])
        rooms.append({"id": r["id"], "label": label, "poly": unary_union(polys), "edges": set(ids),
                      "area_m2": (r.get("dimensions") or {}).get("areaFloor")})
    if not rooms:
        return {"floor": floor.get("label") or floor["id"], "rooms": [], "note": "no rooms with boundaries"}

    # Walls with door gaps cut out. A door is only cut open if its exact measured clear width
    # fits the chair: the 5 cm grid alone cannot resolve a 1-inch shortfall.
    for o in openings:
        o["passable"] = o["clear_m"] >= chair_w
    walls = []
    for e in floor["edges"]:
        if e["type"] != "wall":
            continue                      # 'invisible' edges are open passages
        a, b = seg(e)
        t = 0.0
        for t0, t1 in sorted((o["t0"], o["t1"]) for o in openings
                             if o["edge"] == e["id"] and o["passable"]) + [(1.0, 1.0)]:
            if t0 > t + 1e-6:
                walls.append(LineString([a + (b - a) * t, a + (b - a) * t0])
                             .buffer(max(e.get("thickness") or 0.1, 0.08) / 2, cap_style=2))
            t = max(t, t1)
    wall_geom = unary_union(walls)
    inside = unary_union([rm["poly"] for rm in rooms]).buffer(0.02)
    free_geom = inside.difference(wall_geom)

    g = Grid(inside)
    free = g.raster(free_geom)
    room_mask = {rm["id"]: g.raster(rm["poly"]) for rm in rooms}

    # Configuration space: where the chair centre can sit at each heading.
    occ = ~free
    CF = np.stack([~ndimage.binary_dilation(occ, structure=rect_kernel(chair_w, chair_l, math.pi * k / N_HEAD))
                   for k in range(N_HEAD)])

    # Start: inside the room behind an exterior door (an opening on an edge only one room owns).
    room_ids = {rm["id"] for rm in rooms}
    start_room, anchor = None, None
    for o in openings:
        owners = [x for x in edge_rooms.get(o["edge"], []) if x in room_ids]
        if len(owners) == 1:
            start_room, anchor = owners[0], o["center"]
            break
    if start_room is None:                # fallback: largest room
        big = max(rooms, key=lambda rm: rm["poly"].area)
        start_room = big["id"]
        anchor = list(big["poly"].representative_point().coords[0])
    cand = np.argwhere(CF.any(0) & room_mask[start_room])
    no_start = not len(cand)              # chair fits nowhere in the start room: every room is blocked

    # BFS over (heading, row, col).
    K, H, W = CF.shape
    seen = np.zeros(CF.shape, bool)
    prev = np.full(CF.shape, -1, np.int64)
    q = deque()
    if not no_start:
        ar = np.array(g.to_rc(*anchor))
        sr, sc = cand[np.argmin(((cand - ar) ** 2).sum(1))]
        start = (int(np.argmax(CF[:, sr, sc])), int(sr), int(sc))
        seen[start] = True
        q.append(start)
    steps = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    while q:
        k, r, c = q.popleft()
        here = (k * H + r) * W + c
        for s in [(k, r + dr, c + dc) for dr, dc in steps] + [((k + 1) % K, r, c), ((k - 1) % K, r, c)]:
            kk, rr, cc = s
            if 0 <= rr < H and 0 <= cc < W and CF[s] and not seen[s]:
                seen[s] = True
                prev[s] = here
                q.append(s)
    reach = seen.any(0)

    def path_to(mask, target_xy):
        cells = np.argwhere(seen & mask[None])
        if not len(cells):
            return None
        tr, tc = g.to_rc(*target_xy)
        k, r, c = cells[np.argmin((cells[:, 1] - tr) ** 2 + (cells[:, 2] - tc) ** 2)]
        out, idx = [], (k * H + r) * W + c
        while idx >= 0:
            k, rem = divmod(idx, H * W)
            r, c = divmod(rem, W)
            x, y = g.to_xy(r, c)
            out.append([round(x, 3), round(y, 3), round(math.pi * k / N_HEAD, 3)])
            idx = prev[k, r, c]
        out.reverse()
        return out[::3] + [out[-1]]       # thin for the UI

    reached = {rm["id"]: bool((reach & room_mask[rm["id"]]).any()) for rm in rooms}
    label_of = {rm["id"]: rm["label"] for rm in rooms}

    def other_side(o, rid):
        return [x for x in edge_rooms.get(o["edge"], []) if x in room_ids and x != rid]

    by_id = {rm["id"]: rm for rm in rooms}

    def blocking_door(rid):
        """Nearest door (by rooms crossed) where the chair stops on its way to room `rid`.
        Returns (opening, reached room on the near side) or (None, None)."""
        seen_r, q = {rid}, deque([rid])
        while q:
            cur = q.popleft()
            ds = [o for o in openings if o["edge"] in by_id[cur]["edges"]]
            front = [(o, x) for o in ds for x in other_side(o, cur) if reached[x]]
            if front:
                return max(front, key=lambda ox: ox[0]["clear_m"])
            for o in ds:
                for x in other_side(o, cur):
                    if x not in seen_r:
                        seen_r.add(x)
                        q.append(x)
        return None, None

    results = []
    for rm in rooms:
        doors = [o for o in openings if o["edge"] in rm["edges"]]
        open_edge = any(E[i]["type"] != "wall" for i in rm["edges"])
        ok = reached[rm["id"]]
        suspect = [a for a in artifacts if a["edge"] in rm["edges"]]
        if ok:
            status, reason = "reachable", None
        elif no_start and rm["id"] == start_room:
            status, reason = "blocked", "the chair does not fit anywhere in this room (the start room)"
        elif not doors and not open_edge:
            status, reason = "unknown", ("only a suspect scan opening (" + ", ".join(f'{a["width_in"]}"' for a in suspect)
                                         + "); verify in the 3D tour" if suspect else
                                         "no door measured in the scan; ask the landlord")
        else:
            status = "blocked"
            # Only doors the chair could arrive at count: from a reached room first, else from outside the unit.
            inside = [o for o in doors if any(reached[x] for x in other_side(o, rm["id"]))]
            outside = [o for o in doors if not other_side(o, rm["id"])]
            entry = inside or outside
            best = max(entry, key=lambda o: o["clear_m"]) if entry else None
            frm = (", ".join(label_of[x] for x in other_side(best, rm["id"])) or "outside the unit") if best else ""
            if best and best["clear_m"] < chair_w:
                short = (chair_w - best["clear_m"]) / IN
                reason = (f"widest way in (door from {frm}) ~{best['clear_m']/IN:.1f} in clear < chair "
                          f"{chair_w/IN:.1f} in (short by {short:.1f} in)")
                if short <= HINGE_GAIN / IN and not hinges:
                    reason += f"; offset hinges (+~{HINGE_GAIN/IN:.2g} in) could fix it - rerun with --hinges"
            elif best and inside:
                reason = f"the door from {frm} fits, but the route to it is too tight to turn into"
            elif best:
                reason = "only a door from outside the unit fits; not reachable from the scanned entry"
            elif doors:
                via = sorted({label_of[x] for o in doors for x in other_side(o, rm["id"])})
                reason = f"every door leads from a room the chair can't reach ({', '.join(via)})"
            else:
                reason = "only reachable through an open passage that is too tight"
        turn = None
        if rm["label"].lower() == "bathroom":
            dt = ndimage.distance_transform_edt(free & room_mask[rm["id"]]) * RES
            d_in = 2 * float(dt.max()) / IN
            tr, tc = np.unravel_index(int(np.argmax(dt)), dt.shape)
            tx, ty = g.to_xy(int(tr), int(tc))
            turn = {"max_circle_in": round(d_in, 1), "meets_60in": d_in >= TURN_DIAM_IN, "walls_only": True,
                    "center": [round(tx, 3), round(ty, 3)]}
        centre = list(rm["poly"].representative_point().coords[0])
        stop_door, stop_room = blocking_door(rm["id"]) if status == "blocked" else (None, None)
        if ok:
            path = path_to(room_mask[rm["id"]], centre)
        elif stop_door is not None:           # drive up to the door that stops the chair
            path = path_to(room_mask[stop_room], stop_door["center"])
        else:
            path = None
        results.append({
            "room_id": rm["id"], "label": rm["label"], "area_m2": rm["area_m2"],
            "status": status, "reason": reason,
            "doors": [{"type": o["type"], "width_in": round(o["width_m"] / IN, 1),
                       "clear_in_est": round(o["clear_m"] / IN, 1), "center": o["center"]} for o in doors],
            "turning_space": turn,
            "path": path,
            "blocking_door_edge": stop_door["edge"] if stop_door is not None else None,
            "polygon": [list(p) for p in rm["poly"].exterior.coords] if isinstance(rm["poly"], Polygon) else None,
        })

    wall_segments = []
    for e in floor["edges"]:
        a, b = seg(e)
        wall_segments.append({"edge": e["id"], "type": e["type"], "thickness": e.get("thickness"),
                              "a": [round(float(a[0]), 3), round(float(a[1]), 3)],
                              "b": [round(float(b[0]), 3), round(float(b[1]), 3)]})
    door_list = [{"edge": o["edge"], "type": o["type"], "width_in": round(o["width_m"] / IN, 1),
                  "clear_in_est": round(o["clear_m"] / IN, 1), "passable": o["passable"],
                  "center": [round(c, 3) for c in o["center"]]} for o in openings]
    return {"floor": floor.get("label") or floor["id"], "start_room": start_room,
            "walls": wall_segments, "doors": door_list, "artifacts": artifacts,
            "openings_found": len(openings), "artifacts_ignored": len(artifacts), "rooms": results,
            "_draw": (g, free, reach, wall_geom, rooms, openings)}


def render(floor_res, path_png, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    g, free, reach, wall_geom, rooms, openings = floor_res["_draw"]
    fig, ax = plt.subplots(figsize=(9, 9))
    ext = [g.minx, g.minx + g.W * RES, g.maxy - g.H * RES, g.maxy]
    colour = {"reachable": "#cdeccd", "blocked": "#f6c3c3", "unknown": "#e3e3e3"}
    by_id = {r["room_id"]: r for r in floor_res["rooms"]}
    for rm in rooms:
        res = by_id[rm["id"]]
        for p in getattr(rm["poly"], "geoms", [rm["poly"]]):
            ax.fill(*p.exterior.xy, color=colour[res["status"]], zorder=1)
        x, y = rm["poly"].representative_point().coords[0]
        ax.text(x, y, f"{rm['label']}\n{res['status']}", ha="center", va="center", fontsize=8, zorder=5)
    ax.imshow(np.ma.masked_where(~reach, reach), extent=ext, cmap="Greens", alpha=0.35, vmin=0, vmax=1, zorder=2)
    from matplotlib.colors import ListedColormap
    wall_mask = g.raster(wall_geom)       # raster keeps holes (enclosed rooms) open
    ax.imshow(np.ma.masked_where(~wall_mask, wall_mask), extent=ext,
              cmap=ListedColormap(["#333333"]), vmin=0, vmax=1, zorder=3)
    for o in openings:
        col = "orange" if o.get("passable", True) else "red"
        ax.plot(*o["center"], "o", color=col, zorder=4)
        ax.annotate(f"{o['width_m']/IN:.0f}\"", o["center"], fontsize=8, color=col, zorder=6)
    for res in floor_res["rooms"]:
        if res["path"]:
            p = np.array(res["path"])
            ax.plot(p[:, 0], p[:, 1], "-", color="#1f5fbf", lw=1.5, zorder=4)
    ax.set_aspect("equal")
    ax.set_title(title)
    ax.axis("off")
    fig.savefig(path_png, dpi=130, bbox_inches="tight")
    plt.close(fig)


def analyze_model(model: dict, mid: str, chair_w_in: float = 27.0, chair_l_in: float = 42.0,
                  hinges: bool = False, render_dir: str | None = None) -> dict:
    """Engine result for one model (contract: contracts/unit_result.example.json). PNGs only if render_dir."""
    chair_w, chair_l = chair_w_in * IN, chair_l_in * IN
    by_floor = {}
    for r in model.get("rooms", []):
        by_floor.setdefault((r.get("floor") or {}).get("id"), []).append(r)
    tag = "_hinges" if hinges else ""
    report = {"model": mid, "name": model.get("name"), "chair_in": [chair_w_in, chair_l_in],
              "scenario": "offset hinges on every door" if hinges else "as scanned", "floors": []}
    for i, f in enumerate(model["floors"]):
        res = analyze_floor(f, by_floor.get(f["id"], []) or (by_floor.get(None, []) if len(model["floors"]) == 1 else []),
                            chair_w, chair_l, hinges)
        draw = res.pop("_draw", None)
        if draw and render_dir:
            os.makedirs(render_dir, exist_ok=True)
            render({**res, "_draw": draw}, os.path.join(render_dir, f"{mid}_floor{i}_fit{tag}.png"),
                   f"{model.get('name')} - chair {chair_w_in:.0f}x{chair_l_in:.0f} in" + (" - with offset hinges" if hinges else ""))
        report["floors"].append(res)
    return report


def main(argv):
    hinges = "--hinges" in argv
    argv = [a for a in argv if a != "--hinges"]
    if argv and argv[0] == "--file":
        data = json.load(open(argv[1]))
        model = data.get("data", data).get("model", data)
        mid = os.path.splitext(os.path.basename(argv[1]))[0]
        rest = argv[2:]
    else:
        mid = argv[0]
        model = fetch(mid)
        rest = argv[1:]
    chair_w = float(rest[0]) * IN if len(rest) > 0 else 27 * IN
    chair_l = float(rest[1]) * IN if len(rest) > 1 else 42 * IN

    tag = "_hinges" if hinges else ""
    report = analyze_model(model, mid, chair_w / IN, chair_l / IN, hinges, render_dir="out")
    os.makedirs("out", exist_ok=True)
    json.dump(report, open(f"out/{mid}_fit{tag}.json", "w"), indent=1)

    for f in report["floors"]:
        print(f"\n{report['name']} | {f['floor']} | openings found: {f.get('openings_found', 0)}")
        for r in f["rooms"]:
            doors = ", ".join(f"{d['width_in']}\"" for d in r["doors"]) or "none"
            turn = r["turning_space"]
            tstr = f" | turn circle {turn['max_circle_in']}\" ({'ok' if turn['meets_60in'] else 'under 60'})" if turn else ""
            print(f"  {r['label']:<12} {r['status']:<10} doors: {doors}{tstr}" + (f" | {r['reason']}" if r["reason"] else ""))
    print(f"\nSaved out/{mid}_fit{tag}.json and floor plan PNG(s)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
