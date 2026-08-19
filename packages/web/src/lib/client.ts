import {
  PerantoClient,
  IndexedDbVault,
  vaultIdFromHash,
  didRegistryAbi,
  parseDid,
  resolveDidDocument,
  type VaultCredential,
  type ContractAddresses,
  type PerantoNetwork,
  type IssuedCredential,
  type DidDocument,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";
import {
  DEFAULT_NETWORK,
  DEFAULT_RPC,
  PASEO_RPC_URLS,
  deploymentToAddresses,
  loadPaseoDeployment,
} from "./deployment";
import { loadSession, type SessionIdentity } from "./session";
import {
  clearDidSyncState,
  forgetDidService,
  mergeDidDocumentServices,
  readDidSyncState,
  rememberDidService,
  syncStateToServices,
  writeDidSyncState,
} from "./did-service-cache";

let cachedAddresses: ContractAddresses | null = null;

export async function getAddresses(): Promise<ContractAddresses> {
  if (cachedAddresses) return cachedAddresses;
  const d = await loadPaseoDeployment();
  cachedAddresses = deploymentToAddresses(d);
  return cachedAddresses;
}

export async function getReadClient(network: PerantoNetwork = DEFAULT_NETWORK) {
  const addresses = await getAddresses();
  return new PerantoClient({ network, addresses, rpcUrl: PASEO_RPC_URLS });
}

/** Local HD path — requires private key in session. */
export async function getWriteClient(session?: SessionIdentity | null) {
  const s = session ?? loadSession();
  if (!s?.privateKey || s.privateKey.length < 10) {
    throw new Error("Sesión HD local sin clave");
  }
  const addresses = await getAddresses();
  return new PerantoClient({
    network: DEFAULT_NETWORK,
    addresses,
    rpcUrl: PASEO_RPC_URLS,
    privateKey: s.privateKey,
    mnemonic: s.mnemonic,
  });
}

export const vault = new IndexedDbVault();

export async function saveJwtToVault(issued: {
  jwt: string;
  credHash: `0x${string}`;
  schemaKey: string;
  subjectDid: string;
  issuerDid: string;
  label?: string;
}): Promise<VaultCredential> {
  const entry: VaultCredential = {
    id: vaultIdFromHash(issued.credHash),
    jwt: issued.jwt,
    credHash: issued.credHash,
    schemaKey: issued.schemaKey,
    subjectDid: issued.subjectDid,
    issuerDid: issued.issuerDid,
    storedAt: new Date().toISOString(),
    label: issued.label ?? issued.schemaKey,
  };
  await vault.put(entry);
  return entry;
}

declare global {
  interface Window {
    aura?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isAura?: boolean;
    };
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isAura?: boolean;
    };
  }
}

export function getAuraProvider() {
  return window.aura ?? (window.ethereum?.isAura ? window.ethereum : null);
}

export async function connectAura(): Promise<string[]> {
  const provider = getAuraProvider();
  if (!provider) throw new Error("Aura Wallet no detectada. Instala la extensión.");
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  return accounts;
}

export async function fetchAuraVault(): Promise<VaultCredential[]> {
  const provider = getAuraProvider();
  if (!provider) return [];
  try {
    const list = (await provider.request({
      method: "wallet_getCredentials",
    })) as Array<{
      id: string;
      jwt: string;
      credHash: `0x${string}`;
      schemaKey: string;
      issuerDid: string;
      subjectDid: string;
      label?: string;
      savedAt?: string;
    }>;
    return list.map((c) => ({
      id: c.id,
      jwt: c.jwt,
      credHash: c.credHash,
      schemaKey: c.schemaKey,
      issuerDid: c.issuerDid,
      subjectDid: c.subjectDid,
      storedAt: c.savedAt ?? new Date().toISOString(),
      label: c.label,
    }));
  } catch {
    return [];
  }
}

/**
 * Dual path:
 * - Aura session → firma en la extensión (`peranto_action`), clave nunca sale.
 * - HD / import local → PerantoClient en el portal (PWA/TUI).
 *
 * Before Aura writes, sync network + addresses from the portal deployment so we
 * never send txs to a leftover Hardhat NameRegistry while the UI reads Paseo.
 */
