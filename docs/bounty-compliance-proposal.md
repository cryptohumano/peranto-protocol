# Bounty compliance proposal — residence + liveness (Peranto)

**Audience:** Kusama privacy/identity bounty curators (Brenzi et al.)  
**Status:** implementation proposal + progress snapshot (2026-08)  
**Related:** [compliance-residence-liveness.md](./compliance-residence-liveness.md) · [architecture-flows.md](./architecture-flows.md) · [`packages/zk-compliance`](../packages/zk-compliance/README.md)

---

## 1. What Brenzi asked for (requirements)

From curator discussion (paraphrased; compliance blocked bounty execution):

| # | Requirement | Notes |
|---|-------------|--------|
| R1 | **Sanctions / payout liability** | Curators need a process before releasing bounty funds; W3F declined to own this. |
| R2 | **Proof of residence**, not citizenship | Passport / ZKPassport / nationality alone is **insufficient**. Domicile / place of residence matters for sanctions. |
| R3 | **Liveness** | Confirm a real person is present (anti-spoof), not only a static ID. |
| R4 | **No PII custody on curator side** | No passport scans, utility PDFs, or face videos on curator laptops. Verifiable outcome only. |
| R5 | **Practical process** | Something operable without waiting indefinitely on a closed vendor (e.g. zkMe SLA). |

**Explicitly out of scope for the curator:** collecting or storing raw KYC documents.

**Open curator decision (still needed from Brenzi):**

- Country **allowlist** and/or **denylist** for payouts.
- Minimum liveness score / credential TTL policy.
- Whether both residence **and** liveness are mandatory for every payout, or staged.

---

## 2. Our reading of the problem

```text
Citizenship / passport  ≠  Residence
ID document              ≠  Liveness
Curator sees documents   =  PII risk (rejected)
```

So the gate must be:

1. Provider (Didit, etc.) checks face + PoA documents.
2. Peranto **attests** reduced claims into VCs with a **fixed vigencia (TTL)**.
3. Attester anchors `credHash` + `validUntil` + `claimsCommitment` on-chain.
4. Holder proves policy in **ZK** (preferred) or presents claims (debug only).
5. Curator / gate never receives PDF/video; verifies proof + on-chain `isValid`.

---

## 3. Proposed implementation (Peranto)

### 3.1 Credentials + vigencia

| Schema | Default TTL | Claims (JWT / holder) |
|--------|-------------|------------------------|
| `peranto:LivenessCheck:v1` | **30 days** | `score`, `expiresAt`, `provider`, … |
| `peranto:ProofOfResidence:v1` | **90 days** | `country`, `docType`, `issuedWithinDays`, `expiresAt`, … |

`expiresAt` is set at issue time (`now + TTL`). Same instant is written on-chain as `validUntil`.

### 3.2 Registry (fuente de verdad)

`CredentialStatusRegistry.anchorV2(credHash, schemaId, subject, validUntil, claimsCommitment, …)`:

- `isValid(credHash)` ⇔ status Active **and** (`validUntil == 0` ∨ `block.timestamp ≤ validUntil`)
- `claimsCommitment = keccak256(abi.encode(schemaKind, countryCode, scoreBps, expiresAtUnix, subject, salt))`
- Legacy `anchor` remains for non-compliance VCs (`validUntil = 0`)

### 3.3 ZK compliance gate

```text
Didit → attester (TTL + commitment + anchorV2)
              ↓
         Aura vault (JWT + salt)
              ↓
    proveComplianceGate (algebraic now / Groth16 when artifacts built)
              ↓
 ComplianceZkVerifier.verifyGate + registry isValid
              ↓
         Curator payout (no claims revealed)
```

Public signals: `liveCommitment`, `resCommitment`, `minScoreBps`, `allowlistRoot`, `now`.  
Circuit source: [`packages/zk-compliance/circuits/ComplianceGate.circom`](../packages/zk-compliance/circuits/ComplianceGate.circom).  
On-chain binder: `ComplianceZkVerifier` (optional Groth16 verifier address).

**Production path for Brenzi R4:** ZK / public-signals only.  
**Fallback (debug):** JWT or claims presentation — not the preferred curator UX.

