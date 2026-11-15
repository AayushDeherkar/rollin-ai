import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
  // the stage moved to /app; presenter mode (`/?demo=1`) still opens the pitch directly (the query passes through)
  async redirects() {
    return [{ source: "/", has: [{ type: "query", key: "demo", value: "1" }], destination: "/app", permanent: false }];
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
