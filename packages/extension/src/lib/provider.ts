import {
  NETWORK_CHAIN_ID,
  PASEO_BROWSER_RPC_URLS,
  createRpcTransport,
  type PerantoNetwork,
} from "@peranto/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, type Hex } from "viem";
import * as storage from "./storage";
import { runAction } from "./actions";
import {
  isSensitiveProviderMethod,
  requireDomainLinkage,
} from "./domain-gate";
import {
  beginSaveCredential,
  beginShareCredential,
  beginProveComplianceGate,
} from "./holder-flow";
import { hardhat, base, baseSepolia, arbitrum, arbitrumSepolia } from "viem/chains";
import type { DidConfigurationDocument } from "@peranto/sdk";

const paseoChain = {
  id: 420420417,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://eth-rpc-testnet.polkadot.io/"],
    },
  },
} as const;

function rpcTransport(network: PerantoNetwork, rpcUrl: string) {
  if (network === "paseo") {
    return createRpcTransport([rpcUrl, ...PASEO_BROWSER_RPC_URLS]);
  }
  return createRpcTransport(rpcUrl);
}

function chainFor(network: PerantoNetwork) {
  switch (network) {
    case "paseo":
      return paseoChain;
    case "base":
      return base;
    case "baseSepolia":
      return baseSepolia;
    case "arbitrum":
      return arbitrum;
    case "arbitrumSepolia":
      return arbitrumSepolia;
    default:
      return hardhat;
  }
}

export type ProviderRequestContext = {
  origin?: string;
  didConfiguration?: unknown;
};

