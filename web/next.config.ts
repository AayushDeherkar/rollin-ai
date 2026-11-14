import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
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
