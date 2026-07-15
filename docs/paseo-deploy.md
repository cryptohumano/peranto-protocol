# Deploy to Paseo (Polkadot Hub TestNet)

## Network

| Field | Value |
|-------|-------|
| Name | Polkadot Hub TestNet |
| Chain ID | `420420417` |
| Native token | PAS |
| ETH-RPC | `https://eth-rpc-testnet.polkadot.io/` |
| DID form | `did:peranto:paseo:0x...` |

## Fondear PAS

1. Abre el faucet oficial: https://faucet.polkadot.io/
2. En **Network**, elige **Polkadot Hub TestNet** (PAS, chain `420420417`).
3. Pega tu address **EVM** (0x…), p. ej. el deployer de `.env`:
   `0x354151d1039Ba06862f8a5062b37BCb8b082cEDF`
4. Pulsa **Get Some PASs**.
5. Comprueba saldo:
   ```bash
   curl -s -X POST https://eth-rpc-testnet.polkadot.io/ \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x354151d1039Ba06862f8a5062b37BCb8b082cEDF","latest"]}'
   ```
   Cuando `result` ≠ `"0x0"`, ya puedes `npm run deploy:paseo`.

Docs: https://docs.polkadot.com/smart-contracts/faucet/

## Troubleshooting: `Transaction is temporarily banned`

El pool del nodo **bloquea ~30 min** el hash de una tx que ya falló (p. ej. deploy sin PAS). No es un ban de tu cuenta permanente.

Opciones:

1. **Esperar ~30 minutos** y reintentar.
2. Usar otro RPC (pool distinto), ya por defecto en Hardhat `paseo`:
   `https://services.polkadothub-rpc.com/testnet/`  
   (alternativa Parity: `https://eth-rpc-testnet.polkadot.io/`)
3. Cambiar gas/tip para que el hash de la tx firmada sea distinto.

## Troubleshooting: `ProviderError: Invalid Transaction`

En el eth-rpc de Hub TestNet este mensaje suele aparecer cuando:

1. **La cuenta no tiene PAS** (el error no dice “insufficient funds”).
   Comprueba saldo:
   ```bash
   # address del deployer en .env
   curl -s -X POST https://eth-rpc-testnet.polkadot.io/ \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xYOUR","latest"]}'
   ```
   Si el `result` es `"0x0"`, fondea antes de redesplegar.
2. Gas / dry-run del adaptador eth-rpc rechaza la tx (MetaMask suele mostrar lo mismo).
3. Tras fondear, si sigue fallando: probar `@parity/hardhat-polkadot` + bytecode **resolc** (PVM), ver nota abajo.

## Steps

1. Fund a secp256k1 account with PAS (official Paseo faucets).
2. Copy `.env.example` → `.env` and set `PRIVATE_KEY`.
3. Optionally set `MIN_STAKE`, `ANCHOR_FEE`, `NAME_FEE`, `PERIOD_BLOCKS`, `RESERVE_FLOOR`, `CREATE_PERANTO_NODE`.
   Fees go to `ProtocolTreasury` (deployed by the script). Legacy `TREASURY` EOA override is no longer used.
4. Run (incluye sync web + tip para Aura):

```bash
npm run compile
npm run deploy:paseo:sync
# o: npm run deploy:paseo && npm run sync:aura-paseo
```

5. Artifacts:
   - `deployments/420420417.json`
   - `deployments/paseo.json` (alias)
   - `packages/web/public/deployments/paseo.json` (portal)
6. Rebuild Aura con addresses nuevas:

```bash
cd packages/extension && npm run pack
```

7. Smoke test:

```bash
export PERANTO_NETWORK=paseo
export PERANTO_RPC_URL=https://eth-rpc-testnet.polkadot.io/
export PERANTO_KEY=0x...
npm run cli -- attester join peranto:EcoTestResult:v1
```

## Qué incluye este stack

- `DisCONode.dissolve` + `ProtocolTreasury.selfUnregister` (liquidar nodo)
- Schemas Member / CommonsWork / CareContribution registrados en el deploy
- Factory payable (seed 100% al nodo)
## PVM / resolc note

Local Hardhat uses `solc` (EVM). Hub TestNet eth-rpc adapts Ethereum transactions to `pallet-revive`. If a contract fails at deploy/runtime on Paseo while tests pass locally, recompile with [`resolc`](https://github.com/paritytech/revive) and compare ABI/behavior. Prefer Solidity without exotic assembly for max compatibility.
