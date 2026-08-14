# did:peranto Method Specification

> Protocol overview: [protocolo-peranto.md](./protocolo-peranto.md).  
> DIF / W3C registration checklist: [dif-w3c-compliance.md](./dif-w3c-compliance.md).  
> Resolve performance / registry storage: [perf-rpc-did-resolve.md](./perf-rpc-did-resolve.md).  
> **Domain linkage / well-known (dapp “server cert”):** [well-known-did-configuration.md](./well-known-did-configuration.md).

| Field | Value |
|-------|--------|
| **Status** | Spec v0.2.2 |
| **Method name** | `peranto` |
| **DID Core** | Aims to satisfy Create, Read (Resolve), Update, Deactivate |
| **Author** | Peranto / cryptohumano |
| **Version** | `0.2.2` |
| **Date** | 2026-08-12 |

## Abstract

`did:peranto` is a W3C DID Core–oriented method anchored on EVM-compatible and PolkaVM (`pallet-revive`) networks. **Create is implicit**: any secp256k1 address is a DID; no on-chain registration is required for existence. Optional document enrichment (services, delegates, deactivate) lives in a registry inspired by [ERC-1056](https://eips.ethereum.org/EIPS/eip-1056). From **v0.2**, active attributes are also **stored on-chain** (enumerable) so resolve does not depend solely on `eth_getLogs` lookback. Credential schemas, attesters, and status registries are **companion** contracts and are **not** encoded in the DID string.

## Identifier syntax (ABNF)

```
peranto-did = "did:peranto:" network ":" address
network     = "paseo" / "hardhat" / "localhost"
              / "base" / "baseSepolia" / "arbitrum" / "arbitrumSepolia"
address     = "0x" 40HEXDIG
```

- `HEXDIG` is case-insensitive; resolvers **SHOULD** return EIP-55 checksummed addresses in the Document `id`.
- There is **no** `light` / `full` infix. An address with no registry writes still resolves to a **minimal** DID Document.

Examples:

- `did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF`
- `did:peranto:hardhat:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`

### Canonical networks

| `network` | Chain ID (`eip155`) | Role |
|-----------|---------------------|------|
| `paseo` | `420420417` | Primary public testnet (Polkadot Hub TestNet) |
| `hardhat` / `localhost` | `31337` | Local development |
| `base` / `baseSepolia` | `8453` / `84532` | Optional EVM targets |
| `arbitrum` / `arbitrumSepolia` | `42161` / `421614` | Optional EVM targets |

Unknown `network` tokens are **invalid** DIDs (resolver MUST fail resolution).

## DID Document (minimal + enriched)

### Minimal document (always)

Every valid `did:peranto` resolves at least to:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:peranto:paseo:0x…",
  "controller": "did:peranto:paseo:0x…",
  "verificationMethod": [{
    "id": "did:peranto:paseo:0x…#controller",
    "type": "EcdsaSecp256k1RecoveryMethod2020",
    "controller": "did:peranto:paseo:0x…",
    "blockchainAccountId": "eip155:420420417:0x…"
  }],
  "authentication": ["did:peranto:paseo:0x…#controller"],
  "assertionMethod": ["did:peranto:paseo:0x…#controller"]
}
```

`blockchainAccountId` MUST use the chain ID for the DID’s `network` token.

### Enrichment (optional on-chain) — v0.2

When a `DIDRegistry` (method v0.2+) is configured for that network, resolvers MUST:

1. Read `deactivated(address)`. If true, set `"deactivated": true` on the Document.
2. **Prefer storage:** enumerate `attributeCount` / `attributeNameAt` / `getAttribute`. For each name whose UTF-8 form starts with `did/svc/` and `active == true`, decode `value` and append to `service[]`. For `did/vm/*` (v0.2.1), decode purpose verification methods (see below).
3. **Fallback (legacy registries):** if storage reads are unavailable, collect `DIDAttributeChanged` events (lookback) and keep the latest write per name with `validTo > now`.
4. Enumerate active delegates via `delegateCount` / `delegateAt`. For each with `validTo > now`, append a verification method and relationships (below).

**Service attribute convention**

| Field | Rule |
|-------|------|
| On-chain `name` | `did/svc/<Type>` or `did/svc/<Type>.<slot>` as bytes32 (ASCII, ≤32 bytes) |
| On-chain `value` | UTF-8 JSON `{ "id"?, "type", "serviceEndpoint", "name"? }` or plain UTF-8 endpoint string |
| `validity` | Seconds from `now` at write time; `0` clears storage and expires |

**Recommended service types**

| `type` | Attribute name example | Purpose |
|--------|------------------------|---------|
| `LinkedDomains` | `did/svc/LinkedDomain` | Claimed HTTPS origin(s) for the DID (discovery hint) |
| `Website` | `did/svc/Website` / `did/svc/Website.blog` | Public web endpoints |

`LinkedDomains` alone is **not** proof of domain control. Wallets that mediate dapp credential APIs MUST verify [Well-Known DID Configuration](./well-known-did-configuration.md) (DomainLinkageCredential at `/.well-known/did-configuration.json`) before treating the origin as bound to the DID.

### Delegates → Document relationships (v0.2)

| On-chain `delegateType` (bytes32 ASCII) | Document effect | On-chain write power |
|-----------------------------------------|-----------------|----------------------|
| `sigAuth` | VM + `authentication` | none (keys only) |
| `veriKey` | VM + `assertionMethod` | none (keys only) |
| `svc` | VM + `capabilityInvocation` | `setAttribute` only if name starts with `did/svc/` |

- Delegate VMs use `EcdsaSecp256k1RecoveryMethod2020` and `blockchainAccountId` for the delegate address.
- Fragment ids: `#delegate-<type>-<addr8>` (implementation MAY vary; MUST be stable per resolve).
- `changeOwner` / `addDelegate` / `revokeDelegate` / `deactivate` remain **owner-only**.

### Purpose keys (v0.2.1)

**Controller ≠ deployer.** The registry deployer has no privilege over foreign identities. Each address is an implicit DID; only `identityOwner(identity)` (default: the identity itself) may publish purpose keys.

Optional owner-written attributes enrich authentication / assertion / keyAgreement without changing the DID id (still index 0):

| On-chain `name` | Document effect |
|-----------------|-----------------|
| `did/vm/authentication` | VM `#key-authentication` + `authentication[]` (controller remains) |
| `did/vm/assertionMethod` | VM `#key-assertion`; `assertionMethod` prefers this over `#controller` |
| `did/vm/keyAgreement` | VM `#key-agreement` + `keyAgreement[]` (`X25519KeyAgreementKey2020`) |

**Hard derivation paths** (BIP39 mnemonic shared with the controller):

| Path / URI | Role |
|------------|------|
| `m/44'/60'/0'/0/0` | Controller / DID address / gas |
| `m/44'/60'/0'/0/1` | Authentication (secp256k1) |
| `m/44'/60'/0'/0/2` | Assertion / JWT-VC ES256K (secp256k1) |
| `{mnemonic}//did//keyAgreement//0` | Ed25519 → X25519 keyAgreement |

Value encoding: UTF-8 JSON with `id`, `type`, and either `blockchainAccountId` (secp) or `publicKeyJwk` / `publicKeyMultibase` (X25519). `svc` delegates **MUST NOT** write `did/vm/*`.

Names (`NameRegistry`) and credential anchors are **not** part of the DID Document.

## Operations (DID Core mapping)

### Create

1. Generate a secp256k1 key pair.
2. Derive the 20-byte account address.
3. Form `did:peranto:<network>:<address>`.

**No transaction.** Cost: 0 gas. The DID exists conceptually before any registry write.

### Read (Resolve)

1. Parse and validate syntax + known `network`.
2. Build the minimal Document.
3. If registry available: apply deactivate + **storage-first** services + purpose VMs (`did/vm/*`) + active delegates.
4. Return Document (or DID Resolution Result — see driver).

**Errors**

| Condition | HTTP (driver) | Notes |
|-----------|---------------|--------|
| Malformed DID / unknown network | `400` | `didResolutionMetadata.error` = `invalidDid` |
| Registry / RPC unreachable | `500` / `503` | `internalError` / `notFound` as appropriate |
| Valid DID, no enrichment | `200` | Minimal Document (not an error) |

### Update

Only the current `identityOwner(identity)` may:

- `changeOwner`
- `addDelegate` / `revokeDelegate`
- `setAttribute` for **any** attribute name
- `deactivate`

Additionally, a **valid `svc` delegate** may call `setAttribute` when the attribute name starts with `did/svc/`.

### Deactivate

`DIDRegistry.deactivate(identity)` — owner only. Further updates revert. Resolve returns `deactivated: true`. Deactivation is **not** reversible in v0.2.

## Paseo deployment (reference)

Public Hub TestNet addresses used by the reference implementation / Universal Resolver driver are published in `packages/web/public/deployments/paseo.json` after each redeploy. See [paseo-deploy.md](./paseo-deploy.md) (incl. pre-redeploy DisCO dissolve checklist).

## Security considerations

- Control of the DID equals control of the secp256k1 private key (or current owner after `changeOwner`).
- `svc` delegates can update public service endpoints — treat them as high privilege; prefer short validity.
- Attester stake and credential status are separate from DID existence.
- Do not put PII in on-chain attributes or events.
- v0.2 storage removes lookback omission for attributes written after the upgrade; legacy event-only registries remain best-effort within RPC lookback.
- **Domain linkage (v0.2.2):** dapps and attester UIs that talk to Aura MUST publish DIF Well-Known DID Configuration; wallets MUST fail closed on sensitive APIs if verification fails. See [well-known-did-configuration.md](./well-known-did-configuration.md).

## Companion registries (out of DID Document)

| Contract | Role |
|----------|------|
| `SchemaRegistry` | Credential type definitions |
| `AttesterRegistry` | Stake-gated issuers |
| `CredentialStatusRegistry` | Anchor / revoke credential hashes |
| `NameRegistry` | Human labels → address (optional alias) |
| `ProtocolTreasury` / `DisCONode` | Cooperative economy (not DID Core) |

## Reference implementation

| Component | Location |
|-----------|----------|
| Spec (this document) | `docs/did-peranto-method.md` |
| Domain linkage profile | `docs/well-known-did-configuration.md` |
| SDK resolve | `@peranto/sdk` → `PerantoClient.resolveDid` |
| DIF-compatible driver | `packages/uni-resolver-driver-did-peranto` |
| Portal | `packages/web` |

## Compliance checklist (DID Core method)

| Requirement | Status in v0.2 |
|-------------|----------------|
| Method-specific identifier syntax | Defined (ABNF) |
| Create | Implicit (key → DID) |
| Read / Resolve | Minimal Doc + storage services + delegates |
| Update | Owner + scoped `svc` delegate for services |
| Deactivate | `deactivate` + flag on resolve |
| Security considerations | Documented |
| Domain linkage (dapp origin) | Profile in [well-known-did-configuration.md](./well-known-did-configuration.md) |

**Out of scope of “method compliance”:** listing in W3C DID Method Registry and DIF Universal Resolver (see [dif-w3c-compliance.md](./dif-w3c-compliance.md)).

## Changelog

- **0.2.2** (2026-08-12) — Recommended `LinkedDomains` service; normative Well-Known DID Configuration profile for Aura/dapp trust (DIF DomainLinkageCredential).
- **0.2.1** (2026-07-17) — Purpose keys: `did/vm/*` attrs; BIP44 paths `…/0|1|2` + hard URI keyAgreement; Document `keyAgreement`; JWT-VC may sign with assertion key (`kid`).
- **0.2** (2026-07-17) — On-chain attribute storage + enumerable delegates; `svc` / `sigAuth` / `veriKey` scopes; Document `capabilityInvocation`; resolve prefers storage over event lookback.
- **0.1** (2026-07-15) — First public method spec: networks, Document shape, Paseo registry, CRUD mapping, driver pointer.
