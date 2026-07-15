import * as fs from "fs";
import * as path from "path";
import type { Hex } from "viem";
import type { ContractAddresses } from "./client";

/** Node-only helper — not safe for browser bundles. */
export function loadDeployment(chainId: number): ContractAddresses & {
  schemas?: Record<string, Hex>;
} {
  const file = path.resolve(__dirname, "../../../deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment file not found: ${file}. Run deploy first.`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    contracts: ContractAddresses;
    schemas?: Record<string, Hex>;
  };
  return { ...raw.contracts, schemas: raw.schemas };
}
