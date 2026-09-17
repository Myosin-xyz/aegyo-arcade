// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/competition/replay-source-manifest.json";

const root = resolve(import.meta.dirname, "../..");
const localImport =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

function resolveLocalImport(
  importer: string,
  specifier: string,
): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(root, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(importer), specifier)
      : null;
  if (!base) return null;
  for (const candidate of extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.json`,
        resolve(base, "index.ts"),
      ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Replay dependency cannot be resolved: ${specifier} from ${importer}`,
  );
}

function dependencyClosure(entrypoint: string): string[] {
  const pending = [resolve(root, entrypoint)];
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (extname(file) === ".json") continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(localImport)) {
      const dependency = resolveLocalImport(file, match[1]);
      if (dependency) pending.push(dependency);
    }
  }
  return [...seen].map((file) => relative(root, file)).sort();
}

describe("competition replay source freeze", () => {
  it("pins the complete local deterministic dependency closure for replay v1", () => {
    const replayV1 = manifest.replayVersions["1"];
    expect(Object.keys(replayV1.files).sort()).toEqual(
      dependencyClosure(replayV1.entrypoint),
    );
    for (const [path, expected] of Object.entries(replayV1.files)) {
      const actual = createHash("sha256")
        .update(readFileSync(resolve(root, path)))
        .digest("hex");
      expect(actual, `${path} changed replay v1 semantics`).toBe(expected);
    }
  });
});
