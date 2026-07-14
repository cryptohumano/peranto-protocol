# Deploy to Paseo (Polkadot Hub TestNet)

## Network

| Field | Value |
|-------|-------|
| Name | Polkadot Hub TestNet |
| Chain ID | `420420417` |
| Native token | PAS |
| ETH-RPC | `https://eth-rpc-testnet.polkadot.io/` |
| DID form | `did:peranto:paseo:0x...` |

## Steps

1. Fund a secp256k1 account with PAS (official Paseo faucets).
2. Copy `.env.example` → `.env` and set `PRIVATE_KEY`.
3. Optionally set `MIN_STAKE`, `ANCHOR_FEE`, `TREASURY`.
4. Run:

```bash
npm run compile
npm run deploy:paseo
```

5. Artifact: `deployments/420420417.json`
6. Smoke test:

```bash
export PERANTO_NETWORK=paseo
export PERANTO_RPC_URL=https://eth-rpc-testnet.polkadot.io/
export PERANTO_KEY=0x...
npm run cli -- attester join peranto:EcoTestResult:v1
```

## PVM / resolc note

Local Hardhat uses `solc` (EVM). Hub TestNet eth-rpc adapts Ethereum transactions to `pallet-revive`. If a contract fails at deploy/runtime on Paseo while tests pass locally, recompile with [`resolc`](https://github.com/paritytech/revive) and compare ABI/behavior. Prefer Solidity without exotic assembly for max compatibility.
