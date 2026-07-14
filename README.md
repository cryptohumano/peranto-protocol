# did:peranto — Eco-testing DID + VC (EVM / PVM)

Decentralized identifiers (`did:peranto`) and verifiable credentials with on-chain **schemas**, **stake-gated attesters**, and **credential status**, targeting local Hardhat and **Paseo** (Polkadot Hub TestNet, chain id `420420417`).

**Protocolo / whitepaper + glosario:** [docs/protocolo-peranto.md](docs/protocolo-peranto.md)

## Quick start

```bash
npm install
npm run compile
npm test
```

Deploy locally (in-process Hardhat network writes `deployments/31337.json` when using a persistent node — for scripted deploy against the transient network, run a local node):

```bash
# Terminal A
npx hardhat node

# Terminal B
npm run deploy:local
# → deployments/31337.json
```

Or run the in-memory deploy used by tests via:

```bash
npx hardhat run scripts/deploy.ts
```

### CLI demo

```bash
# Create identities
npm run cli -- did create --network hardhat

# Join as attester for EcoTestResult (needs deployed AttesterRegistry)
export PERANTO_KEY=0x...   # lab key
npm run cli -- attester join peranto:EcoTestResult:v1 -k $PERANTO_KEY

# Issue + anchor
npm run cli -- vc issue -k $PERANTO_KEY --subject 0xHolder...

# Verify
npm run cli -- vc verify .peranto/vc-xxxx.jwt
```

## Packages

| Path | Purpose |
|------|---------|
| `contracts/` | `DIDRegistry`, `SchemaRegistry`, `AttesterRegistry`, `CredentialStatusRegistry`, `NameRegistry` |
| `packages/sdk` | Resolve, stake, issue/verify JWT-VC (ES256K) |
| `packages/cli` | Demo CLI |
| `docs/did-peranto-method.md` | Method spec (W3C DID Core oriented) |
| `docs/protocolo-peranto.md` | Whitepaper inicial + glosario del protocolo |
| `docs/tokenomics.md` | PAS stake / fees / tips / reparto (MVP vs diseño) |
| `docs/paseo-deploy.md` | Deploy checklist for Paseo |
| `schemas/` | EcoTestResult + TipReceipt (stubs JSON) |

## Paseo deploy

```bash
cp .env.example .env
# set PRIVATE_KEY with PAS for gas
npm run deploy:paseo
```

- ETH-RPC: `https://eth-rpc-testnet.polkadot.io/`
- Chain ID: `420420417`
- DID example: `did:peranto:paseo:0x...`

Compile with `solc` (Hardhat) for local EVM. For PolkaVM production bytecode use `resolc` when targeting `pallet-revive` upload paths; eth-rpc on Hub TestNet accepts Ethereum-style deployment via the adapter — verify with a smoke `stakeAndJoin` after deploy.

## License

MIT
