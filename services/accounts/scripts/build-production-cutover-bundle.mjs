#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { PRODUCTION } from "./production-cutover-lib.mjs";

const [
  aegyoInput,
  outputInput,
  aegyoRef,
  attestationInput,
  accountsRef = "HEAD",
] = process.argv.slice(2);
if (!aegyoInput || !outputInput || !aegyoRef || !attestationInput)
  throw new Error(
    "usage: AEGYO_CHECKOUT PRIVATE_OUTPUT_DIR REVIEWED_AEGYO_REF LIVE_ATTESTATION [ACCOUNTS_REF]",
  );
const accounts = await realpath(new URL("../../..", import.meta.url).pathname);
const aegyo = await realpath(aegyoInput);
const output = resolve(outputInput);
const outputRelative = relative(
  join(accounts, "services/accounts/.proof"),
  output,
);
if (outputRelative.startsWith("..") || outputRelative.startsWith("/"))
  throw new Error("bundle_output_must_be_under_accounts_proof");
const git = (cwd, args, options = {}) =>
  execFileSync("git", args, { cwd, encoding: "utf8", ...options }).trim();
if (
  git(aegyo, ["remote", "get-url", "upstream"]) !==
  "https://github.com/Francisgood/kpop-lyrics.git"
)
  throw new Error("unexpected_aegyo_upstream_remote");
const reviewedAegyoRevision = git(aegyo, ["rev-parse", `${aegyoRef}^{commit}`]);
if (!/^[a-f0-9]{40}$/.test(reviewedAegyoRevision))
  throw new Error("invalid_reviewed_aegyo_revision");
try {
  git(aegyo, [
    "merge-base",
    "--is-ancestor",
    PRODUCTION.requiredFreezeAncestor,
    reviewedAegyoRevision,
  ]);
  git(aegyo, [
    "merge-base",
    "--is-ancestor",
    reviewedAegyoRevision,
    "upstream/main",
  ]);
} catch {
  throw new Error("reviewed_revision_not_on_upstream_main_with_freeze");
}
const accountCommit = git(accounts, ["rev-parse", `${accountsRef}^{commit}`]);
const attestationStat = await stat(attestationInput);
if (
  !attestationStat.isFile() ||
  attestationStat.mode & 0o077 ||
  attestationStat.uid !== process.getuid()
)
  throw new Error("unsafe_live_attestation");
const liveAttestation = JSON.parse(await readFile(attestationInput, "utf8"));
const age = Date.now() - Date.parse(liveAttestation.capturedAt);
const validPhase = ["inspect", "apply", "activate", "status"].includes(
  liveAttestation.phase,
);
if (
  liveAttestation.version !== 1 ||
  !validPhase ||
  age < 0 ||
  age > 15 * 60_000 ||
  liveAttestation.projectId !== PRODUCTION.projectId ||
  liveAttestation.environmentId !== PRODUCTION.environmentId ||
  liveAttestation.aegyoServiceId !== PRODUCTION.aegyoServiceId ||
  liveAttestation.sourceDatabaseServiceId !==
    PRODUCTION.sourceDatabaseServiceId ||
  liveAttestation.accountsServiceId !== PRODUCTION.accountsServiceId ||
  liveAttestation.accountsDatabaseServiceId !==
    PRODUCTION.accountsDatabaseServiceId ||
  liveAttestation.aegyoRevision !== reviewedAegyoRevision ||
  liveAttestation.aegyoFreezeEnabled !== "true" ||
  liveAttestation.accountsSignupEnabled !== "false" ||
  liveAttestation.accountsImageDigest !== PRODUCTION.accountsImageDigest ||
  (liveAttestation.phase === "activate" &&
    (liveAttestation.accountsTrafficEnabled !== "true" ||
      liveAttestation.aegyoSharedAuthEnabled !== "true" ||
      !/^[a-f0-9]{64}$/.test(liveAttestation.recoveryProviderIdDigest ?? "") ||
      liveAttestation.recoveryEvidence?.version !== 1)) ||
  (["inspect", "apply"].includes(liveAttestation.phase) &&
    (liveAttestation.accountsTrafficEnabled !== "false" ||
      liveAttestation.aegyoSharedAuthEnabled !== "false"))
)
  throw new Error("live_attestation_not_acceptable");
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await mkdir(output, { mode: 0o700 });

const hashes = {};
async function copyTracked(repo, ref, source, destination) {
  const bytes = execFileSync("git", ["show", `${ref}:${source}`], {
    cwd: repo,
  });
  hashes[destination] = createHash("sha256").update(bytes).digest("hex");
  const path = join(output, destination);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, "wx", 0o600);
  try {
    await file.write(bytes);
  } finally {
    await file.close();
  }
}

const accountFiles = [
  "services/accounts/package.json",
  "services/accounts/package-lock.json",
  "services/accounts/src/database-options.mjs",
  "services/accounts/src/legacy-import.mjs",
  "services/accounts/src/passwords.mjs",
  "services/accounts/scripts/check-runtime.mjs",
  "services/accounts/scripts/import-legacy.mjs",
  "services/accounts/scripts/production-cutover-db.mjs",
  "services/accounts/scripts/production-cutover-config.mjs",
  "services/accounts/scripts/production-cutover-lib.mjs",
  "services/accounts/scripts/production-cutover.mjs",
  "services/accounts/scripts/provision-production-clients-lib.mjs",
  "services/accounts/scripts/snapshot-aegyo-local-state.mjs",
  "services/accounts/scripts/verify-production-activation-readiness.mjs",
];
for (const source of accountFiles)
  await copyTracked(
    accounts,
    accountCommit,
    source,
    source.replace("services/accounts/", "accounts/"),
  );
const aegyoFiles = ["scripts/shared-auth/reconciliation-lib.mjs"];
for (const source of aegyoFiles)
  await copyTracked(aegyo, reviewedAegyoRevision, source, `aegyo/${source}`);
const sourceManifest = {
  version: 1,
  accountCommit,
  reviewedAegyoRevision,
  requiredFreezeAncestor: PRODUCTION.requiredFreezeAncestor,
  reviewedRevisionIncludesFreeze: true,
  upstreamRef: "upstream/main",
  liveAttestation,
  files: hashes,
};
const manifestFile = await open(
  join(output, "production-source-manifest.json"),
  "wx",
  0o600,
);
try {
  await manifestFile.writeFile(`${JSON.stringify(sourceManifest, null, 2)}\n`);
} finally {
  await manifestFile.close();
}
const dockerfile = `FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /operator/accounts
COPY accounts/package.json accounts/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY accounts/ ./
COPY aegyo/ /operator/aegyo/
COPY production-source-manifest.json /operator/production-source-manifest.json
RUN mkdir -p /operator/accounts/.proof/production-cutover /operator/aegyo/.proof && chown -R node:node /operator
USER node
ENTRYPOINT ["node", "/operator/accounts/scripts/production-cutover.mjs"]
`;
const docker = await open(join(output, "Dockerfile"), "wx", 0o600);
try {
  await docker.writeFile(dockerfile);
} finally {
  await docker.close();
}
console.info(
  JSON.stringify({
    accountCommit,
    reviewedAegyoRevision,
    requiredFreezeAncestor: PRODUCTION.requiredFreezeAncestor,
    files: Object.keys(hashes).length,
  }),
);
