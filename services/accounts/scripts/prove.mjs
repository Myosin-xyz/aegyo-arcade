import "./check-runtime.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Always creates its own empty cluster. Never accepts DATABASE_URL or loads env.
const root = fileURLToPath(new URL("..", import.meta.url));
const privateDir = join(root, ".proof");
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
chmodSync(privateDir, 0o700);
const run = mkdtempSync(join(privateDir, "run-"));
const data = join(run, "data");
// PostgreSQL's Unix socket path is limited to 103 bytes on this host.
const socket = mkdtempSync("/tmp/aegyo-idp-proof-");
chmodSync(socket, 0o700);
let started = false;
try {
  execFileSync(
    "initdb",
    ["-D", data, "--auth=trust", "--no-locale", "-E", "UTF8"],
    {
      stdio: "pipe",
    },
  );
  execFileSync(
    "pg_ctl",
    [
      "-D",
      data,
      "-l",
      join(run, "postgres.log"),
      "-o",
      `-F -p 5432 -c listen_addresses='' -k '${socket}'`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  started = true;
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      "tests/provider.test.mjs",
      "tests/migration.test.mjs",
      "tests/seed.test.mjs",
      "tests/legacy-copy.test.mjs",
    ],
    {
      cwd: root,
      env: { ...process.env, ACCOUNTS_PROOF_PG_SOCKET: socket },
      stdio: "inherit",
    },
  );
  process.exitCode = result.status ?? 1;
} catch {
  console.error(
    "Local proof could not start; inspect the private .proof run directory. No remote database was used.",
  );
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "pipe",
      });
      started = false;
    } catch {
      console.error("Local proof database needs manual shutdown; see .proof.");
      process.exitCode = 1;
    }
  }
  if (!started) rmSync(socket, { recursive: true, force: true });
}
