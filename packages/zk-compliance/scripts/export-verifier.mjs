#!/usr/bin/env node
/**
 * Export UltraHonk Solidity verifier (keccak / EVM ZK) from the Noir circuit.
 * Regenerates artifacts/HonkVerifier.sol — do not hand-edit that file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = join(__dirname, "..");
const circuit = join(pkg, "circuit.json");
const vkDir = join(pkg, "artifacts");
const outSol = join(pkg, "artifacts", "HonkVerifier.sol");

if (!existsSync(circuit)) {
  console.error("missing circuit.json — npm run build:circuit");
  process.exit(1);
}
mkdirSync(vkDir, { recursive: true });
mkdirSync(dirname(outSol), { recursive: true });

const vk = spawnSync(
  "bb",
  ["write_vk", "-b", circuit, "-o", vkDir, "-t", "evm"],
  { encoding: "utf8" }
);
process.stdout.write(vk.stdout || "");
if (vk.status !== 0) {
  console.error(vk.stderr || vk.error);
  process.exit(vk.status ?? 1);
}

const sol = spawnSync(
  "bb",
  [
    "write_solidity_verifier",
    "-k",
    join(vkDir, "vk"),
    "-o",
    outSol,
    "-t",
    "evm",
  ],
  { encoding: "utf8" }
);
process.stdout.write(sol.stdout || "");
if (sol.status !== 0) {
  console.error(sol.stderr || sol.error);
  process.exit(sol.status ?? 1);
}
console.log("Wrote", outSol);