export async function ensureAuraMatchesPortal(): Promise<void> {
  const provider = getAuraProvider();
  if (!provider) return;
  const addresses = await getAddresses();
  await provider.request({
    method: "peranto_action",
    params: [
      "settings.sync",
      {
        network: DEFAULT_NETWORK,
        rpcUrl: DEFAULT_RPC,
        addresses,
      },
    ],
  });
}

export async function auraAction<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const provider = getAuraProvider();
  if (!provider) throw new Error("Aura no disponible");
  if (action !== "settings.sync") {
    await ensureAuraMatchesPortal();
  }
  try {
    return (await provider.request({
      method: "peranto_action",
      params: [action, payload],
    })) as T;
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e && "message" in e
          ? String((e as { message?: unknown }).message)
          : String(e);
    // El build de Aura sin esta acción responde desde el `default` de runAction.
    if (/acci[oó]n desconocida/i.test(msg)) {
      throw new Error(
        `Aura desactualizada: no conoce la acción “${action}”. Recárgala en ` +
          `chrome://extensions o entra con sesión HD (mnemonic) para firmar desde el portal.`
      );
    }
    throw e;
  }
}

function writeMode(session?: SessionIdentity | null): "aura" | "hd" {
  const s = session ?? loadSession();
  if (!s) throw new Error("Sin sesión");
  if (s.source === "aura") return "aura";
  if (s.privateKey && s.privateKey.length >= 10) return "hd";
  if (getAuraProvider()) return "aura";
  throw new Error("Sin vía de firma: importa HD o conecta Aura");
}

export async function portalRegisterName(
  label: string,
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    return auraAction<{ label: string; txHash: Hex }>("name.register", { label });
  }
  const client = await getWriteClient(session);
  return client.registerName(label);
}

export async function portalReleaseName(
  label: string,
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    return auraAction<{ tx: Hex; label: string }>("name.release", { label });
  }
  const client = await getWriteClient(session);
  return client.releaseName(label);
}

export async function portalSetDidService(
  type: string,
  serviceEndpoint: string,
  session?: SessionIdentity | null,
  key?: string,
  name?: string
) {
  const s = session ?? loadSession();
  const attrKey = key?.trim() ? `${type.trim()}.${key.trim()}` : type.trim();
  const display = name?.trim() || key?.trim() || undefined;
  if (writeMode(s) === "aura") {
    const res = await auraAction<unknown>("did.setService", {
      type,
      serviceEndpoint,
      key,
      name: display,
    });
    // Aura builds sin soporte de slot firman `did/svc/Type` e ignoran `key`:
    // el eco del payload es la única señal antes de leer la cadena.
    const echoed =
      res && typeof res === "object" && "key" in res
        ? String((res as { key?: unknown }).key ?? "").trim()
        : undefined;
    const wanted = key?.trim() ?? "";
    const droppedSlot =
      Boolean(wanted) && echoed !== undefined && echoed !== wanted;
    const writtenAttrKey = droppedSlot ? type.trim() : attrKey;
    try {
      const addresses = await getAddresses();
      if (s?.did) {
        rememberDidService(addresses.DIDRegistry, s.did, {
          id: `${s.did}#service-${writtenAttrKey}`,
          type,
          serviceEndpoint,
          attrKey: writtenAttrKey,
          name: droppedSlot ? undefined : display,
        });
      }
    } catch {
      /* cache best-effort */
    }
    if (droppedSlot) {
      throw new Error(
        `Aura desactualizada: firmó did/svc/${type.trim()} sin el slot “.${wanted}”. ` +
          `Abre chrome://extensions, recarga Aura y vuelve a publicar.`
      );
    }
    return res;
  }
  const client = await getWriteClient(s);
  const out = await client.setDidService({
    type,
    serviceEndpoint,
    key,
    name: display,
  });
  try {
    const addresses = await getAddresses();
    if (s?.did) {
      rememberDidService(addresses.DIDRegistry, s.did, {
        id: `${s.did}#service-${attrKey}`,
        type,
        serviceEndpoint,
        attrKey,
        name: display,
      });
    }
  } catch {
    /* cache best-effort */
  }
  return out;
}

export async function portalAddDidDelegate(
  delegateType: string,
  delegate: Address,
  validitySeconds: bigint,
  session?: SessionIdentity | null
) {
  const s = session ?? loadSession();
  if (writeMode(s) === "aura") {
    return auraAction("did.addDelegate", {
      delegateType,
      delegate,
      validitySeconds: validitySeconds.toString(),
    });
  }
  const client = await getWriteClient(s);
  return client.addDelegate({
    delegateType,
    delegate,
    validitySeconds,
  });
}

