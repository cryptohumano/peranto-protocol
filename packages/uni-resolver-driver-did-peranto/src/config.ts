import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import type { ContractAddresses, PerantoNetwork } from "@peranto/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type DriverConfig = {
  port: number;
  network: PerantoNetwork;
  rpcUrl: string;
  addresses: ContractAddresses;
};

function loadJson(filePath: string): {
  network?: string;
  contracts: ContractAddresses & Record<string, Address | null | undefined>;
} {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveDeploymentPath(): string {
  if (process.env.PERANTO_DEPLOYMENT_PATH) {
    return path.resolve(process.env.PERANTO_DEPLOYMENT_PATH);
  }
  const candidates = [
    path.resolve(__dirname, "../deployments/paseo.json"),
    path.resolve(__dirname, "../../web/public/deployments/paseo.json"),
    path.resolve(process.cwd(), "deployments/paseo.json"),
    path.resolve(process.cwd(), "packages/web/public/deployments/paseo.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "No se encontró paseo.json. Define PERANTO_DEPLOYMENT_PATH o copia deployments/paseo.json."
  );
}

export function loadDriverConfig(): DriverConfig {
  const deploymentPath = resolveDeploymentPath();
  const d = loadJson(deploymentPath);
  const c = d.contracts;
  const network = (process.env.PERANTO_NETWORK ??
    d.network ??
    "paseo") as PerantoNetwork;

  return {
    port: Number(process.env.PORT ?? process.env.UNIRESOLVER_DRIVER_PORT ?? 8080),
    network,
    rpcUrl:
      process.env.PERANTO_RPC_URL ??
      process.env.PASEO_RPC_URL ??
      "https://eth-rpc-testnet.polkadot.io/",
    addresses: {
      DIDRegistry: (process.env.PERANTO_DID_REGISTRY as Address | undefined) ??
        c.DIDRegistry,
      SchemaRegistry: c.SchemaRegistry,
      AttesterRegistry: c.AttesterRegistry,
      CredentialStatusRegistry: c.CredentialStatusRegistry,
      NameRegistry: c.NameRegistry ?? undefined,
      ProtocolTreasury: c.ProtocolTreasury,
      DisCOFactory: c.DisCOFactory,
      PerantoNode: c.PerantoNode ?? null,
    },
  };
}
