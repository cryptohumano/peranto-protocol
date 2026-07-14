# did:peranto Method Specification (Draft)

> Visión de protocolo y glosario: [protocolo-peranto.md](./protocolo-peranto.md).

**Status:** Implementer's Draft  
**Method name:** `peranto`  
**Author:** Peranto  

## Abstract

`did:peranto` is a W3C DID Core compatible method anchored on EVM-compatible / PolkaVM (`pallet-revive`) networks. Create is **implicit** (any secp256k1 address is a DID). Optional on-chain state lives in a DID registry inspired by [ERC-1056](https://eips.ethereum.org/EIPS/eip-1056). Credential schemas, stake-gated attesters, and credential status are companion contracts — not part of the DID string.

## Identifier syntax (ABNF)

```
peranto-did = "did:peranto:" network ":" address
network     = "hardhat" / "localhost" / "paseo" / 1*(ALPHA / DIGIT / "-")
address     = "0x" 40HEXDIG
```

Examples:

- `did:peranto:paseo:0xAbC...`
- `did:peranto:hardhat:0x123...`

There is **no** `light` infix. An address with no registry writes still resolves to a minimal DID Document (equivalent conceptually to KILT light DIDs).

## Operations

### Create

Generate a secp256k1 key pair → derive Ethereum/`AccountId20` address → form the DID. **No transaction.** Cost: 0.

### Read (Resolve)

1. Parse network + address.
2. Build minimal DID Document with `EcdsaSecp256k1RecoveryMethod2020` and `blockchainAccountId` = `eip155:<chainId>:<address>`.
3. If `DIDRegistry.deactivated(address)`, set `deactivated: true`.
4. Optional enrichment: consume `DIDAttributeChanged` / `DIDDelegateChanged` events for services and extra keys (SDK MVP returns minimal + deactivated flag).

### Update

Only `identityOwner(identity)` may:

- `changeOwner`
- `addDelegate` / `revokeDelegate`
- `setAttribute`

### Deactivate

`DIDRegistry.deactivate(identity)` — owner only. Resolve returns `deactivated: true`. Further updates revert.

## Security considerations

- Control of the DID equals control of the secp256k1 private key (or current owner after `changeOwner`).
- Attester stake and credential anchors are **separate** from DID existence.
- Hash-anchored credentials leak `credHash`, attester, subject, and schema on-chain — do not put PII in events.

## Relationship to companion registries

| Contract | Role |
|----------|------|
| `DIDRegistry` | Identity document enrichment |
| `SchemaRegistry` | Immutable credential type definitions |
| `AttesterRegistry` | `stakeAndJoin` / authorization per schema |
| `CredentialStatusRegistry` | Anchor / revoke credential hashes |
| `NameRegistry` | Optional human labels (`ecolab` → address / DID); not part of DID syntax |

## Compliance note

This method aims for **DID Core** method requirements (Create/Read/Update/Deactivate + Document). Listing in W3C DID Extensions is optional and separate from compliance.
