import { readFileSync } from "node:fs";

const { engines } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (process.versions.node !== engines.node)
  throw new Error(
    `Accounts requires Node ${engines.node}; running ${process.versions.node}. Select the package's pinned runtime first.`,
  );
console.info(`Accounts runtime: Node ${process.versions.node}`);