### 3.4 Architecture (full)

```text
Applicant (Aura wallet, did:peranto)
    │
    ├─► Didit session (liveness ± PoA)     [PII stays with Didit]
    │
    ▼
peranto-attestation
    │  JWT with expiresAt + salt
    │  anchorV2(validUntil, claimsCommitment)
    ▼
Aura vault
    │  Save / Share / prove ZK gate
    ▼
Curator gate
    │  verifyGate / verifyComplianceGatePublic
    │  NO documents, NO face video, NO claim values (ZK mode)
```

### 3.5 Pilot commercial stance

- **No fee to curators** for this bounty pilot.
- Applicants may pay Didit (or other provider) fees.
- Protocol `anchorFee` can stay off / zero for the pilot.

### 3.6 Relation to zkMe

zkMe is a packaged zkKYC / zkPoA product. This proposal is an **open Polkadot/Hub-native attestation stack** (DID + VC + Aura + attester + vigencia registry + ZK gate) that curators can audit without waiting on a single vendor SLA.

---

## 4. Deliverables & status

| Deliverable | Status |
|-------------|--------|
| Design note (residence ≠ citizenship, no curator PII) | Done |
| Schemas Liveness + Residence + register/smoke | Done |
| Aura wallet: DomainLinkage, authorize, Save, Share | Done |
| Selective claims presentation + `verifyPresentation` | Done |
| Aura Lab (local dapp) for Save / Share / verify | Done |
| Attester scaffold `peranto-attestation` + `/v1/issue` | Done |
| On-chain `validUntil` + `claimsCommitment` (`anchorV2`, `isValid`) | Done |
| Attester TTL 30d/90d + commitment + `ANCHOR=true` → `anchorV2` | Done |
| `ComplianceZkVerifier` + algebraic prove/verify + Aura Lab demo | Done |
| Circom `ComplianceGate` + `build:circuit` (needs circom on PATH) | Done (artifacts optional) |
| Didit session create + webhook → issue VCs | In progress (sandbox API key) |
| Full Groth16 ceremony → on-chain snark verifier | Pending (ops / circom) |
| Curator gate UI (allowlist policy page) | Pending |
| Public HTTPS attester + Didit webhook tunnel | Pending (ops) |

Repos:

- Protocol / wallet / lab / zk: `dids-vc-ecotesting`  
- Attester service: sibling `peranto-attestation`

---

## 5. Applicant flow (pilot)

1. Install **Aura**; create `did:peranto:paseo:0x…`.
2. Open attestation portal → start Didit session (vendor_data = DID).
3. Complete liveness (± PoA) in Didit.
4. Attester issues VCs with TTL → `anchorV2` → **Save** into Aura (keep `commitmentSalt`).
5. At payout: **Prove ZK gate** (or Share claims for debug).
6. Curator runs `ComplianceZkVerifier` / SDK verify + policy; approve payout.

---

## 6. Questions for Brenzi

1. Preferred **country allowlist / denylist** for payouts?  
2. Is **liveness + residence** both mandatory for every payout?  
3. Confirm **ZK / public-signals** as the production gate (claims JWT only for audit)?  
4. Preferred network for the pilot: **Paseo Hub TestNet** now, Spiritnet/main later?  
5. OK with default TTLs **30d liveness / 90d residence**?

---

## 7. One-paragraph pitch (chat)

```text
Gm Brenzi — proposal to unblock compliance without curator PII:

• Residence ≠ citizenship: PoA → ProofOfResidence VC (country claims only).
• Liveness → LivenessCheck VC (score + expiry).
• Each VC gets a fixed TTL (30d / 90d) anchored on-chain (validUntil + claimsCommitment).
• Holder proves not-expired ∧ score≥T ∧ country∈allowlist in ZK; curators never see PDFs/face/claims.
• Pilot free for this bounty; open Hub-native stack vs waiting on zkMe.

Design: docs/compliance-residence-liveness.md
Proposal: docs/bounty-compliance-proposal.md

Need from you: country allowlist/denylist + confirm both checks + TTLs OK.
```
