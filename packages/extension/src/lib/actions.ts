import {
  PerantoClient,
  formatDid,
  parseEther,
  createMultiKeyIdentity,
  importMultiKeyFromMnemonic,
  importEvmOnlyIdentity,
  signPayload,
  signSubstrateExtrinsicPayload,
  verifyPayload,
  credentialStatusAbi,
  type PerantoNetwork,
  type SignatureScheme,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";
import * as storage from "./storage";
import type { AuraIdentity, AuraSettings, StoredCredential } from "./types";
import { defaultSettings, STATUS_LABELS } from "./types";

function jsonSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

function toAuraIdentity(
  multi: Awaited<ReturnType<typeof createMultiKeyIdentity>>
): AuraIdentity {
  return {
    mnemonic: multi.mnemonic,
    privateKey: multi.evm.privateKey,
    address: multi.evm.address,
    did: multi.evm.did,
    substrate: multi.substrate,
    evmMappedAccountId32: multi.evmMappedAccountId32,
  };
}

export async function buildClient(withWallet = false): Promise<PerantoClient> {
  const state = await storage.getState();
  if (withWallet && !state.identity) {
    throw new Error("Crea o importa una identidad primero");
  }
  return new PerantoClient({
    network: state.settings.network,
    addresses: state.settings.addresses,
    rpcUrl: state.settings.rpcUrl,
    privateKey: withWallet ? state.identity!.privateKey : undefined,
  });
}

export async function createNewIdentity() {
  const state = await storage.getState();
  const multi = await createMultiKeyIdentity(state.settings.network);
  await storage.setIdentity(toAuraIdentity(multi));
  return storage.getState();
}

export async function importIdentity(privateKey: string) {
  const state = await storage.getState();
  const only = importEvmOnlyIdentity(
    normalizeKey(privateKey),
    state.settings.network
  );
  await storage.setIdentity({
    privateKey: only.evm.privateKey,
    address: only.evm.address,
    did: only.evm.did,
    evmMappedAccountId32: only.evmMappedAccountId32,
  });
  return storage.getState();
}

export async function importMnemonic(mnemonic: string) {
  const state = await storage.getState();
  const multi = await importMultiKeyFromMnemonic(
    mnemonic,
    state.settings.network
  );
  await storage.setIdentity(toAuraIdentity(multi));
  return storage.getState();
}

export async function updateSettings(partial: Partial<AuraSettings>) {
  const state = await storage.getState();
  let next = { ...state.settings, ...partial };

  if (partial.network && partial.network !== state.settings.network) {
    const defaults = defaultSettings(partial.network);
    next = {
      ...defaults,
      ...partial,
      addresses: partial.addresses ?? defaults.addresses,
      rpcUrl: partial.rpcUrl ?? defaults.rpcUrl,
    };
    if (state.identity) {
      await storage.setIdentity({
        ...state.identity,
        did: formatDid(next.network, state.identity.address),
      });
    }
  }

  await storage.setSettings(next);
  return storage.getState();
}

export async function importDeploymentJson(json: string) {
  const parsed = JSON.parse(json) as {
    contracts?: AuraSettings["addresses"];
    network?: string;
    chainId?: number;
  };
  if (!parsed.contracts?.DIDRegistry) {
    throw new Error("JSON de deploy inválido: falta contracts.DIDRegistry");
  }
  let network: PerantoNetwork = "hardhat";
  const byChain: Record<number, PerantoNetwork> = {
    31337: "hardhat",
    420420417: "paseo",
    8453: "base",
    84532: "baseSepolia",
    42161: "arbitrum",
    421614: "arbitrumSepolia",
  };
  if (parsed.chainId && byChain[parsed.chainId]) {
    network = byChain[parsed.chainId];
  } else if (parsed.network && parsed.network in byChain === false) {
    const nameMap: Record<string, PerantoNetwork> = {
      hardhat: "hardhat",
      localhost: "hardhat",
      paseo: "paseo",
      base: "base",
      baseSepolia: "baseSepolia",
      arbitrum: "arbitrum",
      arbitrumSepolia: "arbitrumSepolia",
    };
    network = nameMap[parsed.network] ?? "hardhat";
  }
  const defaults = defaultSettings(network);
  await storage.setSettings({
    network,
    rpcUrl: defaults.rpcUrl,
    substrateWsUrl: defaults.substrateWsUrl,
    addresses: parsed.contracts,
  });
  const state = await storage.getState();
  if (state.identity) {
    await storage.setIdentity({
      ...state.identity,
      did: formatDid(network, state.identity.address),
    });
  }
  return storage.getState();
}

/** Comprueba RPC + que CredentialStatusRegistry responde anchorFee. */
export async function pingDeployment(): Promise<{
  rpcUrl: string;
  chainId: number;
  credentialStatus: string;
  anchorFee: string;
  ok: boolean;
}> {
  const client = await buildClient(false);
  const chainId = await client.publicClient.getChainId();
  const code = await client.publicClient.getBytecode({
    address: client.addresses.CredentialStatusRegistry,
  });
  if (!code || code === "0x") {
    return {
      rpcUrl: (await storage.getState()).settings.rpcUrl,
      chainId,
      credentialStatus: client.addresses.CredentialStatusRegistry,
      anchorFee: "",
      ok: false,
    };
  }
  const fee = await client.publicClient.readContract({
    address: client.addresses.CredentialStatusRegistry,
    abi: credentialStatusAbi,
    functionName: "anchorFee",
  });
  return {
    rpcUrl: (await storage.getState()).settings.rpcUrl,
    chainId,
    credentialStatus: client.addresses.CredentialStatusRegistry,
    anchorFee: fee.toString(),
    ok: true,
  };
}

export async function runAction(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  switch (action) {
    case "settings.sync": {
      const network = String(payload.network ?? "paseo") as PerantoNetwork;
      const rpcUrl = payload.rpcUrl ? String(payload.rpcUrl) : undefined;
      const addresses = payload.addresses as AuraSettings["addresses"] | undefined;
      if (!addresses?.DIDRegistry || !addresses?.NameRegistry) {
        throw new Error("settings.sync: addresses incompletas");
      }
      await updateSettings({
        network,
        ...(rpcUrl ? { rpcUrl } : {}),
        addresses,
      });
      const state = await storage.getState();
      return {
        network: state.settings.network,
        rpcUrl: state.settings.rpcUrl,
        nameRegistry: state.settings.addresses.NameRegistry,
      };
    }

    case "did.resolve": {
      const did = String(payload.did ?? "");
      const client = await buildClient(false);
      return jsonSafe(await client.resolveDid(did));
    }

    case "did.setService": {
      const type = String(payload.type ?? "");
      const serviceEndpoint = payload.serviceEndpoint;
      if (!type || serviceEndpoint === undefined) {
        throw new Error("type y serviceEndpoint requeridos");
      }
      const key = payload.key ? String(payload.key) : undefined;
      const name = payload.name ? String(payload.name) : undefined;
      const client = await buildClient(true);
      const tx = await client.setDidService({
        type,
        key,
        name,
        serviceEndpoint: serviceEndpoint as string,
        id: payload.id ? String(payload.id) : undefined,
      });
      return jsonSafe({ tx, type, key, name });
    }

    case "did.clearService": {
      const attrKey = payload.attrKey ? String(payload.attrKey) : undefined;
      const type = String(payload.type ?? "");
      const key = payload.key ? String(payload.key) : undefined;
      const client = await buildClient(true);
      const tx = attrKey
        ? await client.clearDidServiceByAttrKey(attrKey)
        : await client.clearDidService(type, key);
      return jsonSafe({ tx, type, key, attrKey });
    }

    case "did.deactivate": {
      const client = await buildClient(true);
      const tx = await client.deactivateDid();
      return jsonSafe({ tx });
    }

    case "name.release": {
      const label = String(payload.label ?? "");
      if (!label) throw new Error("label requerido");
      const client = await buildClient(true);
      const tx = await client.releaseName(label);
      return jsonSafe({ tx, label });
    }

    case "disco.dissolve": {
      const node = String(payload.node ?? "") as Address;
      if (!node) throw new Error("node requerido");
      const residualTo = payload.residualTo
        ? (String(payload.residualTo) as Address)
        : undefined;
      const revokeCredHashes = Array.isArray(payload.revokeCredHashes)
        ? (payload.revokeCredHashes as Hex[])
        : undefined;
      const client = await buildClient(true);
      return jsonSafe(
        await client.dissolveNode(node, residualTo, { revokeCredHashes })
      );
    }

    case "attester.join": {
      const schemaKey = String(payload.schemaKey ?? "peranto:EcoTestResult:v1");
      const stake =
        payload.stake !== undefined && payload.stake !== ""
          ? BigInt(String(payload.stake))
          : undefined;
      const client = await buildClient(true);
      const res = await client.stakeAndJoin(schemaKey, stake);
      return jsonSafe({
        ...res,
        attester: client.accountAddress,
      });
    }

    case "attester.isAuthorized": {
      const state = await storage.getState();
      if (!state.identity) throw new Error("Sin identidad");
      const schemaKey = String(payload.schemaKey ?? "peranto:EcoTestResult:v1");
      const client = await buildClient(false);
      const ok = await client.isAuthorized(state.identity.address, schemaKey);
      return { authorized: ok, schemaKey };
    }

    case "vc.issue": {
      const subject = String(payload.subject ?? "") as Address;
      if (!subject) throw new Error("subject requerido");
      const client = await buildClient(true);
      const issued = await client.issueAndAnchor(subject, {
        sampleId: String(payload.sampleId ?? "S-001"),
        testType: String(payload.testType ?? "pH"),
        result: String(payload.result ?? "7.2"),
        unit: String(payload.unit ?? "pH"),
        labName: String(payload.labName ?? "EcosystemLab"),
        testedAt: String(payload.testedAt ?? new Date().toISOString()),
      });
      const cred: StoredCredential = {
        id: issued.credHash,
        jwt: issued.jwt,
        credHash: issued.credHash,
        schemaKey: issued.schemaKey,
        issuerDid: issued.issuerDid,
        subjectDid: issued.subjectDid,
        label: `EcoTest ${payload.sampleId ?? "S-001"}`,
        savedAt: new Date().toISOString(),
        anchorTx: issued.anchorTx,
      };
      await storage.addCredential(cred);
      return jsonSafe({
        credHash: issued.credHash,
        issuerDid: issued.issuerDid,
        subjectDid: issued.subjectDid,
        schemaKey: issued.schemaKey,
        anchorTx: issued.anchorTx,
        jwt: issued.jwt,
      });
    }

    case "vc.issueClaims": {
      const subject = String(payload.subject ?? "") as Address;
      if (!subject) throw new Error("subject requerido");
      const schemaKey = String(payload.schemaKey ?? "peranto:Member:v1");
      const claims =
        (payload.claims as Record<string, unknown> | undefined) ?? {};
      const credentialType =
        payload.credentialType !== undefined
          ? String(payload.credentialType)
          : undefined;
      const client = await buildClient(true);
      const issued = await client.issueAndAnchorClaims(
        subject,
        claims,
        schemaKey,
        credentialType
      );
      const cred: StoredCredential = {
        id: issued.credHash,
        jwt: issued.jwt,
        credHash: issued.credHash,
        schemaKey: issued.schemaKey,
        issuerDid: issued.issuerDid,
        subjectDid: issued.subjectDid,
        label: String(payload.label ?? schemaKey),
        savedAt: new Date().toISOString(),
        anchorTx: issued.anchorTx,
      };
      await storage.addCredential(cred);
      return jsonSafe({
        credHash: issued.credHash,
        issuerDid: issued.issuerDid,
        subjectDid: issued.subjectDid,
        schemaKey: issued.schemaKey,
        anchorTx: issued.anchorTx,
        jwt: issued.jwt,
      });
    }

    case "vc.verify": {
      const jwt = String(payload.jwt ?? "");
      if (!jwt) throw new Error("JWT requerido");
      const client = await buildClient(false);
      const result = await client.verifyCredential(jwt);
      return jsonSafe({
        jwtValid: result.jwtValid,
        authorized: result.authorized,
        onChainStatus: STATUS_LABELS[result.onChainStatus] ?? result.onChainStatus,
        issuerDid: result.details.issuerDid,
        subjectDid: result.details.subjectDid,
        credHash: result.details.credHash,
        error: result.details.error,
        claims: (result.details.vc as { credentialSubject?: unknown })
          ?.credentialSubject,
      });
    }

    case "vc.revoke": {
      const credHash = String(payload.credHash ?? "") as Hex;
      const reason = String(payload.reason ?? "revoked");
      const client = await buildClient(true);
      const tx = await client.revoke(credHash, reason);
      return jsonSafe({ tx, credHash, reason });
    }

    case "vc.import": {
      const jwt = String(payload.jwt ?? "").trim();
      if (!jwt) throw new Error("JWT requerido");
      const client = await buildClient(false);
      const verified = await client.verifyCredential(jwt);
      if (!verified.jwtValid) {
        throw new Error(verified.details.error ?? "JWT inválido");
      }
      const cred: StoredCredential = {
        id: verified.details.credHash,
        jwt,
        credHash: verified.details.credHash,
        schemaKey: "peranto:EcoTestResult:v1",
        issuerDid: verified.details.issuerDid,
        subjectDid: verified.details.subjectDid,
        label: String(payload.label ?? "Imported VC"),
        savedAt: new Date().toISOString(),
      };
      await storage.addCredential(cred);
      return jsonSafe(cred);
    }

    case "vc.remove": {
      await storage.removeCredential(String(payload.credHash ?? ""));
      return { removed: true };
    }

    case "name.register": {
      const label = String(payload.label ?? "");
      if (!label) throw new Error("label requerido");
      const client = await buildClient(true);
      return jsonSafe(await client.registerName(label));
    }

    case "name.resolve": {
      const label = String(payload.label ?? "");
      const client = await buildClient(false);
      return jsonSafe(await client.resolveName(label));
    }

    case "disco.create": {
      const name = String(payload.name ?? "");
      if (!name) throw new Error("name requerido");
      const seedRaw = String(payload.seed ?? "0");
      const seed =
        seedRaw === "0" || seedRaw === ""
          ? 0n
          : seedRaw.includes(".")
            ? parseEther(seedRaw)
            : BigInt(seedRaw);
      const floorRaw = payload.reserveFloor;
      const reserveFloor =
        floorRaw === undefined || floorRaw === ""
          ? undefined
          : String(floorRaw).includes(".")
            ? parseEther(String(floorRaw))
            : BigInt(String(floorRaw));
      const client = await buildClient(true);
      const res = await client.createNode(name, { seedWei: seed, reserveFloor });
      await storage.rememberNode(res.node, name);
      return jsonSafe(res);
    }

    case "disco.tip": {
      const node = String(payload.node ?? "") as Address;
      const to = String(payload.to ?? "") as Address;
      const valueRaw = String(payload.value ?? "");
      if (!node || !to || !valueRaw) throw new Error("node, to y value requeridos");
      const value = valueRaw.includes(".")
        ? parseEther(valueRaw)
        : BigInt(valueRaw);
      const client = await buildClient(true);
      const tx = await client.tip(node, to, value);
      return jsonSafe({ tx, node, to, value: value.toString() });
    }

    case "disco.contribute": {
      const node = String(payload.node ?? "") as Address;
      const valueRaw = String(payload.value ?? "");
      if (!node || !valueRaw) throw new Error("node y value requeridos");
      const value = valueRaw.includes(".")
        ? parseEther(valueRaw)
        : BigInt(valueRaw);
      const client = await buildClient(true);
      const tx = await client.contribute(node, value);
      return jsonSafe({ tx, node, value: value.toString() });
    }

    case "disco.harvest": {
      const node = String(payload.node ?? "") as Address;
      const periodId = BigInt(String(payload.periodId ?? "0"));
      const client = await buildClient(true);
      const tx = await client.harvest(node, periodId);
      return jsonSafe({ tx, node, periodId: periodId.toString() });
    }

    case "disco.distribute": {
      const periodId = BigInt(String(payload.periodId ?? "0"));
      const client = await buildClient(true);
      const tx = await client.distribute(periodId);
      return jsonSafe({ tx, periodId: periodId.toString() });
    }

    case "disco.scores": {
      const node = String(payload.node ?? "") as Address;
      const account = String(payload.account ?? "") as Address;
      const client = await buildClient(false);
      const res = await client.scores(node, account);
      return jsonSafe({
        node,
        account,
        love: res.love.toString(),
        care: res.care.toString(),
        currentPeriod: res.currentPeriod.toString(),
      });
    }

    case "disco.member.add": {
      const node = String(payload.node ?? "") as Address;
      const account = String(payload.account ?? "") as Address;
      const client = await buildClient(true);
      const tx = await client.addMember(node, account);
      return jsonSafe({ tx, node, account });
    }

    case "sign.payload": {
      const state = await storage.getState();
      if (!state.identity) throw new Error("Sin identidad");
      const scheme = String(payload.scheme ?? "secp256k1") as SignatureScheme;
      const message = String(payload.message ?? "");
      const encoding = (payload.encoding === "hex" ? "hex" : "utf8") as
        | "utf8"
        | "hex";
      if (!message) throw new Error("message requerido");

      if (scheme === "secp256k1") {
        return jsonSafe(
          await signPayload({
            scheme,
            message,
            encoding,
            evmPrivateKey: state.identity.privateKey,
          })
        );
      }
      if (!state.identity.mnemonic) {
        throw new Error(
          "Importa un mnemonic BIP39 para firmar sr25519/ed25519 (clave EVM sola no basta)"
        );
      }
      return jsonSafe(
        await signPayload({
          scheme,
          message,
          encoding,
          mnemonic: state.identity.mnemonic,
        })
      );
    }

    case "sign.extrinsic": {
      const state = await storage.getState();
      if (!state.identity?.mnemonic) {
        throw new Error("Mnemonic requerido para firmar extrinsics Substrate");
      }
      const scheme = (
        payload.scheme === "ed25519" ? "ed25519" : "sr25519"
      ) as "sr25519" | "ed25519";
      const payloadHex = String(payload.payloadHex ?? "") as Hex;
      if (!payloadHex) throw new Error("payloadHex requerido");
      return jsonSafe(
        await signSubstrateExtrinsicPayload({
          scheme,
          payloadHex,
          mnemonic: state.identity.mnemonic,
        })
      );
    }

    case "sign.verify": {
      const scheme = String(payload.scheme ?? "secp256k1") as SignatureScheme;
      return jsonSafe(
        await verifyPayload({
          scheme,
          message: String(payload.message ?? ""),
          encoding: payload.encoding === "hex" ? "hex" : "utf8",
          signature: String(payload.signature ?? "") as Hex,
          addressOrPublicKey: String(payload.addressOrPublicKey ?? ""),
        })
      );
    }

    case "wallet.addresses": {
      const state = await storage.getState();
      if (!state.identity) throw new Error("Sin identidad");
      return jsonSafe({
        did: state.identity.did,
        evm: state.identity.address,
        evmMappedAccountId32: state.identity.evmMappedAccountId32,
        sr25519: state.identity.substrate?.sr25519Address ?? null,
        ed25519: state.identity.substrate?.ed25519Address ?? null,
        hasMnemonic: Boolean(state.identity.mnemonic),
        network: state.settings.network,
        rpcUrl: state.settings.rpcUrl,
        substrateWsUrl: state.settings.substrateWsUrl ?? "",
        note: {
          secp256k1:
            "EVM txs + PVM (pallet-revive eth-rpc) + personal_sign EIP-191",
          sr25519: "Extrinsics / payloads Substrate nativos",
          ed25519: "Cadenas Substrate que usan ed25519",
        },
      });
    }

    case "rpc.ping":
      return jsonSafe(await pingDeployment());

    default:
      throw new Error(`Acción desconocida: ${action}`);
  }
}
