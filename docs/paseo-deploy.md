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
3. Optionally set `MIN_STAKE`, `ANCHOR_FEE`, `NAME_FEE`, `PERIOD_BLOCKS`, `RESERVE_FLOOR`, `CREATE_PERANTO_NODE`, `CREATE_ECOSYSTEM_LAB`.
   Fees go to `ProtocolTreasury` (deployed by the script). Legacy `TREASURY` EOA override is no longer used.
   By default deploy creates two DisCO nodes: **Peranto** (protocol peer) and **EcosystemLab** (demo lab).
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

7. Smoke test (PRIVATE_KEY en `.env` + artifact `deployments/420420417.json`):

```bash
npm run smoke:paseo
```

Simula: balance → `name.register` → `stakeAndJoin` Member → emitir/anclar VC → tip 0.001 PAS a PerantoNode (o primer nodo) → `scores`. Imprime un JSON resumen. Requiere PAS en la address del deployer.

Smoke DIDRegistry v0.2 (storage, `svc` delegate, purpose keys, JWT con `#key-assertion`):

```bash
npm run smoke:did
```

El SDK en `paseo` firma con **legacy `gasPrice`** y gas estimado (+50%): el eth-rpc del Hub suele rechazar EIP-1559 / gas caps enormes en wallets recién fondeadas (`Invalid Transaction`).

CLI manual (alternativa):

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
- `DIDRegistry` **v0.2** — storage on-chain de attrs + delegates con scopes (`svc` / `sigAuth` / `veriKey`)

## Pre-redeploy: recuperar PAS de nodos DisCO

Un redeploy despliega **nuevos** contratos. Los nodos DisCO del deploy anterior siguen en chain con fondos; hay que liquidarlos **antes** (o en paralelo) para no depender del faucet.

### Checklist

1. Anota el `PRIVATE_KEY` / address del deployer y de cualquier lab que tenga nodos.
2. Lista nodos (portal Identidad / pertenencias, o CLI / smoke que lea `getHoldings`).
3. Por cada nodo con balance:
   ```bash
   # residualTo = wallet que usará el próximo deploy
   npm run cli -- disco dissolve <nodeAddress> --to 0xDEPLOYER --private-key $PRIVATE_KEY
   ```
   O desde el portal / Aura: acción `disco.dissolve` con destino = deployer.
4. Confirma saldo EVM del deployer (curl `eth_getBalance` arriba).
5. **Importante:** los `did/svc/*` del registry **viejo no migran**. Tras `deploy:paseo:sync`, re-publica PerantoPage / links desde `/page`. El DID (address) es el mismo; el Document enrichment cambia de contrato.
6. Ejecuta `npm run deploy:paseo:sync` y `npm run smoke:paseo`.

Helper (disuelve PerantoNode + EcosystemLabNode del artifact actual hacia el deployer):

```bash
npx tsx scripts/dissolve-paseo-nodes.mts
# o CLI:
npm run cli -- disco dissolve 0xNODE --to 0xDEPLOYER --private-key $PRIVATE_KEY
```

### Qué no se recupera al disolver

- Stake en `AttesterRegistry` (unbond / flujo de attester aparte).
- Nombre en `NameRegistry` (sigue apuntando a tu address; fees no se reembolsan).
- Anclas VC en el status registry viejo (tras redeploy hay que re-anclar en el nuevo).

## PVM / resolc note

Local Hardhat uses `solc` (EVM). Hub TestNet eth-rpc adapts Ethereum transactions to `pallet-revive`. If a contract fails at deploy/runtime on Paseo while tests pass locally, recompile with [`resolc`](https://github.com/paritytech/revive) and compare ABI/behavior. Prefer Solidity without exotic assembly for max compatibility.
