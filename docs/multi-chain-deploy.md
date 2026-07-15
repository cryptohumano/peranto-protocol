# Multi-chain deploy (Paseo · Base · Arbitrum)

## Resumen de redes

| Hardhat network | Chain ID | DID infix | Token gas | Notas |
|-----------------|----------|-----------|-----------|--------|
| `paseo` | `420420417` | `paseo` | PAS | Hub TestNet / PVM vía eth-rpc |
| `baseSepolia` | `84532` | `baseSepolia` | ETH | Testnet Base (recomendado antes de mainnet) |
| `base` | `8453` | `base` | ETH | Mainnet Base — liquidez |
| `arbitrumSepolia` | `421614` | `arbitrumSepolia` | ETH | Testnet Arbitrum Nitro **EVM** |
| `arbitrum` | `42161` | `arbitrum` | ETH | Arbitrum One **EVM** |

Artefacto por cadena: `deployments/<chainId>.json`.

## Stylus vs Solidity en Arbitrum

Los contratos Peranto son **Solidity 0.8.24** y se despliegan en el **EVM Nitro** de Arbitrum (misma vía que cualquier dapp Solidity).

**Stylus** es un runtime aparte (Rust/C → WASM). No es un “flag” de Hardhat para estos `.sol`. Migrar a Stylus implicaría reescribir lógica en Rust + tooling Stylus. Para MVP: desplegar en `arbitrum` / `arbitrumSepolia` como EVM.

## Setup

```bash
cp .env.example .env
# PRIVATE_KEY=0x...   # cuenta con gas nativo en la red destino
npm run compile
```

## Comandos

```bash
npm run deploy:paseo
npm run deploy:baseSepolia
npm run deploy:base          # ¡mainnet! requiere ETH en Base
npm run deploy:arbitrumSepolia
npm run deploy:arbitrum      # ¡mainnet! requiere ETH en Arbitrum One
```

## Faucets (testnets)

- Paseo PAS: faucets oficiales Polkadot Hub / Paseo
- Base Sepolia: faucet Base / Alchemy / etc.
- Arbitrum Sepolia: faucet Arbitrum / bridge desde Sepolia

## Aura Wallet

Tras el deploy, en la pestaña **Red** importa el JSON de `deployments/<chainId>.json` y elige la red correspondiente (cuando la UI liste Base/Arbitrum; por ahora se puede forzar vía JSON + RPC).

DID ejemplo:

- `did:peranto:paseo:0x…`
- `did:peranto:base:0x…`
- `did:peranto:arbitrum:0x…`
