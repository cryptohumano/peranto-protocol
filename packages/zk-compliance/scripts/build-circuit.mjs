#!/usr/bin/env node
/**
 * nargo compile + copy circuit JSON. Requires `nargo` on PATH.
 * Proofs: `bb` / `@aztec/bb.js` UltraHonk (see src/honk.ts).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = join(__dirname, "..");
const noirDir = join(pkg, "noir");
const out = join(pkg, "artifacts");
mkdirSync(out, { recursive: true });

const nargo = spawnSync("nargo", ["--version"], { encoding: "utf8" });
if (nargo.status !== 0) {
  const msg =
    "nargo not found — skip circuit build. Install Nargo 1.x (noirup), then npm run build:circuit.\n";
  writeFileSync(join(out, "BUILD_SKIPPED.txt"), msg);
  console.warn(msg.trim());
  process.exit(0);
}

const compile = spawnSync("nargo", ["compile", "--silence-warnings"], {
  encoding: "utf8",
  cwd: noirDir,
});
process.stdout.write(compile.stdout || "");
if (compile.status !== 0) {
  console.error(compile.stderr || compile.error);
  process.exit(compile.status ?? 1);
}

const generated = join(noirDir, "target", "compliance_gate.json");
if (!existsSync(generated)) {
  console.error("missing", generated);
  process.exit(1);
}
copyFileSync(generated, join(pkg, "circuit.json"));
const full = JSON.parse(readFileSync(join(pkg, "circuit.json"), "utf8"));
writeFileSync(
  join(pkg, "circuit.slim.json"),
  JSON.stringify({
    noir_version: full.noir_version,
    hash: full.hash,
    abi: full.abi,
    bytecode: full.bytecode,
  })
);
console.log("Wrote circuit.json + circuit.slim.json");
console.log("Next: npm run prove -w @peranto/zk-compliance");
