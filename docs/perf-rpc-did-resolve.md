# Rendimiento: resolve DID, RPC y evolución de contratos

Notas de evaluación (2026-07). Contexto: el editor `/page` (linktr33) y la pestaña DID reconstruyen el documento desde eventos on-chain; en Paseo con RPC público eso se siente lento.

## Cliente (corto plazo) — estado

1. **`getLogs` en paralelo** — concurrencia acotada.
2. **Sync incremental** — cursor `syncedToBlock` (warm path).
3. **Anti-fantasmas (v5)** — el merge **ya no** restaura todo el cache de links cuando la chain viene vacía/parcial (eso resuscitaba links borrados en el editor / QR). Solo re-adjunta claves `recent` de esta sesión. Tras publicar se usa **warm sync** (cursor + seed): un cold lookback post-publish hacía “desaparecer” LinkedIn/Mail escritos fuera de la ventana de logs.

## Cuello de botella estructural

`DIDRegistry` **v0.1** (estilo ERC-1056) **no guardaba** el mapa de atributos activos: solo emitía `DIDAttributeChanged`. El resolve = escanear logs + “último write gana”.

**v0.2** escribe storage enumerable **y** emite el evento. Resolve hot-path = `attributeCount` / `getAttribute` (pocos `eth_call`). El lookback de logs queda como fallback para registries legacy.

Eso es correcto para un método DID minimalista en v0.1, pero:

- Cold resolve en RPC público ≈ cientos de `eth_getLogs` (solo legacy).
- Ventanas cortas hacen “desaparecer” servicios viejos (solo legacy).
- Rate limit del RPC público de Paseo empeora la UX, pero **no es la causa raíz** tras v0.2 storage.

## Evaluación: RPC propio / dedicado

| Opción | Pros | Contras |
|--------|------|---------|
| RPC propio (nodo / proveedor) | Menos 429, más throughput, lookbacks fiables | Coste ops; hay que operarlo |
| Endpoint dedicado solo portal/driver | Aísla tráfico de producto del público | Misma dependencia de infra |
| Seguir en `eth-rpc-testnet.polkadot.io` | Cero coste | No apto para editor con lookback amplio |

**Recomendación:** para lab/demo está bien el público; para producto (linktr33 + uni-resolver driver) provisionar **RPC dedicado** (self-hosted o proveedor) y apuntar `DEFAULT_RPC` / env del driver ahí. Ver también `docs/paseo-deploy.md` y el driver en `packages/uni-resolver-driver-did-peranto`.

Variables candidatas (por definir):

- `VITE_PERANTO_RPC_URL` (web)
- `PERANTO_RPC_URL` (driver / scripts)

## Evaluación: cambios de smart contract

### A. Mantener event-sourced + indexer (sin breaking change)

- Indexar `DIDAttributeChanged` off-chain (subgraph / servicio propio).
- API `GET /did/:id` con estado materializado.
- El SDK resolve “rápido” via índice; on-chain logs siguen siendo source of truth para auditoría.

**Esfuerzo medio, sin redeploy de lógica de identidad.**

### B. Storage on-chain de attrs activos — **implementado en v0.2**

`DIDRegistry` (método 0.2) incluye:

```solidity
mapping(address => mapping(bytes32 => bytes)) public attributeValue;
mapping(address => mapping(bytes32 => uint256)) public attributeValidTo;
// + enumerable names + scoped svc delegates
```

`setAttribute` escribe storage **y** emite el evento. Resolve = leer storage (pocos `eth_call`), no escanear logs.

Tras redeploy en Paseo, attrs del registry v0.1 **no migran** — re-publicar services desde el portal.

### C. Híbrido

- Writes siguen en registry actual.
- Un “mirror” contrato o indexer actualiza estado.
- Portal y driver leen el mirror.

## Prioridad sugerida

```
1. RPC dedicado para web + driver          (ops, alto impacto)
2. Indexer / mirror de DID services        (producto, alto impacto)
3. Evaluar DIDAttributeStore on-chain      (protocolo, medio plazo)
4. Sync incremental anchors (como DID)     (UX badges / credenciales)
```

## Métricas a mirar

- Cold `portalResolveDid` (sin cursor): p50 / p95 latencia y nº de `eth_getLogs`.
- Warm incremental: debería ser &lt; 1–2 s en RPC decente.
- Tasa de 429 / chunks skipped en `getContractEventsChunkedDetailed`.
- Discrepancia public page (`useCache: false`) vs editor (cursor + merge).

## Relacionado

- Spec método: [did-peranto-method.md](./did-peranto-method.md)
- Compliance / driver: [dif-w3c-compliance.md](./dif-w3c-compliance.md)
- Deploy Paseo: [paseo-deploy.md](./paseo-deploy.md)
