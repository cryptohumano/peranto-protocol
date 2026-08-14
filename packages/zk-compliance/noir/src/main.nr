// ComplianceGate -- UltraHonk / Barretenberg
// Poseidon openings + score >= T + not expired + country in allowlist
use poseidon::poseidon::bn254::hash_7;
use poseidon::poseidon::bn254::hash_8;

global COMMIT_VERSION: Field = 2;
global KIND_LIVENESS: Field = 1;
global KIND_RESIDENCE: Field = 2;

fn claims_commitment(
    schema_kind: Field,
    country_code: Field,
    score_bps: Field,
    expires: Field,
    subject: Field,
    salt: Field,
) -> Field {
    hash_7([
        COMMIT_VERSION,
        schema_kind,
        country_code,
        score_bps,
        expires,
        subject,
        salt,
    ])
}

fn allowlist_root(codes: [Field; 8]) -> Field {
    hash_8(codes)
}

fn country_in_allowlist(country: Field, codes: [Field; 8]) -> bool {
    let mut ok = false;
    for i in 0..8 {
        if codes[i] == country {
            ok = true;
        }
    }
    ok
}

fn main(
    live_commitment: pub Field,
    res_commitment: pub Field,
    min_score_bps: pub u32,
    allowlist_root_pub: pub Field,
    now: pub u64,
    score_bps: u32,
    live_expires: u64,
    live_salt: Field,
    res_country: Field,
    res_expires: u64,
    res_salt: Field,
    subject: Field,
    allowlist: [Field; 8],
) {
    let live = claims_commitment(
        KIND_LIVENESS,
        0,
        score_bps as Field,
        live_expires as Field,
        subject,
        live_salt,
    );
    assert(live == live_commitment);

    let res = claims_commitment(
        KIND_RESIDENCE,
        res_country,
        0,
        res_expires as Field,
        subject,
        res_salt,
    );
    assert(res == res_commitment);

    assert(score_bps >= min_score_bps);
    assert(live_expires >= now);
    assert(res_expires >= now);
    assert(res_country != 0);
    assert(country_in_allowlist(res_country, allowlist));
    assert(allowlist_root(allowlist) == allowlist_root_pub);
}
