import {
  SCHEMA_KEYS,
  formatDid,
  issueJwtCredential,
  parseDid,
  buildCredentialFileVerified,
  downloadCredentialJson,
  verifyPresentation,
  buildLivenessCommitment,
  buildResidenceCommitment,
  proveComplianceGateAlgebraic,
  verifyComplianceGatePublic,
  type PerantoNetwork,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type AuraProvider = {
  isAura?: boolean;
  request: (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
};

type LabMeta = {
  origin: string;
  network: PerantoNetwork;
  serviceDid: string;
  attesterAddress: Address;
  labPrivateKey: Hex;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Aura Lab: falta #${id} en el DOM`);
  return el;
}

function log(msg: string, data?: unknown) {
  const el = document.getElementById("log");
  if (!el) return;
  const line =
    typeof data === "undefined"
      ? msg
      : `${msg}\n${typeof data === "string" ? data : JSON.stringify(data, null, 2)}`;
  el.textContent = `${new Date().toISOString().slice(11, 19)}  ${line}\n\n${el.textContent}`;
}

function getAura(): AuraProvider | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.aura?.request) return w.aura as AuraProvider;
  const providers = w.ethereum?.providers as AuraProvider[] | undefined;
  const hit = providers?.find((p) => p.isAura);
  if (hit) return hit;
  if (w.ethereum?.isAura) return w.ethereum as AuraProvider;
  return null;
}

async function loadMeta(): Promise<LabMeta> {
  const res = await fetch("/api/lab-meta");
  if (!res.ok) throw new Error(`lab-meta ${res.status}`);
  return (await res.json()) as LabMeta;
}

async function holderDid(aura: AuraProvider): Promise<string> {
  const info = (await aura.request({ method: "peranto_getDid" })) as {
    did: string;
  };
  return info.did;
}

