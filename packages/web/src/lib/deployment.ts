import type { Address } from "viem";
import type { ContractAddresses, PerantoNetwork } from "@peranto/sdk";

export type DeploymentJson = {
  network: string;
  chainId: number;
  contracts: ContractAddresses & Record<string, Address | null | undefined>;
  schemas?: Record<string, string>;
  paymentTokens?: Array<{
    address: string;
    symbol: string;
    decimals: number;
    native: boolean;
  }>;
};

export const PASEO_CHAIN_ID = 420420417;

export async function loadPaseoDeployment(): Promise<DeploymentJson> {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}deployments/paseo.json`);
  if (!res.ok) throw new Error("No se pudo cargar deployments/paseo.json");
  return res.json();
}

export function deploymentToAddresses(d: DeploymentJson): ContractAddresses {
  const c = d.contracts;
  return {
    DIDRegistry: c.DIDRegistry,
    SchemaRegistry: c.SchemaRegistry,
    AttesterRegistry: c.AttesterRegistry,
    CredentialStatusRegistry: c.CredentialStatusRegistry,
    NameRegistry: c.NameRegistry,
    ProtocolTreasury: c.ProtocolTreasury,
    DisCOFactory: c.DisCOFactory,
    PerantoNode: c.PerantoNode ?? null,
    EcosystemLabNode: c.EcosystemLabNode ?? null,
  };
}

export const DEFAULT_NETWORK: PerantoNetwork = "paseo";

/** Public Paseo RPCs — primary first; viem/http retries on transport errors. */
export const PASEO_RPC_URLS = [
  import.meta.env.VITE_PERANTO_RPC_URL as string | undefined,
  "https://services.polkadothub-rpc.com/testnet/",
  "https://eth-rpc-testnet.polkadot.io/",
].filter((u): u is string => Boolean(u?.trim()));

export const DEFAULT_RPC =
  PASEO_RPC_URLS[0] ?? "https://services.polkadothub-rpc.com/testnet/";
