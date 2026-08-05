# Rendimiento: resolve DID, RPC y evolución de contratos

Notas de evaluación (2026-07, actualizado 2026-08-05). Contexto: el editor `/page` (linktr33) y la página pública `/u/:ref` reconstruyen el DID Document; en Paseo con RPC público eso se sentía lento.

## Cliente (corto plazo) — estado

1. **`getLogs` en paralelo** — concurrencia acotada (solo fallback legacy).
2. **Sync incremental** — cursor `syncedToBlock` (warm path del editor).
3. **Anti-fantasmas (v5)** — el merge **ya no** restaura todo el cache de links cuando la chain viene vacía/parcial.
4. **v0.2 storage-first** — `collectDidServices` lee `attributeCount` / attrs en **paralelo** (`Promise.all`); no depende de Multicall3.
5. **Público `/u/:ref`** — `portalResolveDid({ storageOnly: true })`: **nunca** hace cold `eth_getLogs`. Badges de credenciales se resuelven **después** de pintar título + links.

## Cuello de botella estructural

`DIDRegistry` **v0.1** (estilo ERC-1056) **no guardaba** el mapa de atributos activos: solo emitía `DIDAttributeChanged`. El resolve = escanear logs + “último write gana”.

**v0.2** (desplegado en Paseo) escribe storage enumerable **y** emite el evento. Resolve hot-path = pocos `eth_call` en paralelo. El lookback de logs queda como fallback para registries legacy / editor cold.

## Evaluación: RPC propio / dedicado

| Opción | Pros | Contras |
|--------|------|---------|
| RPC propio (nodo / proveedor) | Menos 429, más throughput | Coste ops |
| Endpoint dedicado solo portal/driver | Aísla tráfico de producto | Misma dependencia de infra |
| Seguir en Hub eth-rpc público | Cero coste | Rate limit / latencia variable |

**Recomendación:** lab/demo = público; producto = `VITE_PERANTO_RPC_URL` / `PERANTO_RPC_URL` dedicado.

## Evaluación: cambios de smart contract

### A. Indexer (sin breaking change)

Indexar attrs off-chain → API rápida. Esfuerzo medio.

### B. Storage on-chain — **implementado en v0.2**

Tras redeploy, attrs del registry v0.1 **no migran** — re-publicar services desde `/page`.

### C. Proxies upgradeables (siguiente paso de protocolo)

UUPS / Transparent en `DIDRegistry` (y opcionalmente status/schemas):

- Cambios de lógica sin redeploy “rompe Document”
- Evita dissolve + re-publicar linktr33 en cada evolución
- Governance = EOA lab → timelock cuando madure

**No acelera** la primera visita por sí solo; evita migraciones costosas.

## Prioridad sugerida

```
1. storageOnly + lecturas paralelas en /u/:ref   ✅ (2026-08-05)
2. RPC dedicado para web + driver               (ops)
3. Proxy UUPS en DIDRegistry                    (protocolo)
4. CDN / snapshot del perfil público (TTL)      (producto)
5. Indexer badges / activity                    (escala)
```

## Métricas a mirar

- Cold público `storageOnly`: p50 / p95 (debe ser pocos `eth_call`, sin `getLogs`).
- Warm editor incremental: &lt; 1–2 s en RPC decente.
- Tiempo hasta primer paint de título+links vs badges (badges no deben bloquear).

## Relacionado

- Spec método: [did-peranto-method.md](./did-peranto-method.md)
- Deploy Paseo: [paseo-deploy.md](./paseo-deploy.md)
