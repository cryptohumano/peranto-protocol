# Tokenomics — did:peranto

> Visión de protocolo (DisCO, Livelihood/Love/Care, tips, arquitectura): [protocolo-peranto.md](./protocolo-peranto.md) §8.1.

Sin token ERC-20 propio. Peso económico = token nativo de la red (**PAS** en Paseo Hub TestNet).

## Phase 1 — MVP identidad (implementado en repo)

| Acción | Costo | Quién paga | Destino |
|--------|-------|------------|---------|
| Create DID | 0 | — | — |
| DID updates | gas | Dueño | Red |
| Register schema | gas | Publisher | Red |
| `stakeAndJoin` | `minStake` + gas | Attester | Bloqueado en `AttesterRegistry` |
| `anchor` | gas + `anchorFee` | Attester | Red + `treasury` (address) |
| `revoke` | gas | Attester | Red |
| Verify | 0 | Verifier | — |
| Name `register` | gas + `nameFee` | Registrante | Red + `treasury` |
| `withdraw` post-unbond | gas | Attester | Stake devuelto |

Defaults testnet: `minStake = 0`, `anchorFee = 0`, `nameFee = 0`, `unbondDelay = 7 days`.

**Alcance MVP:** fees van a un `address` genérico. No hay aún `tip`, scoreboards, ni `ProtocolTreasury` en código.

## Phase 2 — Treasuries, tips, canon dinámico y reparto híbrido (diseño normativo)

### Tips

| Evento | Contadores |
|--------|------------|
| Tip recibido | **Love** ↑ (DID + nodo del receptor) |
| Tip enviado | **Care** ↑ (DID + nodo del emisor) |

VC opcional: [`TipReceipt.v1`](../schemas/TipReceipt.v1.json).

### Acumulación

| Parámetro | Valor inicial | Rol |
|-----------|---------------|-----|
| Split actividad nodo / protocolo | **80% / 20%** | Fee de uso vía nodo/factory |
| Canon | `balance * sustainBps / 10000` | Por periodo → `ProtocolTreasury` |
| Periodo | `periodBlocks` ≈ 30 días | Tiempo de bloque |
| `reserveFloor` | > 0 recomendado | No cobrar care-caja mínima |
| `K` (federationLinks mín. para “integrado”) | **1** | Encaje en el grafo |
| `N` (periodos “nuevo”) | **3** | Ventana de nodo reciente |

### `sustainBps` dinámico

| Condición del nodo | `sustainBps` |
|--------------------|--------------|
| Integrado (Love recibido y/o links ≥ K) | **200** (2%) |
| Nuevo (&lt; N) o aislado (sin Love y links = 0) | **500** (5%) |
| Muy integrado (Love y links ≥ 2K) | **100** (1%) |

### Redistribución (`distribute`)

Saldo repartible del `ProtocolTreasury` → **`TreasuryNodo`** elegibles. **Peranto** = nodo peer.

| Parámetro | Valor inicial | Rol |
|-----------|---------------|-----|
| `equalBps` | **5000** (50%) | Partes iguales entre elegibles |
| `weightBps` | **5000** (50%) | Proporcional a \(w_i\) |
| \(c_C\) (Care) | **5** | Incluye Care por tips enviados |
| \(c_L\) (Love) | **3** | Incluye Love por tips recibidos |
| \(c_A\) (Anchors) | **1** | Anclas / actividad |

\[
w_i = c_C \cdot Care_i + c_L \cdot Love_i + c_A \cdot Anchors_i
\]

**Elegibilidad:** factory + canon al día + (≥1 miembro **o** ≥1 ancla **o** ≥1 Care/Love en el periodo).

## Design intent

MVP repo = SSI + anclas. Economía DisCO (tips, treasuries, fee dinámico, reparto) = especificación hasta v0.3 de código; recircula valor sin renta a una EOA.
