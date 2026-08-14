# Compliance gate: residence + liveness without curator PII

**Status:** design note (MVP)  
**Audience:** bounty curators / compliance operators (e.g. Kusama privacy–identity)  
**Stack:** Peranto SSI (DID + VC + on-chain status) — Phase 1 identity only; no DisCO tokenomics required.

## Problem

Sanction screening and payout liability need **proof of residence** and **liveness**, not citizenship.

- Passport / national ID / ZKPassport prove **identity** (and often nationality).
- They do **not** prove **current residence**. Citizenship is irrelevant for many sanctions regimes; domicile / place of residence is what matters.
- Curators must not handle raw PII (passport scans, utility PDFs, face videos). They need a **verifiable yes/no** (or allowlist check) with an audit trail.

## Approach

Peranto already separates sensitive claims from the chain:

| Layer | What lives there |
|-------|------------------|
| Off-chain JWT-VC | Claims (liveness score, residence country/region, expiry) + holder salt |
| On-chain `CredentialStatusRegistry` | `credHash`, schemaId, subject, attester, Active/Revoked, **`validUntil`**, **`claimsCommitment`** |
| ZK gate (`ComplianceZkVerifier`) | Binds commitments + optional Groth16; curator never sees claim values |
| Curator | Verifies gate / proof + allowlist policy; never stores the document |

```text
[Liveness / PoA provider]  →  claims
        ↓
[Peranto attester]  →  JWT-VC (expiresAt = now+TTL) + anchorV2(validUntil, claimsCommitment)
        ↓
[Holder / Aura]  →  proveComplianceGate (ZK)
        ↓
[Curator / bounty gate]  →  verify only (no PDF, no face video, no claim plaintext)
```

**Default TTLs:** liveness **30 days**, residence **90 days** (configurable on the attester).

External providers perform OCR, document authenticity, face liveness, and optional name-matching. Peranto **attests** the resulting claims, anchors hash + vigencia, and the holder proves policy in ZK. The curator never receives the underlying files.

## Credential schemas (MVP)

### `peranto:LivenessCheck:v1`

| Claim | Meaning |
|-------|---------|
| `provider` | Who ran the check (e.g. Didit, vendor name) |
| `score` | Numeric liveness / anti-spoof score |
| `checkedAt` | ISO-8601 timestamp |
| `expiresAt` | ISO-8601; curator policy should reject expired |
| `subjectDid` | Optional explicit bind (also in JWT `sub`) |

### `peranto:ProofOfResidence:v1`

| Claim | Meaning |
|-------|---------|
| `country` | ISO 3166-1 alpha-2 of **residence** (not citizenship) |
| `region` | Optional subdivision |
| `docType` | `utility` \| `lease` \| `tax_notice` \| `bank_statement` \| `other` |
| `issuedWithinDays` | Age of evidence at attestation time (policy: typically ≤ 90) |
| `checkedAt` / `expiresAt` | Freshness window for the attestation itself |
| `provider` | Who validated the PoA document |

**Not on-chain / not in public claims:** street address, full name, PDF, account numbers. Those stay with the provider / holder wallet.

JSON Schema files: [`schemas/LivenessCheck.v1.json`](../schemas/LivenessCheck.v1.json), [`schemas/ProofOfResidence.v1.json`](../schemas/ProofOfResidence.v1.json).

## What the curator verifies

**Preferred (ZK mode):**

1. `ComplianceZkVerifier.verifyGate` (or SDK equivalent) succeeds.
2. Both cred hashes `isValid` on-chain (Active and not past `validUntil`).
3. Public signals match registry `claimsCommitment`s and curator policy (`minScoreBps`, `allowlistRoot`).
4. Same subject for both credentials.

**Debug fallback (claims / JWT):**

1. JWT signature valid (issuer = authorized Peranto attester for that schema).
2. On-chain status = **Active** and `isValid` (respects vigencia).
3. Policy checks on disclosed claims only, e.g.:
   - `LivenessCheck.score >= T` and `expiresAt > now`
   - `ProofOfResidence.country ∈ allowlist` (or `∉ denylist`)
   - `issuedWithinDays <= 90` and attestation not expired
4. Same `subject` / DID for both credentials (same applicant wallet).

No passport image, no utility PDF, no face biometrics in curator custody.

## What this is not (MVP)

- Not a full zkMe replacement (no packaged OFAC product, no multi-chain SBT).
- Not “passport = residence.”
- Not a government API integration per country (that remains a documented pattern for later).
- Circom Groth16 artifacts require `circom` on the builder machine (`npm run build:circuit -w @peranto/zk-compliance`); until then algebraic / registry binding still enforces vigencia + policy for holder self-check and on-chain `isValid`.

Optional later: selective disclosure / ZKP over the same claims (“country ∈ allowlist ∧ score ≥ T”) so even claim values stay hidden from the curator. **The ZK gate path above is the intended production mode**; the MVP already removes document custody.

## Relation to zkMe

zkMe ships a packaged zkKYC / zkPoA / AML product. Peranto’s fit here is an **open, Polkadot/Hub-native attestation layer** you can audit and operate for a bounty gate without waiting on a vendor SLA. Providers plug in for liveness and PoA; Peranto owns DID, schema, attester stake/auth, and status.

## Pilot ops

- Register schemas on the Hub / Paseo deployment (`scripts/register-schemas.ts` or fresh deploy).
- Authorize one compliance attester (`stakeAndJoin` or governance `authorizeAttester`).
- Applicants complete provider checks → attester issues both VCs → applicants present JWTs to curators.
- Smoke: `npm run smoke:compliance` (issue + anchor + verify both schemas).

Fees for this pilot: **none to curators**. Applicants pay provider fees if any. Protocol `anchorFee` can be enabled later if the gate is adopted permanently.

## Suggested reply (chat)

```text
Gm Brenzi — thanks, that clarifies it.

Agreed: citizenship ≠ residence for sanctions. Passport/ZKPassport alone won't cut it.

Design note (Peranto):
https://github.com/cryptohumano/dids-vc-ecotesting/blob/main/docs/compliance-residence-liveness.md

Short version:
1) Liveness — provider score + expiry in a VC; chain only stores the hash.
2) Residence — separate PoA (utility/lease/tax ≤90d), attested as country/region claims, not the PDF.
3) Curators verify JWT + Active status + allowlist — no PII custody on your side.
4) Optional later: ZKP over the same claims.

Schemas: peranto:LivenessCheck:v1 and peranto:ProofOfResidence:v1.
Happy to run a pilot attester for this bounty. Which country allowlist / denylist do you need for payouts?
```

*(Adjust the GitHub URL if the doc is published elsewhere.)*
