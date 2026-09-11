import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { syntheticImportFixture } from "./legacy-import.mjs";

// Fixed private destination. Refuse overwrite; never read real user records.
const directory = resolve(".auth-proof");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const { users } = syntheticImportFixture();
const path = resolve(directory, "synthetic-users.json");
await writeFile(path, JSON.stringify(users, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(
  "Wrote two synthetic import users to .auth-proof/synthetic-users.json",
);
console.log(
  "No provider request made. This is not a completed Auth0 import proof.",
);