/**
 * ¿La identidad de Aura tiene mnemonic BIP39 (única vía para purpose keys)?
 * `null` cuando Aura no responde o el build no expone `wallet.addresses`.
 */
export async function portalAuraHasMnemonic(): Promise<boolean | null> {
  try {
    const res = await auraAction<{ hasMnemonic?: unknown }>(
      "wallet.addresses",
      {}
    );
    return typeof res?.hasMnemonic === "boolean" ? res.hasMnemonic : null;
  } catch {
    return null;
  }
}

export async function portalPublishPurposeKeys(
  session?: SessionIdentity | null
) {
  const s = session ?? loadSession();
  if (writeMode(s) === "aura") {
    try {
      return await auraAction<{ hashes: Hex[]; did: string }>(
        "did.publishPurposeKeys",
        {}
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/mnemonic/i.test(msg)) {
        throw new Error(
          "Aura firma esta acción, pero su identidad se importó con clave privada " +
            "y sin mnemonic BIP39 no hay derivación. Importa tu frase en Aura, o entra " +
            "al portal con “Importar mnemonic” para firmar localmente."
        );
      }
      throw e;
    }
  }
  if (!s?.mnemonic) {
    throw new Error(
      "Publicar claves de propósito requiere mnemonic BIP39 (no solo clave EVM)"
    );
  }
  const client = await getWriteClient(s);
  return client.publishPurposeKeysFromMnemonic(s.mnemonic);
}

export async function portalRevokeDidDelegate(
  delegateType: string,
  delegate: Address,
  session?: SessionIdentity | null
) {
  const s = session ?? loadSession();
  if (writeMode(s) === "aura") {
    return auraAction("did.revokeDelegate", {
      delegateType,
      delegate,
    });
  }
  const client = await getWriteClient(s);
  return client.revokeDelegate({ delegateType, delegate });
}

export async function portalClearDidService(
  typeOrAttrKey: string,
  session?: SessionIdentity | null,
  key?: string
) {
  const s = session ?? loadSession();
  const attrKey =
    key !== undefined
      ? `${typeOrAttrKey}.${key}`
      : typeOrAttrKey.includes(".")
        ? typeOrAttrKey
        : typeOrAttrKey;
  if (writeMode(s) === "aura") {
    const res = await auraAction("did.clearService", {
      type: typeOrAttrKey,
      key,
      attrKey: key === undefined ? typeOrAttrKey : undefined,
    });
    try {
      const addresses = await getAddresses();
      if (s?.did) forgetDidService(addresses.DIDRegistry, s.did, attrKey);
    } catch {
      /* ignore */
    }
    return res;
  }
  const client = await getWriteClient(s);
  let out;
  if (key !== undefined) {
    out = await client.clearDidService(typeOrAttrKey, key);
  } else if (typeOrAttrKey.includes(".")) {
    out = await client.clearDidServiceByAttrKey(typeOrAttrKey);
  } else {
    out = await client.clearDidService(typeOrAttrKey);
  }
  try {
    const addresses = await getAddresses();
    if (s?.did) forgetDidService(addresses.DIDRegistry, s.did, attrKey);
  } catch {
    /* ignore */
  }
  return out;
}

