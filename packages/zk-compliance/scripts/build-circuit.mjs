#!/usr/bin/env node
/**
 * Build ComplianceGate.circom → r1cs/wasm/zkey + Solidity verifier.
 * Requires `circom` on PATH. If missing, exits 0 with a skip message
 * (algebraic / registry gate still works).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = join(root, "artifacts");
mkdirSync(out, { recursive: true });

const circom = spawnSync("circom", ["--version"], { encoding: "utf8" });
if (circom.status !== 0) {
  const msg =
    "circom not found — skip circuit build. Install circom 2.x, then npm run build:circuit.\n";
  writeFileSync(join(out, "BUILD_SKIPPED.txt"), msg);
  console.warn(msg.trim());
  process.exit(0);
}

const circomFile = join(root, "circuits", "ComplianceGate.circom");
const compile = spawnSync(
  "circom",
  [circomFile, "--r1cs", "--wasm", "--sym", "-o", out],
  { encoding: "utf8", cwd: root }
);
console.log(compile.stdout || "");
if (compile.status !== 0) {
  console.error(compile.stderr || compile.error);
  process.exit(compile.status ?? 1);
}

console.log("Compiled. Next: snarkjs powersoftau / groth16 setup (see README).");
writeFileSync(
  join(out, "NEXT_STEPS.txt"),
  [
    "snarkjs powersoftau new bn128 12 pot12_0000.ptau -v",
    "snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name=dev -v -e='dev'",
    "snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v",
    "snarkjs groth16 setup ComplianceGate.r1cs pot12_final.ptau ComplianceGate_0000.zkey",
    "snarkjs zkey contribute ComplianceGate_0000.zkey ComplianceGate_final.zkey -e='dev'",
    "snarkjs zkey export verificationkey ComplianceGate_final.zkey verification_key.json",
    "snarkjs zkey export solidityverifier ComplianceGate_final.zkey ../../../contracts/ComplianceGateGroth16.sol",
  ].join("\n")
);
