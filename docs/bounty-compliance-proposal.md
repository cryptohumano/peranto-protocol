# Bounty compliance proposal — residence + liveness (Peranto)

**Audience:** Kusama privacy/identity bounty curators (Brenzi et al.)  
**Status:** implementation + working e2e (2026-08-14)  
**Related:** [compliance-residence-liveness.md](./compliance-residence-liveness.md) · [architecture-flows.md](./architecture-flows.md) · [`packages/zk-compliance`](../packages/zk-compliance/README.md) · attester [`peranto-attestation`](https://github.com/cryptohumano/peranto-attestation)

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
- `claimsCommitment = Poseidon-7(version=2, schemaKind, countryCode, scoreBps, expiresAtUnix, subject, salt)` (BN254 / Circom-compatible; same hash as the Noir gate)
- Credential **ids** on-chain remain keccak (`credHash`). Only the ZK-facing commitment is Poseidon.
- Legacy `anchor` remains for non-compliance VCs (`validUntil = 0`)

### 3.3 ZK compliance gate

Policy proved in zero knowledge: **notExpired ∧ scoreBps ≥ T ∧ country ∈ allowlist**. Salts never leave Aura.

```text
Didit → attester (TTL + Poseidon commitment + anchorV2)
              ↓
         Aura vault (JWT + salt)
              ↓
    UltraHonk prove in Aura popup (Noir ComplianceGate + bb.js)
              ↓
    Attester verifyComplianceGateHonk (off-chain) + isValid / commitments
              ↓
         Curator inbox (no claims revealed)
```

Public signals: `liveCommitment`, `resCommitment`, `minScoreBps`, `allowlistRoot`, `now`.  
Circuit: [`packages/zk-compliance/noir/src/main.nr`](../packages/zk-compliance/noir/src/main.nr) (Poseidon `hash_7` / `hash_8`).  
On-chain today: `CredentialStatusRegistry.isValid` + commitment/policy binding.  
On-chain SNARK: `ComplianceZkVerifier.verifyGateHonk` is wired (`setHonk`) but Aztec’s generated `HonkVerifier.sol` **does not compile** with solc/Foundry (stack too deep). We do not wait on that file.

**If we need a SNARK on Paseo and bb never ships a compilable verifier:** Groth16 over the **same Poseidon witness** (`setGroth16` / `verifyGate` already on the contract). That Solidity verifier *does* compile. Honk stays the wallet/attester prover; Groth16 is the EVM port.

**Production path for Brenzi R4:** ZK / public-signals only (Honk verified at the attester).  
**Fallback (debug):** claims presentation — not the preferred curator UX.

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
    │  Save / Share / prove UltraHonk (Noir + bb.js)
    ▼
Curator inbox (attest.peranto.app)
    │  Honk verify off-chain + isValid + commitments
    │  NO documents, NO face video, NO claim values (ZK mode)
```

### 3.5 Pilot commercial stance

- Implementation of this specific compliance/attestation operation logic: **USD 3,500 nice-to-have / negotiable** (not a blocker for the bounty process).
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
| Aura wallet: DomainLinkage, authorize, Save, Share (selective claims) | Done |
| On-chain `validUntil` + Poseidon `claimsCommitment` (`anchorV2`, `isValid`) | Done |
| Attester `peranto-attestation`: Didit → TTL 30d/90d → `anchorV2` → Aura Save | Done |
| Public HTTPS attester + webhook (`https://attest.peranto.app`) | Done |
| Curator inbox (ZK vs claims, no Didit PII) | Done |
| Noir `ComplianceGate` + UltraHonk prove in Aura (`bb.js`) | Done (e2e) |
| Attester `verifyComplianceGateHonk` before inbox PASS | Done |
| `ComplianceZkVerifier.verifyGateHonk` + `setHonk` slot | Code ready; **not deployed** (generated Solidity does not compile) |
| Groth16 Poseidon port → on-chain snark if bb verifier never compiles | Fallback (not started) |

Repos:

- Protocol / wallet / lab / zk: `dids-vc-ecotesting`  
- Attester service: sibling `peranto-attestation`

---

## 5. Applicant flow (pilot)

1. Install **Aura**; create `did:peranto:paseo:0x…`.
2. Open attestation portal → start Didit session (vendor_data = DID).
3. Complete liveness (± PoA) in Didit.
4. Attester issues VCs with TTL → `anchorV2` → **Save** into Aura (keep `commitmentSalt`).
5. At payout: **Prove ZK** in Aura (UltraHonk). Attester verifies the proof + on-chain `isValid`; curator never sees score/country.
6. Curator reviews inbox (optional Formstr ref + applicant note) and approves payout.

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
• Holder proves not-expired ∧ score≥T ∧ country∈allowlist in ZK (UltraHonk in Aura; attester verifies; salts never leave the wallet). Curators never see PDFs/face/claims.
• On-chain today: isValid + Poseidon commitments. Full SNARK on Paseo is a follow-up (Groth16 port if Aztec’s Solidity verifier never compiles).
• Pilot fee negotiable nice to have $3,500 USD for this implementation of specific operation logic; open Hub-native stack vs waiting on zkMe.

Design: docs/compliance-residence-liveness.md
Proposal: docs/bounty-compliance-proposal.md

Need from you: country allowlist/denylist + confirm both checks + TTLs OK.
```
