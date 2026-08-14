# Reply draft — Brenzi / bounty compliance

Copy-paste for Element / Discord / forum. Design note: [compliance-residence-liveness.md](./compliance-residence-liveness.md).

```text
Gm Brenzi — thanks, that clarifies it.

Agreed: citizenship ≠ residence for sanctions. Passport/ZKPassport alone won't cut it.

Design note (Peranto):
docs/compliance-residence-liveness.md
(in dids-vc-ecotesting — happy to paste/share a gist if easier)

Short version:
1) Liveness — provider score + expiry in a VC; chain only stores the hash.
2) Residence — separate PoA (utility/lease/tax ≤90d), attested as country/region claims, not the PDF.
3) Curators verify JWT + Active status + allowlist — no PII custody on your side.
4) Optional later: ZKP over the same claims.

Schemas: peranto:LivenessCheck:v1 and peranto:ProofOfResidence:v1.
Pilot is free for this bounty gate. Which country allowlist / denylist do you need for payouts?
```