/** EIP-1193 + Peranto handlers for dapps connected to Aura. */
export async function handleProviderRequest(
  method: string,
  params: unknown[] = [],
  ctx: ProviderRequestContext = {}
): Promise<unknown> {
  const state = await storage.getState();
  const identity = state.identity;
  const chainId = NETWORK_CHAIN_ID[state.settings.network];
  const chainHex = `0x${chainId.toString(16)}`;

  if (isSensitiveProviderMethod(method, params)) {
    if (!ctx.origin) {
      throw new Error(
        "Aura: falta origen de página para domain linkage (¿content script?)"
      );
    }
    await requireDomainLinkage({
      pageOrigin: ctx.origin,
      didConfiguration: ctx.didConfiguration as
        | DidConfigurationDocument
        | string
        | null
        | undefined,
    });
  }

  switch (method) {
    case "eth_chainId":
      return chainHex;
    case "net_version":
      return String(chainId);
    case "eth_accounts":
    case "eth_requestAccounts": {
      if (!identity) throw new Error("Aura: crea una identidad en el popup primero");
      return [identity.address];
    }
    case "eth_getBalance": {
      const pub = createPublicClient({
        chain: chainFor(state.settings.network),
        transport: rpcTransport(state.settings.network, state.settings.rpcUrl),
      });
      const addr = (params[0] as string) ?? identity?.address;
      if (!addr) throw new Error("No address");
      const bal = await pub.getBalance({ address: addr as `0x${string}` });
      return `0x${bal.toString(16)}`;
    }
    case "personal_sign": {
      if (!identity) throw new Error("Aura: sin identidad");
      const message = params[0] as string;
      const account = privateKeyToAccount(identity.privateKey);
      const wallet = createWalletClient({
        account,
        chain: chainFor(state.settings.network),
        transport: rpcTransport(state.settings.network, state.settings.rpcUrl),
      });
      return wallet.signMessage({
        message: message.startsWith("0x")
          ? { raw: message as Hex }
          : message,
      });
    }
    case "eth_sendTransaction": {
      if (!identity) throw new Error("Aura: sin identidad");
      const tx = params[0] as {
        to?: `0x${string}`;
        data?: Hex;
        value?: Hex;
        gas?: Hex;
      };
      const account = privateKeyToAccount(identity.privateKey);
      const wallet = createWalletClient({
        account,
        chain: chainFor(state.settings.network),
        transport: rpcTransport(state.settings.network, state.settings.rpcUrl),
      });
      return wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
        chain: chainFor(state.settings.network),
        account,
      });
    }
    case "wallet_getCredentials": {
      return state.credentials.map((c) => ({
        id: c.id,
        jwt: c.jwt,
        credHash: c.credHash,
        schemaKey: c.schemaKey,
        issuerDid: c.issuerDid,
        subjectDid: c.subjectDid,
        label: c.label,
        savedAt: c.savedAt,
      }));
    }
    case "peranto_saveCredential":
    case "wallet_saveCredential": {
      if (!ctx.origin) throw new Error("Aura: falta origen");
      const p =
        params[0] && typeof params[0] === "object" && !Array.isArray(params[0])
          ? (params[0] as Record<string, unknown>)
          : { jwt: params[0] };
      const jwt = String(p.jwt ?? "").trim();
      if (!jwt) throw new Error("Aura: jwt requerido (params[0].jwt)");
      return beginSaveCredential({
        origin: ctx.origin,
        jwt,
        label: p.label !== undefined ? String(p.label) : undefined,
        schemaKey: p.schemaKey !== undefined ? String(p.schemaKey) : undefined,
        meta:
          p.meta && typeof p.meta === "object"
            ? (p.meta as {
                claimsCommitment?: Hex;
                commitmentSalt?: Hex;
                validUntil?: number;
              })
            : undefined,
      });
    }
    case "peranto_proveComplianceGate": {
      if (!ctx.origin) throw new Error("Aura: falta origen");
      const p = (params[0] as Record<string, unknown> | undefined) ?? {};
      return beginProveComplianceGate({
        origin: ctx.origin,
        minScoreBps: Number(p.minScoreBps ?? 9000),
        allowlist: Array.isArray(p.allowlist)
          ? p.allowlist.map(String)
          : ["MX", "CO", "AR", "ES", "PT"],
      });
    }
    case "peranto_requestCredential":
    case "wallet_requestCredential": {
      if (!ctx.origin) throw new Error("Aura: falta origen");
      const p = (params[0] as Record<string, unknown> | undefined) ?? {};
      const schemaKeys = Array.isArray(p.schemaKeys)
        ? p.schemaKeys.map(String)
        : p.schemaKey
          ? [String(p.schemaKey)]
          : [];
      const trustedIssuers = Array.isArray(p.trustedIssuers)
        ? p.trustedIssuers.map(String)
        : undefined;
      const disclose = Array.isArray(p.disclose)
        ? p.disclose.map(String)
        : undefined;
      const mode =
        p.mode === "claims" || (disclose && disclose.length)
          ? "claims"
          : "credential";
      return beginShareCredential({
        origin: ctx.origin,
        challenge: String(p.challenge ?? ""),
        schemaKeys,
        trustedIssuers,
        subject: p.subject !== undefined ? String(p.subject) : undefined,
        mode,
        disclose,
      });
    }
    case "peranto_requestSession": {
      if (!ctx.origin) throw new Error("Aura: falta origen");
      const sites = await storage.getState();
      const hit = (sites.trustedSites ?? []).find(
        (s) => s.origin === ctx.origin
      );
      return {
        verified: true,
        origin: ctx.origin,
        issuerDid: hit?.issuerDid ?? null,
        expiresAt: hit?.expiresAt ?? null,
        holderDid: identity?.did ?? null,
        holderAddress: identity?.address ?? null,
      };
    }
    case "wallet_switchEthereumChain": {
      const target = (params[0] as { chainId?: string })?.chainId;
      if (target && target.toLowerCase() !== chainHex.toLowerCase()) {
        throw new Error(`Aura: cambia la red en el popup (want ${target})`);
      }
      return null;
    }
    case "wallet_requestPermissions":
    case "wallet_getPermissions":
      return [{ parentCapability: "eth_accounts" }];
    case "peranto_getDid": {
      if (!identity) throw new Error("Aura: sin identidad");
      return { address: identity.address, did: identity.did };
    }
    case "peranto_action": {
      const action = String(params[0] ?? "");
      const payload = (params[1] as Record<string, unknown> | undefined) ?? {};
      if (!action) throw new Error("Aura: peranto_action requiere action");
      return runAction(action, payload);
    }
    default:
      throw new Error(`Aura: método no soportado ${method}`);
  }
}