async function issueDemo(
  meta: LabMeta,
  subjectDid: string,
  kind: "liveness" | "residence"
) {
  const { address: subject } = parseDid(subjectDid);
  if (kind === "liveness") {
    return issueJwtCredential({
      issuerPrivateKey: meta.labPrivateKey,
      network: meta.network,
      subjectAddress: subject,
      schemaKey: SCHEMA_KEYS.LivenessCheck,
      credentialType: "LivenessCheck",
      claims: {
        provider: "aura-lab",
        sessionId: `lab-${Date.now()}`,
        score: 0.97,
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
  }
  return issueJwtCredential({
    issuerPrivateKey: meta.labPrivateKey,
    network: meta.network,
    subjectAddress: subject,
    schemaKey: SCHEMA_KEYS.ProofOfResidence,
    credentialType: "ProofOfResidence",
    claims: {
      provider: "aura-lab",
      country: "MX",
      region: "CDMX",
      docType: "utility",
      issuedWithinDays: 30,
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
    },
  });
}

let meta: LabMeta | null = null;
let lastJwt: { jwt: string; label: string } | null = null;

function setLastJwt(jwt: string, label: string) {
  lastJwt = { jwt, label };
  const btn = document.getElementById("btn-download-jwt") as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
}

async function downloadLastJwt() {
  if (!lastJwt) return;
  const file = await buildCredentialFileVerified({
    jwt: lastJwt.jwt,
    label: lastJwt.label,
  });
  downloadCredentialJson(file);
  log(`descargado ${file.label}.peranto.json — Aura: Credenciales → pegar JSON / Guardar en vault`);
}

async function refreshMeta() {
  meta = await loadMeta();
  $("meta").textContent = [
    `origin     ${meta.origin}`,
    `network    ${meta.network}`,
    `serviceDid ${meta.serviceDid}`,
    `attester   ${meta.attesterAddress}`,
    `well-known ${meta.origin}/.well-known/did-configuration.json`,
  ].join("\n");
}

function refreshAuraStatus() {
  const aura = getAura();
  $("aura").textContent = aura
    ? "Aura: detectada (window.aura / ethereum.providers)"
    : "Aura: no detectada — carga la extensión y recarga esta página";
}

async function withAura<T>(fn: (aura: AuraProvider) => Promise<T>): Promise<T> {
  const aura = getAura();
  if (!aura) throw new Error("Aura no detectada. Instala/recarga la extensión.");
  return fn(aura);
}

function bindUi() {
  $("btn-detect").addEventListener("click", () => {
    refreshAuraStatus();
    log(getAura() ? "Aura OK" : "Sin Aura");
  });

  $("btn-session").addEventListener("click", async () => {
    try {
      const session = await withAura((a) =>
        a.request({ method: "peranto_requestSession", params: [] })
      );
      log("session", session);
    } catch (e) {
      log("session error", e instanceof Error ? e.message : String(e));
    }
  });

  $("btn-save-live").addEventListener("click", () => void saveKind("liveness"));
  $("btn-save-res").addEventListener("click", () => void saveKind("residence"));
  $("btn-download-jwt").addEventListener("click", () => void downloadLastJwt());

  async function saveKind(kind: "liveness" | "residence") {
    if (!meta) meta = await loadMeta();
    try {
      await withAura(async (aura) => {
        const did = await holderDid(aura);
        log(`holder ${did}`);
        const issued = await issueDemo(meta!, did, kind);
        const label = kind === "liveness" ? "Lab Liveness" : "Lab Residence";
        setLastJwt(issued.jwt, label);
        log(`JWT emitido (${kind}) — aún NO está en Aura hasta que apruebes Guardar`, {
          schemaKey: issued.schemaKey,
          credHash: issued.credHash,
          issuerDid: issued.issuerDid,
        });
        log("Aura debería abrirse — aprueba Guardar (o usa el icono si no abre)…");
        const saved = await aura.request({
          method: "peranto_saveCredential",
          params: [
            {
              jwt: issued.jwt,
              label,
              schemaKey: issued.schemaKey,
            },
          ],
        });
        log("✓ guardada en vault Aura", saved);
      });
    } catch (e) {
      log("save error", e instanceof Error ? e.message : String(e));
      log("Tip: si solo ves «issued», descarga el JWT e impórtalo en Aura → Credenciales");
    }
  }

  async function share(opts: {
    schemaKeys: string[];
    mode?: "credential" | "claims";
    disclose?: string[];
  }) {
    try {
      const challenge = crypto.randomUUID();
      log(`challenge ${challenge} · mode=${opts.mode ?? "credential"}`);
      log("Abre Aura — elige credencial / claims…");
      const presentation = await withAura((a) =>
        a.request({
          method: "peranto_requestCredential",
          params: [
            {
              schemaKeys: opts.schemaKeys,
              challenge,
              mode: opts.mode,
              disclose: opts.disclose,
            },
          ],
        })
      );
      log("presentation", presentation);
      const verified = await verifyPresentation(presentation, {
        expectedChallenge: challenge,
        expectedOrigin: meta?.origin ?? window.location.origin,
      });
      const out = $("verify-out");
      out.hidden = false;
      out.textContent = JSON.stringify(verified, null, 2);
      log(verified.ok ? "✓ presentation verificada" : "✗ verification failed", verified);
    } catch (e) {
      log("share error", e instanceof Error ? e.message : String(e));
    }
  }

  $("btn-share-live").addEventListener("click", () =>
    void share({ schemaKeys: [SCHEMA_KEYS.LivenessCheck] })
  );
  $("btn-share-score").addEventListener("click", () =>
    void share({
      schemaKeys: [SCHEMA_KEYS.LivenessCheck],
      mode: "claims",
          disclose: ["score"],
    })
  );
  $("btn-share-country").addEventListener("click", () =>
    void share({
      schemaKeys: [SCHEMA_KEYS.ProofOfResidence],
      mode: "claims",
      disclose: ["country"],
    })
  );

  $("btn-zk-gate").addEventListener("click", () => void runZkGateDemo());
}

async function runZkGateDemo() {
  if (!meta) meta = await loadMeta();
  try {
    const did = await withAura((a) => holderDid(a));
    const { address: subject } = parseDid(did);
    const now = Math.floor(Date.now() / 1000);
    const live = buildLivenessCommitment({
      score: 0.97,
      expiresAt: now + 30 * 86400,
      subject,
    });
    const res = buildResidenceCommitment({
      country: "MX",
      expiresAt: now + 90 * 86400,
      subject,
    });
    const policy = {
      minScoreBps: 9000,
      allowlist: ["MX", "CO", "AR"],
      now,
    };
    const proof = proveComplianceGateAlgebraic(
      {
        live: {
          scoreBps: live.scoreBps,
          expiresAtUnix: live.expiresAtUnix,
          subject,
          salt: live.salt,
          commitment: live.commitment,
          credHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
        },
        residence: {
          country: "MX",
          expiresAtUnix: res.expiresAtUnix,
          subject,
          salt: res.salt,
          commitment: res.commitment,
          credHash:
            "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
        },
      },
      policy
    );
    const verified = verifyComplianceGatePublic(proof, {
      liveCommitment: live.commitment,
      resCommitment: res.commitment,
      policy,
    });
    const out = $("zk-out");
    out.hidden = false;
    out.textContent = JSON.stringify(
      {
        verified,
        mode: proof.mode,
        publicSignals: proof.publicSignals,
        note: "Curator only sees publicSignals (+ UltraHonk proof from zk-compliance). Claims stay local.",
      },
      null,
      2
    );
    log(
      verified.ok ? "✓ ZK gate (Poseidon algebraic) OK" : "✗ ZK gate failed",
      verified
    );
  } catch (e) {
    log("zk gate error", e instanceof Error ? e.message : String(e));
  }
}

async function boot() {
  bindUi();
  try {
    await refreshMeta();
    if (meta) {
      const a = privateKeyToAccount(meta.labPrivateKey);
      log(`lab ready · ${formatDid(meta.network, a.address)}`);
    }
  } catch (e) {
    const metaEl = document.getElementById("meta");
    if (metaEl) {
      metaEl.textContent = e instanceof Error ? e.message : String(e);
    }
  }
  refreshAuraStatus();
  window.addEventListener("eip6963:announceProvider", () => refreshAuraStatus());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