export async function portalResolveDid(
  did: string,
  opts?: {
    useCache?: boolean;
    /** Ignore sync cursor; full lookback. */
    forceCold?: boolean;
    /** Override cold lookback (blocks). Used by public pages. */
    lookback?: bigint;
    /**
     * Public linktr33 path: v0.2 storage only (no eth_getLogs).
     * Fast cold resolve for `/u/:ref`.
     */
    storageOnly?: boolean;
  }
): Promise<DidDocument> {
  const client = await getReadClient();

  // Public profile: storage-first, never scan logs.
  if (opts?.storageOnly) {
    return client.resolveDid(did, { storageOnly: true });
  }

  // Public / foreign resolve: wide cold lookback, then re-attach this-browser
  // `recent` publishes (owner preview) without resurrecting full historical cache.
  if (opts?.useCache === false) {
    const doc = await client.resolveDid(did, {
      lookback: opts.lookback ?? 2_000_000n,
      chunkSize: 4_000n,
      concurrency: 8,
    });
    try {
      const addresses = await getAddresses();
      return mergeDidDocumentServices(addresses.DIDRegistry, doc);
    } catch {
      return doc;
    }
  }

  try {
    const addresses = await getAddresses();
    const registry = addresses.DIDRegistry;
    const { address } = parseDid(did);

    if (opts?.forceCold) {
      clearDidSyncState(registry, did);
    }

    const prev = opts?.forceCold ? null : readDidSyncState(registry, did);

    const collectOpts = prev?.syncedToBlock
      ? {
          fromBlock: BigInt(prev.syncedToBlock) + 1n,
          seedServices: syncStateToServices(did, prev),
          chunkSize: 4_000n,
          concurrency: 3,
        }
      : {
          lookback: opts?.lookback ?? 2_000_000n,
          chunkSize: 4_000n,
          concurrency: 3,
        };

    const [deactivated, collected, delegates] = await Promise.all([
      client.publicClient.readContract({
        address: registry,
        abi: didRegistryAbi,
        functionName: "deactivated",
        args: [address],
      }),
      client.collectDidServices(did, address, collectOpts),
      client.collectDidDelegates(address),
    ]);

    // Sync snapshot is authoritative for the editor — overwrite cache.
    writeDidSyncState(
      registry,
      did,
      collected.syncedToBlock,
      collected.services
    );
    const doc = resolveDidDocument(
      did,
      Boolean(deactivated),
      collected.services,
      delegates,
      collected.purposeVms
    );
    // Only re-attach this-session publishes the RPC may have missed — never
    // the full historical cache (that resurrected deleted linktr33 links).
    return mergeDidDocumentServices(registry, doc);
  } catch {
    const doc = await client.resolveDid(did);
    try {
      const addresses = await getAddresses();
      return mergeDidDocumentServices(addresses.DIDRegistry, doc);
    } catch {
      return doc;
    }
  }
}

export async function portalResolveName(label: string) {
  const client = await getReadClient();
  return client.resolveName(label);
}

/** Accepts `@name`, DID, or 0x address. */
export async function portalResolveIdentityRef(ref: string) {
  const client = await getReadClient();
  return client.resolveIdentityRef(ref);
}

export async function portalDeactivateDid(session?: SessionIdentity | null) {
  if (writeMode(session) === "aura") {
    return auraAction("did.deactivate", {});
  }
  const client = await getWriteClient(session);
  return client.deactivateDid();
}

export async function portalDissolveNode(
  node: Address,
  residualTo?: Address,
  revokeCredHashes?: Hex[],
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    return auraAction("disco.dissolve", {
      node,
      residualTo,
      revokeCredHashes,
    });
  }
  const client = await getWriteClient(session);
  return client.dissolveNode(node, residualTo, { revokeCredHashes });
}

export async function portalStakeAndJoin(
  schemaKey: string,
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    return auraAction<{ schemaId: Hex; txHash: Hex; stake: string }>(
      "attester.join",
      { schemaKey }
    );
  }
  const client = await getWriteClient(session);
  return client.stakeAndJoin(schemaKey);
}

export async function portalRevoke(
  credHash: Hex,
  reason: string,
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    return auraAction<{ txHash: Hex }>("vc.revoke", { credHash, reason });
  }
  const client = await getWriteClient(session);
  return client.revoke(credHash, reason);
}

export async function portalIssueClaims(
  subject: Address,
  claims: Record<string, unknown>,
  schemaKey: string,
  credentialType?: string,
  session?: SessionIdentity | null
): Promise<IssuedCredential & { anchorTx?: Hex }> {
  if (writeMode(session) === "aura") {
    return auraAction("vc.issueClaims", {
      subject,
      claims,
      schemaKey,
      credentialType,
      label: schemaKey,
    });
  }
  const client = await getWriteClient(session);
  return client.issueAndAnchorClaims(subject, claims, schemaKey, credentialType);
}

export async function portalRegisterSchema(
  schemaKey: string,
  schemaBody: string,
  uri: string,
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    // registerSchema is not a dedicated action yet — use HD or add later
    throw new Error(
      "registerSchema desde Aura: usa el popup de Aura o sesión HD (gobernanza)"
    );
  }
  const client = await getWriteClient(session);
  return client.registerSchema(schemaKey, schemaBody, uri);
}

