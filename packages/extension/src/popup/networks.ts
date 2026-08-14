import type { PerantoNetwork } from "@peranto/sdk";
import { NETWORK_CHAIN_ID } from "@peranto/sdk";

export type NetworkStatus = "live" | "local" | "soon";

export type NetworkMeta = {
  id: PerantoNetwork;
  label: string;
  short: string;
  chainId: number;
  status: NetworkStatus;
  hint: string;
};

/** Catálogo UI — listo para más redes cuando haya deploy / RPC. */
export const NETWORK_CATALOG: NetworkMeta[] = [
  {
    id: "paseo",
    label: "Paseo Hub",
    short: "Paseo",
    chainId: NETWORK_CHAIN_ID.paseo,
    status: "live",
    hint: "TestNet Polkadot · contratos Peranto",
  },
  {
    id: "hardhat",
    label: "Hardhat local",
    short: "Local",
    chainId: NETWORK_CHAIN_ID.hardhat,
    status: "local",
    hint: "localhost:8545 · desarrollo",
  },
  {
    id: "baseSepolia",
    label: "Base Sepolia",
    short: "Base Σ",
    chainId: NETWORK_CHAIN_ID.baseSepolia,
    status: "soon",
    hint: "Próximamente — importa deploy JSON",
  },
  {
    id: "base",
    label: "Base",
    short: "Base",
    chainId: NETWORK_CHAIN_ID.base,
    status: "soon",
    hint: "Próximamente — mainnet",
  },
  {
    id: "arbitrumSepolia",
    label: "Arbitrum Sepolia",
    short: "Arb Σ",
    chainId: NETWORK_CHAIN_ID.arbitrumSepolia,
    status: "soon",
    hint: "Próximamente — importa deploy JSON",
  },
  {
    id: "arbitrum",
    label: "Arbitrum One",
    short: "Arb",
    chainId: NETWORK_CHAIN_ID.arbitrum,
    status: "soon",
    hint: "Próximamente — mainnet",
  },
];

export function networkMeta(id: string): NetworkMeta {
  return (
    NETWORK_CATALOG.find((n) => n.id === id) ?? {
      id: id as PerantoNetwork,
      label: id,
      short: id,
      chainId: 0,
      status: "soon",
      hint: "Red desconocida",
    }
  );
}

export function statusLabel(status: NetworkStatus): string {
  switch (status) {
    case "live":
      return "Activa";
    case "local":
      return "Local";
    default:
      return "Pronto";
  }
}
