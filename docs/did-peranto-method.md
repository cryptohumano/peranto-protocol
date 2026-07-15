# did:peranto Method Specification

> Protocol overview: [protocolo-peranto.md](./protocolo-peranto.md).  
> DIF / W3C registration checklist: [dif-w3c-compliance.md](./dif-w3c-compliance.md).

| Field | Value |
|-------|--------|
| **Status** | Spec v0.1 |
| **Method name** | `peranto` |
| **DID Core** | Aims to satisfy Create, Read (Resolve), Update, Deactivate |
| **Author** | Peranto / cryptohumano |
| **Version** | `0.1` |
| **Date** | 2026-07-15 |

## Abstract

`did:peranto` is a W3C DID Core–oriented method anchored on EVM-compatible and PolkaVM (`pallet-revive`) networks. **Create is implicit**: any secp256k1 address is a DID; no on-chain registration is required for existence. Optional document enrichment (services, deactivate) lives in a registry inspired by [ERC-1056](https://eips.ethereum.org/EIPS/eip-1056). Credential schemas, attesters, and status registries are **companion** contracts and are **not** encoded in the DID string.

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

### Canonical networks (v0.1)

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

### Enrichment (optional on-chain)

When a `DIDRegistry` is configured for that network, resolvers MUST:

1. Read `deactivated(address)`. If true, set `"deactivated": true` on the Document (and in DID Document Metadata when using DID Resolution Result).
2. Collect recent `DIDAttributeChanged` events for `identity = address` whose attribute `name` (bytes32 → ASCII, right-trimmed) starts with `did/svc/`.
3. For each distinct attribute name, keep the **latest** write. If `validTo > now`, decode `value` and append to `service[]`.

**Service attribute convention**

| Field | Rule |
|-------|------|
| On-chain `name` | `did/svc/<Type>` or `did/svc/<Type>.<slot>` as bytes32 (ASCII, ≤32 bytes) |
| On-chain `value` | UTF-8 JSON `{ "id"?, "type", "serviceEndpoint" }` or plain UTF-8 endpoint string |
| `validity` | Seconds from `now` at write time; `0` clears / expires |

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
3. If registry available: apply deactivate flag + active services.
4. Return Document (or DID Resolution Result — see driver).

**Errors**

| Condition | HTTP (driver) | Notes |
|-----------|---------------|--------|
| Malformed DID / unknown network | `400` | `didResolutionMetadata.error` = `invalidDid` |
| Registry / RPC unreachable | `500` / `503` | `internalError` / `notFound` as appropriate |
| Valid DID, no enrichment | `200` | Minimal Document (not an error) |

### Update

Only the current `identityOwner(identity)` may:

- `setAttribute` (including services under `did/svc/…`)
- `changeOwner`
- `addDelegate` / `revokeDelegate`

### Deactivate

`DIDRegistry.deactivate(identity)` — owner only. Further updates revert. Resolve returns `deactivated: true`. Deactivation is **not** reversible in v0.1.

## Paseo deployment (v0.1 reference)

Public Hub TestNet addresses used by the reference implementation / Universal Resolver driver:

| Contract | Address |
|----------|---------|
| `DIDRegistry` | `0x4beb3BF860f99F00C2eEDc13731948F39aAdc001` |
| RPC (default) | `https://eth-rpc-testnet.polkadot.io/` |

Deployment JSON (portal / driver): `packages/web/public/deployments/paseo.json`.

## Security considerations

- Control of the DID equals control of the secp256k1 private key (or current owner after `changeOwner`).
- Attester stake and credential status are separate from DID existence.
- Do not put PII in on-chain attributes or events.
- Resolvers limited by RPC `eth_getLogs` lookback may temporarily omit older services; clients SHOULD treat service lists as best-effort within the lookback window.

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
| SDK resolve | `@peranto/sdk` → `PerantoClient.resolveDid` |
| DIF-compatible driver | `packages/uni-resolver-driver-did-peranto` |
| Portal | `packages/web` |

## Compliance checklist (DID Core method)

| Requirement | Status in v0.1 |
|-------------|----------------|
| Method-specific identifier syntax | Defined (ABNF) |
| Create | Implicit (key → DID) |
| Read / Resolve | Minimal Doc + registry enrichment |
| Update | Owner `setAttribute` / ownership / delegates |
| Deactivate | `deactivate` + flag on resolve |
| Security considerations | Documented |

**Out of scope of “method compliance”:** listing in W3C DID Method Registry and DIF Universal Resolver (see [dif-w3c-compliance.md](./dif-w3c-compliance.md)).

## Changelog

- **0.1** (2026-07-15) — First public method spec: networks, Document shape, Paseo registry, CRUD mapping, driver pointer.