export async function portalCreateNode(
  name: string,
  session?: SessionIdentity | null,
  opts?: { seedEther?: string; reserveFloorEther?: string }
) {
  const seedWei =
    opts?.seedEther && Number(opts.seedEther) > 0
      ? (await import("viem")).parseEther(opts.seedEther)
      : 0n;
  const reserveFloor =
    opts?.reserveFloorEther !== undefined && opts.reserveFloorEther !== ""
      ? (await import("viem")).parseEther(opts.reserveFloorEther)
      : undefined;

  if (writeMode(session) === "aura") {
    return auraAction<{
      node: Address;
      name: string;
      txHash: Hex;
      seedWei?: string;
      fundTx?: Hex;
    }>("disco.create", {
      name,
      seed: opts?.seedEther ?? "0",
      reserveFloor: opts?.reserveFloorEther,
    });
  }
  const client = await getWriteClient(session);
  return client.createNode(name, { seedWei, reserveFloor });
}

export async function portalAddMember(
  node: Address,
  account: Address,
  session?: SessionIdentity | null
) {
  if (writeMode(session) === "aura") {
    return auraAction("disco.member.add", { node, account });
  }
  const client = await getWriteClient(session);
  return client.addMember(node, account);
}

export async function portalTip(
  node: Address,
  to: Address,
  valueEther: string,
  session?: SessionIdentity | null,
  token: Address = "0x0000000000000000000000000000000000000000",
  decimals = 18
) {
  const { parseUnits } = await import("viem");
  const amount = valueEther.includes(".")
    ? parseUnits(valueEther, decimals)
    : parseUnits(valueEther, decimals);
  if (writeMode(session) === "aura") {
    // Aura tip path still uses ether-style string for native; pass token for multi-token deploys.
    return auraAction("disco.tip", {
      node,
      to,
      value: amount.toString(),
      token,
    });
  }
  const client = await getWriteClient(session);
  return client.tip(node, to, amount, token);
}

/** Nodes where `account` is a member (for public tip / Love). */
export async function portalListMembershipNodes(account: Address) {
  const client = await getReadClient();
  return client.listMembershipNodes(account);
}

export async function portalContribute(
  node: Address,
  valueEther: string,
  session?: SessionIdentity | null,
  token: Address = "0x0000000000000000000000000000000000000000",
  decimals = 18
) {
  const { parseUnits } = await import("viem");
  const amount = parseUnits(valueEther, decimals);
  if (writeMode(session) === "aura") {
    return auraAction("disco.contribute", {
      node,
      value: amount.toString(),
      token,
    });
  }
  const client = await getWriteClient(session);
  return client.contribute(node, amount, token);
}

/** Native PAS/ETH transfer between EOAs (not a DisCO tip). */
export async function portalSendNative(
  to: Address,
  valueEther: string,
  session?: SessionIdentity | null
): Promise<Hex> {
  const s = session ?? loadSession();
  if (!s) throw new Error("Sin sesión");
  const { parseEther, createWalletClient, createPublicClient, parseGwei } =
    await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { createRpcTransport } = await import("@peranto/sdk");
  const value = parseEther(valueEther);
  if (value <= 0n) throw new Error("Monto debe ser > 0");

  if (writeMode(s) === "aura") {
    await ensureAuraMatchesPortal();
    const provider = getAuraProvider();
    if (!provider) throw new Error("Aura no disponible");
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    const from = accounts[0];
    if (!from) throw new Error("Aura sin cuentas");
    const txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to,
          value: `0x${value.toString(16)}`,
        },
      ],
    })) as Hex;
    return txHash;
  }

  if (!s.privateKey || s.privateKey.length < 10) {
    throw new Error("Sesión HD local sin clave");
  }
  const account = privateKeyToAccount(s.privateKey);
  const chain = {
    id: 420420417,
    name: "Polkadot Hub TestNet",
    nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
    rpcUrls: { default: { http: [...PASEO_RPC_URLS] } },
  } as const;
  const transport = createRpcTransport(PASEO_RPC_URLS);
  const wallet = createWalletClient({
    account,
    chain,
    transport,
  });
  const publicClient = createPublicClient({
    chain,
    transport,
  });
  const hash = await wallet.sendTransaction({
    to,
    value,
    // Paseo eth-rpc often rejects low priority tips
    maxPriorityFeePerGas: parseGwei("30"),
    maxFeePerGas: parseGwei("60"),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
