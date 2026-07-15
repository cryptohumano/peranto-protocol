# Tokenomics — did:peranto

> Visión de protocolo (DisCO, Livelihood/Love/Care, tips, arquitectura): [protocolo-peranto.md](./protocolo-peranto.md) §8–8.1.

Sin token ERC-20 propio. Peso económico = token nativo de la red (**PAS** en Paseo Hub TestNet).

## Phase 1 — Identidad SSI (implementado)

| Acción | Costo | Quién paga | Destino |
|--------|-------|------------|---------|
| Create DID | 0 | — | — |
| DID updates | gas | Dueño | Red |
| Register schema | gas | Publisher | Red |
| `stakeAndJoin` | `minStake` + gas | Attester | Bloqueado en `AttesterRegistry` |
| `anchor` | gas + `anchorFee` | Attester | Red + `ProtocolTreasury` |
| `revoke` | gas | Attester | Red |
| Verify | 0 | Verifier | — |
| Name `register` | gas + `nameFee` | Registrante | Red + `ProtocolTreasury` |
| `withdraw` post-unbond | gas | Attester | Stake devuelto |

Defaults testnet: `minStake = 0`, `anchorFee = 0`, `nameFee = 0`, `unbondDelay = 7 days`.

## Phase 2 — Treasuries, tips, canon y reparto (núcleo implementado)

### Tips / actividad

| Evento | Efecto |
|--------|--------|
| `tip(to)` recibido | **Love** ↑ (receptor + agregados de periodo); valor nativo al receptor (o al nodo si `to == node`) |
| `tip` enviado | **Care** ↑ (emisor + periodo) |
| `contribute()` | **80%** saldo nodo / **20%** `ProtocolTreasury`; `livelihoodPoints` ↑ |

VC opcional: [`TipReceipt.v1`](../schemas/TipReceipt.v1.json) (schema registrado en deploy).

### Parámetros on-chain

| Parámetro | Valor inicial | Rol |
|-----------|---------------|-----|
| Split actividad nodo / protocolo | **80% / 20%** | `contribute` |
| Canon | `balance * sustainBps / 10000` | `harvest` → `ProtocolTreasury` |
| Periodo | `periodBlocks` (default deploy ≈ 30d) | Tiempo de bloque |
| `reserveFloor` | configurable | No cobrar care-caja mínima |
| `K` (federationLinks mín. integrado) | **1** | Encaje en el grafo |
| `N` (periodos “nuevo”) | **3** | Ventana de nodo reciente |

### `sustainBps` dinámico

| Condición del nodo | `sustainBps` |
|--------------------|--------------|
| Integrado (Love y/o links ≥ K) | **200** (2%) |
| Nuevo (&lt; N) o aislado | **500** (5%) |
| Muy integrado (Love y links ≥ 2K) | **100** (1%) |

### Redistribución (`distribute`)

Saldo del `ProtocolTreasury` → nodos elegibles (Peranto = peer).

| Parámetro | Valor inicial | Rol |
|-----------|---------------|-----|
| `equalBps` | **5000** (50%) | Partes iguales |
| `weightBps` | **5000** (50%) | Proporcional a \(w_i\) |
| \(c_C\) / \(c_L\) / \(c_A\) | **5 / 3 / 1** | Care / Love / Anchors |

\[
w_i = c_C \cdot Care_i + c_L \cdot Love_i + c_A \cdot Anchors_i
\]

**Elegibilidad:** registrado + `harvest` del periodo + (≥1 miembro **o** Love/Care/Anchors ≥ 1).

## Design intent

Recircular valor on-chain sin renta extractiva a una EOA protocolaria: los fees alimentan nodos y un commons temporal que vuelve a los nodos.
