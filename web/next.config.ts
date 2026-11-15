import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
  // the stage moved to /app. Any stage link to the root (presenter mode `/?demo=1`, a unit texted by the bridge
  // `/?sid=`, and the other stage parameters) still opens the stage directly; the query passes through.
  async redirects() {
    return ["demo", "sid", "search", "pace", "agent", "state", "view", "motion"].map((key) => ({
      source: "/",
      has: [{ type: "query" as const, key }],
      destination: "/app",
      permanent: false,
    }));
  },
  partialPrefetching: true,
  // the chat route replays the synthetic contract run from disk when there is no API (the public build)
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: { "/api/chat": ["../contracts/chat_events.example.jsonl"] },
  turbopack: {
    // Repo root, so web/ can import the shared fixtures in ../contracts.
    root: path.join(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
