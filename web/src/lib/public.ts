/**
 * The public build (`NEXT_PUBLIC_ROLLIN_PUBLIC=1`, e.g. on Vercel) is fixture-only: it never calls
 * the Rollin' API, even if an API address were set, so it can only show the synthetic contract
 * apartment and the recorded synthetic run, and every view says so.
 */
export const PUBLIC_REPLAY = process.env.NEXT_PUBLIC_ROLLIN_PUBLIC === "1";

export const PUBLIC_LABEL = "Replay with a synthetic apartment";
