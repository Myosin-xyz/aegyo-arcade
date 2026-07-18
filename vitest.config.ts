import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/db/**/*.test.ts",
    ],
    // DB test files share ONE Postgres database and TRUNCATE between
    // tests — parallel workers wipe each other mid-test (observed as the
    // M1 "unreproducible flake" before a second db file made it loud).
    // The whole suite runs in a few seconds; determinism wins.
    fileParallelism: false,
  },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Host-level tests render the real GameHostInner; Link gets a stub.
      "next/link": fileURLToPath(
        new URL("./tests/helpers/next-link-stub.tsx", import.meta.url),
      ),
    },
  },
});
