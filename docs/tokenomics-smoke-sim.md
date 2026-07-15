# Tokenómica del escenario smoke (Love / Care / Livelihood)

Simulación on-chain en **Paseo Hub TestNet** con las 6 cuentas smoke (25 PAS cada una).  
Script: `npm run smoke:disco` → `scripts/smoke-disco-vertices.ts`.  
Teoría general: [tokenomics.md](./tokenomics.md) · [tokenomics-scenarios.md](./tokenomics-scenarios.md).

Nodo: `Peranto` (`0x3bd67AC7…`). Periodo abierto: **25**.

---

## Las tres vértices

En DisCO no hay un token de gobernanza aparte: el nativo (**PAS**) se mueve, y tres contadores miden *actividad* (por evento, no por monto):

| Vértice | Qué lo sube | Qué mueve PAS |
|---------|-------------|----------------|
| **Love** | Recibir un `tip` (o tip al nodo → solo Love de periodo) | El tip va al receptor (o se queda en el tesoro del nodo) |
| **Care** | Enviar un `tip` | Sale del emisor |
| **Livelihood** | Cada `contribute()` | **80%** al nodo · **20%** al commons (`ProtocolTreasury`) |

Love/Care alimentan el peso \(w_i\) del periodo (y el canon). Livelihood **llena** tesoros pero **no** entra en \(w_i\).

---

## Qué se hizo

1. Gobernanza añadió a Alice, Bob y el lab como miembros (sin eso no se puede tipar a personas).
2. Lab: `stakeAndJoin` Member → emitió/ancló VC a Alice → `recordAnchor` (+1 anchor de periodo).
3. **Tips (Love/Care)**  
   - Carol → Alice **0.5 PAS**  
   - Bob → Alice **0.5 PAS**  
   - Carol → nodo **0.5 PAS** (PAS queda en el tesoro)
4. **Livelihood** — Dave: 3× `contribute(1 PAS)` → nodo +2.4 · commons +0.6 · livelihood=3.

---

## Contadores personales

| Actor | Love | Care | Livelihood |
|-------|------|------|------------|
| Alice | 2 | 0 | 0 |
| Bob | 0 | 1 | 0 |
| Carol | 0 | 2 | 0 |
| Dave | 0 | 0 | 3 |
| Lab | 0 | 0 | 0 |

Periodo del nodo: Love **4** · Care **4** · Anchors **1** · federationLinks **0**.

\[
w = 5\cdot Care + 3\cdot Love + 1\cdot Anchors = 5\cdot4 + 3\cdot4 + 1 = 33
\]

---

## Tesoros después del smoke

| Caja | Antes | Después | Δ |
|------|-------|---------|---|
| Nodo | 0 | **2.9 PAS** | +2.9 (0.5 tip + 2.4 contribute) |
| Commons | 0.002 | **0.602 PAS** | +0.6 (20% de Dave) |
| Alice | 25 | **26** | +1 (tips recibidos; sin gas) |
| Carol / Bob / Dave | 25 | ~24.0 / ~24.5 / ~22.0 | tips + contribute + gas |

Alice gana PAS por Love; Dave “trabaja” livelihood (puntos + funding); Carol/Bob acumulan Care.

---

## Proyección de fin de epoch

`harvest` solo aplica a periodos **cerrados** (`periodId < currentPeriod`). El periodo 25 sigue abierto (~222k bloques ≈ restante de los 432k).  
Por eso el fin de epoch se **proyecta** como si cerrara ahora:

| Paso | Resultado |
|------|-----------|
| Integración | Love > 0 → nodo **integrado** → canon **2%** (`sustainBps = 200`) |
| Canon harvest | \(2.9 \times 0.02 =\) **0.058 PAS** → commons |
| Nodo post-harvest | **2.842 PAS** |
| Commons post-harvest | 0.602 + 0.058 = **0.66 PAS** |
| `distribute` (1 nodo elegible) | Casi todo el commons vuelve al mismo nodo (~0.66 PAS) |

Sin Love/links el canon sería **5%** (0.145 PAS): integrar (tips/federation) **abarata** el peaje al commons.

Con un solo nodo elegible, harvest + distribute es casi un “ida y vuelta”: el commons temporalmente guarda valor y lo recircula. Con varios nodos, la mitad equal + la mitad por \(w_i\) reparte entre ellos; este escenario aún no tiene segundo nodo, así que \(w=33\) no compite con nadie.

---

## Lectura corta

- **Love** = red de confianza recibida (Alice); **Care** = generosidad emitida (Carol/Bob); **Livelihood** = aporte al tesoro (Dave).  
- Tips mueven valor entre personas o al nodo; contributes financian nodo + commons.  
- Al cerrar el periodo, un % del saldo del nodo (canon) alimenta el commons; luego `distribute` lo redistribuye según actividad del periodo.  
- Volver a correr: `npm run smoke:disco` (re-tips/contributes suman a los mismos contadores acumulados).
