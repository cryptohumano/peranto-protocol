# did:peranto — Eco-testing DID + VC + economía DisCO (EVM / PVM)

Decentralized identifiers (`did:peranto`), verifiable credentials, and cooperative **DisCO** node treasuries targeting local Hardhat and **Paseo** (Polkadot Hub TestNet, chain id `420420417`).

**Protocolo / whitepaper + glosario:** [docs/protocolo-peranto.md](docs/protocolo-peranto.md)  
**Privacidad mínima (research):** [docs/research-privacy-cooperatives.md](docs/research-privacy-cooperatives.md)  
**DID method v0.1 / DIF:** [docs/did-peranto-method.md](docs/did-peranto-method.md) · [docs/dif-w3c-compliance.md](docs/dif-w3c-compliance.md)

## Quick start

```bash
npm install
npm run compile
npm test
```

Deploy locally (persistent node — Aura / MetaMask speak to this):

```bash
# Terminal A
npx hardhat node

# Terminal B (against the node above — writes deployments/31337.json)
npm run deploy:local
```

Then in Aura → **Red** → pegar `deployments/31337.json`. Importa una cuenta funded de Hardhat (p. ej. Account #0) o envíale ETH, porque un DID nuevo nace con balance 0.

### CLI demo — identidad

```bash
npm run cli -- did create --network hardhat

export PERANTO_KEY=0x...   # lab key
npm run cli -- attester join peranto:EcoTestResult:v1 -k $PERANTO_KEY
npm run cli -- vc issue -k $PERANTO_KEY --subject 0xHolder...
npm run cli -- vc verify .peranto/vc-xxxx.jwt
```

### CLI demo — DisCO

```bash
npm run cli -- disco create EcoLab -k $PERANTO_KEY
npm run cli -- disco tip 0xNode... 0xMember... --value 0.1 -k $PERANTO_KEY
npm run cli -- disco contribute 0xNode... --value 1 -k $PERANTO_KEY
npm run cli -- disco harvest 0xNode... 0 -k $PERANTO_KEY
npm run cli -- disco distribute 0 -k $PERANTO_KEY
npm run cli -- disco scores 0xNode... 0xAccount...
```

## Packages

| Path | Purpose |
|------|---------|
| `contracts/` | Identity registries + `ProtocolTreasury`, `DisCONode`, `DisCOFactory` |
| `packages/sdk` | Resolve, stake, issue/verify JWT-VC, tip/harvest/distribute |
| `packages/cli` | Demo CLI (`did`, `vc`, `name`, `disco`) |
| `packages/extension` | **Aura Wallet** — extensión MV3 (identidad, VCs, DisCO, EIP-1193) |
| `packages/web` | Portal identidad / DisCO (Vite + Tailwind 4 + shadcn) |
| `packages/uni-resolver-driver-did-peranto` | Driver DIF: `GET /1.0/identifiers/{did}` → Paseo |
| `docs/did-peranto-method.md` | Method spec **v0.1** (W3C DID Core oriented) |
| `docs/dif-w3c-compliance.md` | Checklist registro W3C + Universal Resolver |
| `docs/protocolo-peranto.md` | Whitepaper + glosario |
| `docs/tokenomics.md` | PAS stake / fees / tips / reparto |
| `docs/tokenomics-scenarios.md` | Escenarios demo Love/Care/livelihood/stake |
| `docs/tokenomics-smoke-sim.md` | Corrida smoke real + proyección epoch |
| `docs/paseo-deploy.md` | Deploy checklist for Paseo |
| `docs/disco-config.example.json` | Config UI cooperativa |
| `schemas/` | EcoTest, TipReceipt, Member, CommonsWork, Care |

### Portal web

```bash
npm run web:dev          # http://localhost:5173 — /login /id /coop /economia
npm run schemas:register -- --network paseo   # schemas nuevos sin redeploy
npm run seed:node -- --network paseo          # createNode EcoLab
npm run smoke:paseo      # name + Member VC + tip/scores (PRIVATE_KEY + deployments/420420417.json)
npm run smoke:disco      # Love/Care/Livelihood multi-cuenta + proyección epoch
```

Rutas: Identidad, Cooperativa, **Economía** (DisCOs + schemas + Love/Care), Credenciales, Guía, Transacciones, Tesoros.

**GitHub Pages:** [https://cryptohumano.github.io/peranto-protocol/#/login](https://cryptohumano.github.io/peranto-protocol/#/login)  
Portal estático (sin backend). Lecturas DID/nombre/economía → RPC público de Paseo.  
Tokenómica smoke: [docs/tokenomics-smoke-sim.md](docs/tokenomics-smoke-sim.md).  
DID / DIF: [docs/did-peranto-method.md](docs/did-peranto-method.md) · [docs/dif-w3c-compliance.md](docs/dif-w3c-compliance.md) · [docs/external-prs-draft.md](docs/external-prs-draft.md).

### Aura Wallet (extensión)

```bash
npm run extension:build
# o para otra PC:
npm run extension:pack   # → releases/aura-wallet.zip
# Chrome → chrome://extensions → Cargar sin empaquetar → carpeta con manifest.json
```

Wallet multi-esquema: **secp256k1** (EVM / PVM eth-rpc), **sr25519** y **ed25519** (Substrate). Ver [packages/extension/README.md](packages/extension/README.md).

## Multi-chain

Ver [docs/multi-chain-deploy.md](docs/multi-chain-deploy.md) (Paseo, Base, Arbitrum EVM; nota Stylus).

```bash
npm run deploy:paseo
npm run deploy:baseSepolia
npm run deploy:arbitrumSepolia
# mainnets (requieren gas real):
# npm run deploy:base
# npm run deploy:arbitrum
```


## License

MIT
