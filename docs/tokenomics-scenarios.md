# Escenarios y proyecciones tokenómicas (DisCO + attesters)

Complementa [tokenomics.md](./tokenomics.md). Unidades: **PAS** (nativo Paseo). Contadores Love/Care/Livelihood son **enteros por evento**, no por wei.

Corrida on-chain documentada: [tokenomics-smoke-sim.md](./tokenomics-smoke-sim.md) (`npm run smoke:disco`).

## Roles de demo (fondear estas addresses)

Ver generador local `.peranto/smoke-addresses.md` (claves en `.peranto/smoke-accounts.json`, gitignored).

| Rol | Función |
|-----|---------|
| attester-lab | `stakeAndJoin` → emitir/anclar VCs → `startUnbond` / `withdraw` |
| member-alice | Subject VC; recibe tips → **Love** |
| member-bob | Tips a Alice → **Care**; `contribute` → **livelihoodPoints** |
| tipper-carol | Tips a personas y al nodo |
| contributor-dave | `contribute()` 80/20 |
| governance-erin | addMember / createNode / dissolve (si tiene gobernanza) |

Sugerido: **25–50 PAS** por cuenta + faucet [Polkadot Hub TestNet](https://faucet.polkadot.io/).

---

## 1. Stake / unbond attester

Con `minStake = 0` (Paseo demo): `stakeAndJoin` cuesta **solo gas**; el stake depositado puede ser 0.

| Paso | Efecto |
|------|--------|
| `stakeAndJoin(schemaId)` + `value ≥ minStake` | Autorizado a anclar ese schema; `stakeOf` ↑ |
| `joinSchema` (si minStake ya cumplido) | Otro schema sin stake extra |
| `startUnbond` | `isAuthorized` pasa a **false**; timer `unbondDelay` (default **7 días**) |
| `withdraw` tras delay | Recupera `stakeOf`; deja de ser attester |

**Proyección teórica (mainnet con minStake > 0):**  
Si `minStake = 100 PAS` y 10 labs hacen join, **1000 PAS** quedan locked hasta unbond. Durante unbond no pueden anclar (accountability). Slash (gobernanza) quema/envía el stake — riesgo reputacional fuera de MVP UI.

**Escenario demo:** lab stakea Member + EcoTest → emite a Alice → `startUnbond` → (en testnet con delay corto o esperar) → `withdraw`. Mientras unbonding, un `anchor` debe fallar.

---

## 2. Credenciales (JWT + ancla)

| Paso | PAS on-chain | Off-chain |
|------|--------------|-----------|
| Emitir JWT | 0 | Lab firma ES256K |
| `anchor(credHash, schemaId, subject)` | gas + `anchorFee` (0 en demo) | Hash público |
| Entregar JWT | 0 | Copiar / import vault |
| `revoke` | gas | Ancla → Revoked; JWT local sigue existiendo |

**Proyección:** 100 miembros × 1 VC Member/año ≈ 100 anclas. Costo attester ≈ 100 × (gas_anchor + fee). Sin fee, el cuello es gas y reputación del lab (Love/Care del nodo, no del schema).

**Escenario demo:** lab → Member para Alice y Bob; EcoTest para Alice; revoke de una ancla vieja y re-emitir.

---

## 3. Love y Care (tips)

Cada `tip(to)` con `value > 0`:

| Actor | Contador |
|-------|----------|
| Emisor | `carePoints += 1`, `period.care += 1` |
| Receptor (`to ≠ node`) | `lovePoints[to] += 1`, `period.love += 1` + recibe `value` PAS |
| `to == node` | Solo `period.love += 1`; PAS queda en tesoro del nodo |

**No** depende del monto: tip de 0.001 o 10 PAS = **+1** Care/Love.

**Proyección (periodo):**

| Actividad | Care periodo | Love periodo | Notas |
|-----------|--------------|--------------|-------|
| 50 tips persona→persona | 50 | 50 | Valor circula entre EOAs |
| 20 tips al nodo | 20 | 20 (periodo) | Tesoro nodo ↑ |
| Mix 30 peer + 10 nodo | 40 | 40 | w_i usa Care/Love de periodo |

Peso redistribute:

\[
w_i = 5\cdot Care_i + 3\cdot Love_i + 1\cdot Anchors_i
\]

Ejemplo nodo A: Care=40, Love=40, Anchors=10 → \(w = 200+120+10 = 330\).  
Nodo B: Care=10, Love=5, Anchors=2 → \(w = 50+15+2 = 67\).  
Si el commons a repartir es 100 PAS y 50% weighted: A recibe ~\(50 \times 330/397 ≈ 41.6\) PAS del tramo weighted (+ parte equal).

**Escenario demo:** Carol tipa a Alice (Carol Care+1, Alice Love+1); Bob tipa a Alice; Carol tipa al nodo MST/EcosystemLab.

---

## 4. Livelihood (`contribute`)

`contribute()` envía `msg.value`:

- **80%** → balance del nodo  
- **20%** → `ProtocolTreasury`  
- `livelihoodPoints[msg.sender] += 1` (por llamada, no por wei)

| Contribución | Al nodo | Al protocolo | livelihoodPoints |
|--------------|---------|--------------|------------------|
| 10 PAS × 1 llamada | 8 | 2 | +1 |
| 10 PAS × 5 llamadas de 2 PAS | 8 | 2 | +5 |

**Proyección:** Dave hace 5 contributes de 2 PAS → nodo +8, commons +2, livelihood=5. Care/Love **no** cambian con contribute.

**Escenario demo:** Dave contribute 1+1+1 PAS; leer `livelihoodPoints(dave)` y balances nodo/treasury.

---

## 5. Canon `harvest` + `distribute` (proyección de ciclo)

`sustainBps` según Love/links del periodo cerrado:

| Estado nodo | bps | Canon sobre (balance − reserveFloor) |
|-------------|-----|--------------------------------------|
| Muy integrado (Love + links ≥ 2K) | 100 | 1% |
| Integrado (Love o links ≥ K) | 200 | 2% |
| Nuevo/aislado | 500 | 5% |

Ejemplo: balance nodo 1000 PAS, reserveFloor 0, integrado → harvest **20 PAS** al commons.  
`distribute`: 50% equal entre elegibles + 50% por \(w_i\).

**Escenario teórico completo (1 periodo):**

1. Tips generan Care/Love/Anchors.  
2. Contributes llenan nodo + 20% commons.  
3. Cierra periodo → `harvest` mueve % al commons.  
4. `distribute` recircula commons → nodos.  

Sin tips (Love=0, links=0, nodo nuevo) el canon es más alto (5%): incentivo a integrar redes (Love/federation) para pagar menos canon.

---

## 6. Matriz “qué probar cuando estén fondeadas”

| # | Actor(es) | Acción | Verificar |
|---|-----------|--------|-----------|
| A | attester-lab | stakeAndJoin Member (+ valor si suben minStake) | `isAuthorized` |
| B | attester-lab → alice | issueAndAnchor Member | ancla Active; JWT a vault Alice |
| C | carol → alice | tip 0.01 | care carol, love alice, saldo alice |
| D | carol → node | tip 0.01 | care carol, period love, balance node |
| E | dave | contribute 1 PAS ×3 | livelihood=3; +0.8×3 nodo; +0.2×3 treasury |
| F | bob → alice | tip | scores bob/alice |
| G | attester-lab | EcoTest Alice | segunda schema / ancla |
| H | attester-lab | startUnbond | anchors fallan; tras delay withdraw |
| I | gobernanza | harvest periodo pasado + distribute | salidas en Activity |

---

## 7. Límites conscientes del MVP

- Love/Care **no** miran el monto del tip.  
- VC CareContribution **≠** `carePoints`.  
- `livelihoodPoints` aún con poca UI; lectura vía contrato/SDK.  
- `unbondDelay` = 7d en deploy típico → withdraw no es inmediato en Paseo.  
- SDK portal hoy prioriza tip/issue; unbond/withdraw attester pueden requerir CLI o ampliar SDK antes del smoke multi-cuenta.
