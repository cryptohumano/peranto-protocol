import type {
  AuraState,
  ExtensionMessage,
  ExtensionResponse,
} from "../lib/types";
import { dispatch } from "../lib/dispatch";
import {
  NETWORK_CATALOG,
  networkMeta,
  statusLabel,
} from "./networks";
import type { PerantoNetwork } from "@peranto/sdk";
import {
  buildCredentialFile,
  downloadCredentialJson,
} from "@peranto/sdk";

/** Ejecuta en el popup (tiene window + fetch) — evita fallos de viem en el SW. */
async function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  try {
    return await dispatch(message);
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

let state: AuraState | null = null;

function setStatus(text: string, kind: "" | "ok" | "err" = "") {
  const el = $("#status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

function showOutput(data: unknown) {
  const el = $("#output");
  el.hidden = false;
  el.textContent =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function short(s: string, n = 10) {
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

function uiMode(): "holder" | "lab" {
  return state?.settings.uiMode === "lab" ? "lab" : "holder";
}

function schemaLabel(schemaKey: string): string {
  const map: Record<string, string> = {
    "peranto:EcoTestResult:v1": "EcoTest",
    "peranto:LivenessCheck:v1": "Liveness",
    "peranto:ProofOfResidence:v1": "Residence",
    "peranto:Member:v1": "Member",
    "peranto:DomainLinkage:v1": "DomainLinkage",
    "peranto:TipReceipt:v1": "Tip",
  };
  return map[schemaKey] ?? schemaKey.replace(/^peranto:/, "").replace(/:v\d+$/, "");
}

function applyUiMode() {
  const mode = uiMode();
  const tag = $("#brand-tag");
  if (tag) {
    tag.textContent =
      mode === "lab"
        ? "Modo Lab · attester / DisCO"
        : "Identidad did:peranto";
  }

  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((el) => {
    const want = el.dataset.mode;
    if (!want) return;
    el.hidden = want !== mode;
  });

  // Tabs: show/hide by data-mode; holder shows home+vc+settings
  document.querySelectorAll<HTMLButtonElement>("#tab-nav .tab").forEach((tab) => {
    const m = tab.dataset.mode;
    if (!m) {
      tab.hidden = false;
      return;
    }
    tab.hidden = m !== mode;
  });

  // If active tab is hidden, switch to home
  const active = document.querySelector<HTMLButtonElement>(".tab.active");
  if (active?.hidden) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const homeTab = document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]');
    homeTab?.classList.add("active");
    $("#panel-home")?.classList.add("active");
  }

  const onboarding = $("#home-onboarding");
  const dash = $("#home-dashboard");
  if (onboarding && dash) {
    const hasId = Boolean(state?.identity);
    onboarding.hidden = hasId;
    dash.hidden = !hasId;
  }
  if (dash && state?.identity) {
    const count = state.credentials.length;
    const el = $("#home-cred-count");
    if (el) {
      el.textContent =
        count === 0
          ? "Vacío"
          : `${count} VC${count === 1 ? "" : "s"}`;
    }
    const netStat = $("#home-network-stat");
    if (netStat) {
      netStat.textContent = networkMeta(state.settings.network).short;
    }
  }
}

function closeNetworkMenu() {
  const menu = $("#network-menu");
  const pill = $("#network-pill") as HTMLButtonElement | null;
  if (menu) menu.hidden = true;
  if (pill) pill.setAttribute("aria-expanded", "false");
}

function renderNetworkSwitcher() {
  if (!state) return;
  const meta = networkMeta(state.settings.network);
  const pill = $("#network-pill") as HTMLButtonElement | null;
  const label = $("#network-pill-label");
  if (pill) {
    pill.dataset.status = meta.status;
    pill.title = `${meta.label} · chain ${meta.chainId}`;
  }
  if (label) label.textContent = meta.short;

  const list = $("#network-menu-list");
  if (!list) return;
  list.innerHTML = NETWORK_CATALOG.map((n) => {
    const active = n.id === state!.settings.network;
    return `<button type="button" class="network-option${active ? " active" : ""}" role="option" data-network="${n.id}" data-status="${n.status}" aria-selected="${active}">
      <span class="name">${n.label}</span>
      <span class="badge">${statusLabel(n.status)}</span>
      <span class="meta">${n.hint} · ${n.chainId}</span>
    </button>`;
  }).join("");
}

function renderIdentity() {
  const bar = $("#identity-bar");
  const revealBtn = $("#btn-reveal-secrets");
  if (!state) return;
  renderNetworkSwitcher();

  if (!state.identity) {
    bar.classList.remove("has-id");
    bar.innerHTML = `<p class="muted">Sin identidad. Crea o importa mnemonic / clave.</p>`;
    if (revealBtn) revealBtn.hidden = true;
    applyUiMode();
    return;
  }
  const sub = state.identity.substrate;
  const meta = networkMeta(state.settings.network);
  bar.classList.add("has-id");
  bar.innerHTML = `
    <div class="id-row">
      <p class="did">${state.identity.did}</p>
      <span class="id-chip">${meta.short}</span>
    </div>
    <p class="addr">EVM/PVM ${short(state.identity.address, 8)}</p>
    ${
      sub
        ? `<p class="addr">sr25519 ${short(sub.sr25519Address, 8)}</p>`
        : `<p class="addr muted">Sin Substrate (importa mnemonic)</p>`
    }
  `;
  if (revealBtn) {
    revealBtn.hidden = !(state.identity.mnemonic || state.identity.privateKey);
  }
  applyUiMode();
  void refreshBalance();
}

async function refreshBalance() {
  const el = $("#home-balance");
  if (!el || !state?.identity) return;
  el.textContent = "Saldo: …";
  try {
    const res = await send({
      type: "ACTION",
      action: "rpc.ping",
      payload: {},
    });
    // Prefer eth_getBalance via a tiny path — use ACTION if we add balance later.
    // For now show ping ok + address.
    if (res.ok) {
      const meta = networkMeta(state.settings.network);
      el.textContent = `${meta.label} · RPC lista`;
    } else {
      el.textContent = "Red: sin respuesta RPC";
    }
  } catch {
    el.textContent = "Red: error";
  }
}

async function renderAuthorizePanel() {
  const panel = $("#authorize-panel");
  if (!panel) return;
  const res = await send({ type: "GET_PENDING_AUTH" });
  const pending = res.ok
    ? (res.data as { origin?: string; issuerDid?: string } | null)
    : null;
  if (!pending?.origin) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("#authorize-origin").textContent = pending.origin;
  $("#authorize-did").textContent = pending.issuerDid ?? "";
  setStatus("Hay una dapp esperando tu aprobación", "ok");
}

async function renderHolderPanels() {
  const savePanel = $("#save-panel");
  const sharePanel = $("#share-panel");
  const provePanel = $("#prove-panel");
  if (!savePanel || !sharePanel) return;

  const res = await send({ type: "GET_PENDING_HOLDER" });
  const pending = res.ok ? (res.data as Record<string, unknown> | null) : null;

  if (!pending || pending.kind !== "save") {
    savePanel.hidden = true;
  } else {
    savePanel.hidden = false;
    $("#save-origin").textContent = String(pending.origin ?? "");
    $("#save-schema").textContent = `Schema: ${schemaLabel(String(pending.schemaKey ?? ""))}`;
    $("#save-issuer").textContent = `Issuer ${short(String(pending.issuerDid ?? ""), 16)}`;
    $("#save-subject").textContent = `Subject ${short(String(pending.subjectDid ?? ""), 16)}`;
    setStatus("dApp quiere guardar una credencial — revisa y confirma", "ok");
  }

  if (provePanel) {
    if (!pending || pending.kind !== "prove") {
      provePanel.hidden = true;
    } else {
      provePanel.hidden = false;
      $("#prove-origin").textContent = String(pending.origin ?? "");
      const allow = Array.isArray(pending.allowlist)
        ? pending.allowlist.map(String).join(", ")
        : "—";
      $("#prove-policy").textContent = `minScore ${String(pending.minScoreBps ?? "")} · allowlist ${allow}`;
      $("#prove-creds").textContent = `live ${short(String(pending.liveCredHash ?? ""), 8)} · res ${short(String(pending.resCredHash ?? ""), 8)}`;
      setStatus("dApp pide prueba ZK sin revelar claims", "ok");
    }
  }

  if (!pending || pending.kind !== "share") {
    sharePanel.hidden = true;
    shareSelectedHash = null;
    return;
  }

  sharePanel.hidden = false;
  sharePendingMode = pending.mode === "claims" ? "claims" : "credential";
  shareRequiredDisclose = Array.isArray(pending.disclose)
    ? pending.disclose.map(String)
    : [];
  shareCandidates = Array.isArray(pending.candidates)
    ? (pending.candidates as ShareCandidateUi[])
    : [];

  const modeHint = $("#share-mode-hint");
  if (modeHint) {
    modeHint.textContent =
      sharePendingMode === "claims"
        ? "Modo claims: revelas solo campos elegidos (sin JWT completo)."
        : "Modo credential: se comparte el JWT completo + firma del challenge.";
  }
  $("#share-origin").textContent = String(pending.origin ?? "");
  const keys = Array.isArray(pending.schemaKeys)
    ? pending.schemaKeys.map((k) => schemaLabel(String(k))).join(", ")
    : "";
  $("#share-schemas").textContent = `Pide: ${keys || "—"}`;
  $("#share-challenge").textContent = `Challenge ${short(String(pending.challenge ?? ""), 12)}`;

  const list = $("#share-candidates");
  const empty = $("#share-empty");
  const claimsBox = $("#share-claims-box");
  if (claimsBox) claimsBox.hidden = true;

  if (!shareCandidates.length) {
    list.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    list.innerHTML = shareCandidates
      .map(
        (c) => `
      <button type="button" class="vault-item share-pick" data-hash="${escapeHtml(c.credHash)}" style="width:100%;text-align:left">
        <span class="schema-pill">${escapeHtml(schemaLabel(c.schemaKey))}</span>
        <strong>${escapeHtml(c.label || schemaLabel(c.schemaKey))}</strong>
        <div class="meta">${escapeHtml(short(c.credHash, 8))}<br/>${escapeHtml(short(c.issuerDid, 14))}</div>
      </button>`
      )
      .join("");
  }
  setStatus(
    sharePendingMode === "claims"
      ? "Elige VC y claims a revelar"
      : "dApp pide una credencial — elige cuál compartir",
    "ok"
  );
}

type ShareCandidateUi = {
  credHash: string;
  schemaKey: string;
  label: string;
  issuerDid: string;
  claimKeys?: string[];
  claimPreview?: Record<string, unknown>;
};

let sharePendingMode: "credential" | "claims" = "credential";
let shareRequiredDisclose: string[] = [];
let shareCandidates: ShareCandidateUi[] = [];
let shareSelectedHash: string | null = null;

function renderShareClaimsPicker(candidate: ShareCandidateUi) {
  const box = $("#share-claims-box");
  const list = $("#share-claims-list");
  if (!box || !list) return;
  const preview = candidate.claimPreview ?? {};
  const keys = Object.keys(preview);
  if (!keys.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  list.innerHTML = keys
    .map((k) => {
      const required = shareRequiredDisclose.includes(k);
      const checked = required || shareRequiredDisclose.length === 0;
      const val = preview[k];
      const shown =
        typeof val === "string" || typeof val === "number"
          ? String(val)
          : JSON.stringify(val);
      return `<label>
        <input type="checkbox" data-claim="${escapeHtml(k)}" ${checked ? "checked" : ""} ${required ? "disabled" : ""} />
        <span><strong>${escapeHtml(k)}</strong>${required ? " (requerido)" : ""}<br/><span class="claim-val">${escapeHtml(shown)}</span></span>
      </label>`;
    })
    .join("");
}

function openBackupPanel(opts: {
  mnemonic?: string;
  privateKey: string;
  forceAck?: boolean;
}) {
  const panel = $("#backup-panel");
  const shell = document.querySelector(".shell") as HTMLElement;
  ($("#backup-mnemonic") as HTMLTextAreaElement).value = opts.mnemonic ?? "";
  ($("#backup-pk") as HTMLInputElement).value = opts.privateKey;
  const ack = $("#backup-ack") as HTMLInputElement;
  const done = $("#btn-backup-done") as HTMLButtonElement;
  ack.checked = false;
  done.disabled = true;
  panel.hidden = false;
  shell.classList.add("backup-lock");
  setStatus("Respalda mnemonic y PK antes de continuar", "ok");
}

function closeBackupPanel() {
  const panel = $("#backup-panel");
  const shell = document.querySelector(".shell") as HTMLElement;
  panel.hidden = true;
  shell.classList.remove("backup-lock");
  ($("#backup-mnemonic") as HTMLTextAreaElement).value = "";
  ($("#backup-pk") as HTMLInputElement).value = "";
  ($("#backup-ack") as HTMLInputElement).checked = false;
}

function renderVault() {
  const list = $("#vault-list");
  if (!list) return;
  if (!state || state.credentials.length === 0) {
    list.innerHTML = `<p class="muted">Vacío — importa un JWT o recibe uno de un attester.</p>`;
    return;
  }
  const lab = uiMode() === "lab";
  list.innerHTML = state.credentials
    .map((c) => {
      const schema = schemaLabel(c.schemaKey);
      return `
    <div class="vault-item" data-hash="${c.credHash}">
      <span class="schema-pill">${escapeHtml(schema)}</span>
      <strong>${escapeHtml(c.label || schema)}</strong>
      <div class="meta">${short(c.credHash, 8)}<br/>${escapeHtml(short(c.subjectDid, 14))}</div>
      <div class="vault-actions">
        <button type="button" class="btn tiny" data-vault="verify">Verificar</button>
        <button type="button" class="btn tiny" data-vault="export">JSON</button>
        <button type="button" class="btn tiny" data-vault="copy">Copiar JWT</button>
        ${lab ? `<button type="button" class="btn tiny" data-vault="fill-revoke">Revocar…</button>` : ""}
        <button type="button" class="btn tiny danger" data-vault="remove">Quitar</button>
      </div>
    </div>`;
    })
    .join("");
}

function renderTrustedSites() {
  const box = $("#trusted-sites");
  if (!box) return;
  const sites = state?.trustedSites ?? [];
  if (!sites.length) {
    box.innerHTML = `<p class="muted">Ningún origen verificado aún.</p>`;
    return;
  }
  box.innerHTML = sites
    .map(
      (s) => `
    <div class="vault-item" data-origin="${escapeHtml(s.origin)}">
      <strong>${escapeHtml(s.origin)}</strong>
      <div class="meta">${escapeHtml(short(s.issuerDid, 12))}<br/>hasta ${escapeHtml(s.expiresAt.slice(0, 19))}</div>
      <div class="vault-actions">
        <button type="button" class="btn tiny danger" data-forget-site>Olvidar</button>
      </div>
    </div>`
    )
    .join("");
}

function renderSettings() {
  if (!state) return;
  ($("#settings-network") as HTMLSelectElement).value = state.settings.network;
  ($("#settings-rpc") as HTMLInputElement).value = state.settings.rpcUrl;
  const modeEl = $("#settings-ui-mode") as HTMLSelectElement | null;
  if (modeEl) modeEl.value = uiMode();
  const ws = $("#settings-ws") as HTMLInputElement | null;
  if (ws) ws.value = state.settings.substrateWsUrl ?? "";
  $("#settings-addresses").textContent = JSON.stringify(
    state.settings.addresses,
    null,
    2
  );

  const nodes = $("#known-nodes");
  if (nodes) {
    if (state.knownNodes.length) {
      nodes.textContent =
        "Nodos recientes: " +
        state.knownNodes
          .map((n) => `${n.name} (${short(n.address, 6)})`)
          .join(", ");
    } else {
      nodes.textContent = "";
    }
  }

  const tipNode = $("#tip-node") as HTMLInputElement | null;
  const ecoNode = $("#eco-node") as HTMLInputElement | null;
  const scoreNode = $("#score-node") as HTMLInputElement | null;
  const defaultNode =
    state.knownNodes[0]?.address ||
    state.settings.addresses.PerantoNode ||
    "";
  if (tipNode && defaultNode && !tipNode.value) tipNode.value = defaultNode;
  if (ecoNode && defaultNode && !ecoNode.value) ecoNode.value = defaultNode;
  if (scoreNode && defaultNode && !scoreNode.value) scoreNode.value = defaultNode;

  if (state.identity) {
    const scoreAccount = $("#score-account") as HTMLInputElement | null;
    const vcSubject = $("#vc-subject") as HTMLInputElement | null;
    if (scoreAccount && !scoreAccount.value)
      scoreAccount.value = state.identity.address;
    if (vcSubject && !vcSubject.value) vcSubject.value = state.identity.address;
    const resolveDid = $("#resolve-did") as HTMLInputElement | null;
    if (resolveDid && !resolveDid.value) resolveDid.value = state.identity.did;
  }

  renderTrustedSites();
  applyUiMode();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refresh() {
  const res = await send({ type: "GET_STATE" });
  if (!res.ok || !res.state) {
    setStatus(res.ok === false ? res.error : "Error de estado", "err");
    return;
  }
  state = res.state;
  if (!state.settings.uiMode) state.settings.uiMode = "holder";
  renderIdentity();
  renderVault();
  renderSettings();
  await renderAuthorizePanel();
  await renderHolderPanels();
}

function payloadFor(action: string): Record<string, unknown> {
  switch (action) {
    case "did.resolve":
      return { did: ($("#resolve-did") as HTMLInputElement).value.trim() };
    case "attester.join":
    case "attester.isAuthorized":
      return {
        schemaKey: (
          ($("#attester-schema") as HTMLSelectElement | HTMLInputElement)
            .value || ""
        ).trim(),
      };
    case "vc.issue":
      return {
        subject: ($("#vc-subject") as HTMLInputElement).value.trim(),
        sampleId: ($("#vc-sample") as HTMLInputElement).value.trim(),
        testType: ($("#vc-type") as HTMLInputElement).value.trim(),
        result: ($("#vc-result") as HTMLInputElement).value.trim(),
        unit: ($("#vc-unit") as HTMLInputElement).value.trim(),
        labName: ($("#vc-lab") as HTMLInputElement).value.trim(),
      };
    case "vc.verify":
    case "vc.import":
      return { jwt: ($("#vc-jwt") as HTMLTextAreaElement).value.trim() };
    case "vc.revoke":
      return {
        credHash: ($("#vc-revoke-hash") as HTMLInputElement).value.trim(),
        reason: ($("#vc-revoke-reason") as HTMLInputElement).value.trim(),
      };
    case "name.register":
      return { label: ($("#name-label") as HTMLInputElement).value.trim() };
    case "name.resolve":
      return { label: ($("#name-resolve") as HTMLInputElement).value.trim() };
    case "disco.create":
      return { name: ($("#disco-name") as HTMLInputElement).value.trim() };
    case "disco.tip":
      return {
        node: ($("#tip-node") as HTMLInputElement).value.trim(),
        to: ($("#tip-to") as HTMLInputElement).value.trim(),
        value: ($("#tip-value") as HTMLInputElement).value.trim(),
      };
    case "disco.contribute":
      return {
        node: ($("#eco-node") as HTMLInputElement).value.trim(),
        value: ($("#eco-value") as HTMLInputElement).value.trim(),
      };
    case "disco.harvest":
      return {
        node: ($("#eco-node") as HTMLInputElement).value.trim(),
        periodId: ($("#eco-period") as HTMLInputElement).value.trim(),
      };
    case "disco.distribute":
      return {
        periodId: ($("#eco-period") as HTMLInputElement).value.trim(),
      };
    case "disco.scores":
    case "disco.member.add":
      return {
        node: ($("#score-node") as HTMLInputElement).value.trim(),
        account: ($("#score-account") as HTMLInputElement).value.trim(),
      };
    case "sign.payload":
      return {
        scheme: ($("#sign-scheme") as HTMLSelectElement).value,
        encoding: ($("#sign-encoding") as HTMLSelectElement).value,
        message: ($("#sign-message") as HTMLTextAreaElement).value,
      };
    case "sign.extrinsic":
      return {
        scheme: ($("#ext-scheme") as HTMLSelectElement).value,
        payloadHex: ($("#ext-payload") as HTMLTextAreaElement).value.trim(),
      };
    case "sign.verify":
      return {
        scheme: ($("#verify-scheme") as HTMLSelectElement).value,
        message: ($("#verify-message") as HTMLTextAreaElement).value,
        signature: ($("#verify-sig") as HTMLInputElement).value.trim(),
        addressOrPublicKey: ($("#verify-addr") as HTMLInputElement).value.trim(),
        encoding: ($("#sign-encoding") as HTMLSelectElement).value,
      };
    case "wallet.addresses":
      return {};
    default:
      return {};
  }
}

async function runAction(action: string, extra?: Record<string, unknown>) {
  setStatus(`Ejecutando ${action}…`);
  const buttons = document.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const res = await send({
      type: "ACTION",
      action,
      payload: { ...payloadFor(action), ...extra },
    });
    if (!res.ok) {
      setStatus(res.error, "err");
      showOutput({ error: res.error });
      return;
    }
    if (res.state) {
      state = res.state;
      renderIdentity();
      renderVault();
      renderSettings();
    }
    setStatus(`${action} OK`, "ok");
    showOutput(res.data);
    if (action === "wallet.addresses" && res.data) {
      $("#sign-addresses").textContent = JSON.stringify(res.data, null, 2);
    }
    if (action === "sign.payload" || action === "sign.extrinsic") {
      const d = res.data as { signature?: string; address?: string; scheme?: string };
      if (d?.signature) {
        ($("#verify-sig") as HTMLInputElement).value = d.signature;
        ($("#verify-addr") as HTMLInputElement).value = d.address ?? "";
        ($("#verify-scheme") as HTMLSelectElement).value = d.scheme ?? "secp256k1";
        ($("#verify-message") as HTMLTextAreaElement).value =
          ($("#sign-message") as HTMLTextAreaElement).value ||
          ($("#ext-payload") as HTMLTextAreaElement).value;
      }
    }
    if (action === "vc.issue" && res.data && typeof res.data === "object") {
      const d = res.data as { jwt?: string; credHash?: string };
      if (d.jwt) ($("#vc-jwt") as HTMLTextAreaElement).value = d.jwt;
      if (d.credHash)
        ($("#vc-revoke-hash") as HTMLInputElement).value = d.credHash;
    }
    if (action === "disco.create" && res.data && typeof res.data === "object") {
      const d = res.data as { node?: string };
      if (d.node) {
        ($("#tip-node") as HTMLInputElement).value = d.node;
        ($("#eco-node") as HTMLInputElement).value = d.node;
        ($("#score-node") as HTMLInputElement).value = d.node;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(msg, "err");
    showOutput({ error: msg });
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function bindTabs() {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.hidden) return;
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      document
        .querySelectorAll(".panel")
        .forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const id = tab.dataset.tab;
      const panel = $(`#panel-${id}`);
      if (panel) panel.classList.add("active");
    });
  });
}

function bindActions() {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action) void runAction(action);
    });
  });

  $("#btn-create-did").addEventListener("click", async () => {
    const res = await send({ type: "CREATE_IDENTITY" });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderIdentity();
    renderSettings();
    const id = state.identity!;
    openBackupPanel({
      mnemonic: id.mnemonic,
      privateKey: id.privateKey,
    });
    showOutput({
      saved: true,
      did: id.did,
      evm: id.address,
      mnemonic: id.mnemonic,
      privateKey: id.privateKey,
      sr25519: id.substrate?.sr25519Address,
      ed25519: id.substrate?.ed25519Address,
    });
  });

  $("#backup-ack").addEventListener("change", () => {
    ($("#btn-backup-done") as HTMLButtonElement).disabled = !(
      $("#backup-ack") as HTMLInputElement
    ).checked;
  });

  $("#btn-backup-done").addEventListener("click", () => {
    closeBackupPanel();
    setStatus("Wallet lista — mnemonic y PK guardados localmente", "ok");
  });

  $("#btn-copy-mnemonic").addEventListener("click", async () => {
    const v = ($("#backup-mnemonic") as HTMLTextAreaElement).value;
    if (!v) return;
    await navigator.clipboard.writeText(v);
    setStatus("Mnemonic copiado", "ok");
  });

  $("#btn-copy-pk").addEventListener("click", async () => {
    const v = ($("#backup-pk") as HTMLInputElement).value;
    if (!v) return;
    await navigator.clipboard.writeText(v);
    setStatus("Clave privada copiada", "ok");
  });

  $("#btn-reveal-secrets").addEventListener("click", () => {
    if (!state?.identity) return;
    if (
      !confirm(
        "Vas a mostrar mnemonic y clave privada en pantalla. ¿Continuar?"
      )
    ) {
      return;
    }
    openBackupPanel({
      mnemonic: state.identity.mnemonic,
      privateKey: state.identity.privateKey,
    });
  });

  $("#btn-import-toggle").addEventListener("click", () => {
    const box = $("#import-box");
    box.hidden = !box.hidden;
  });

  $("#btn-import-mnemonic").addEventListener("click", async () => {
    const mnemonic = ($("#import-mnemonic") as HTMLTextAreaElement).value;
    const res = await send({ type: "IMPORT_MNEMONIC", mnemonic });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    ($("#import-mnemonic") as HTMLTextAreaElement).value = "";
    $("#import-box").hidden = true;
    renderIdentity();
    renderSettings();
    const id = state.identity!;
    openBackupPanel({
      mnemonic: id.mnemonic,
      privateKey: id.privateKey,
    });
    setStatus("Mnemonic importado — confirma el respaldo", "ok");
  });

  $("#btn-import-did").addEventListener("click", async () => {
    const key = ($("#import-key") as HTMLInputElement).value;
    const res = await send({ type: "IMPORT_IDENTITY", privateKey: key });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    ($("#import-key") as HTMLInputElement).value = "";
    $("#import-box").hidden = true;
    renderIdentity();
    renderSettings();
    openBackupPanel({
      mnemonic: undefined,
      privateKey: state.identity!.privateKey,
    });
    setStatus("Clave EVM importada y guardada", "ok");
  });

  $("#btn-clear-did").addEventListener("click", async () => {
    if (!confirm("¿Borrar identidad local de Aura?")) return;
    const res = await send({ type: "CLEAR_IDENTITY" });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderIdentity();
    setStatus("Identidad borrada", "ok");
  });

  $("#btn-save-network").addEventListener("click", async () => {
    const network = ($("#settings-network") as HTMLSelectElement)
      .value as PerantoNetwork;
    const rpcUrl = ($("#settings-rpc") as HTMLInputElement).value.trim();
    const substrateWsUrl = ($("#settings-ws") as HTMLInputElement).value.trim();
    const res = await send({
      type: "UPDATE_SETTINGS",
      settings: { network, rpcUrl, substrateWsUrl },
    });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderIdentity();
    renderSettings();
    const meta = networkMeta(network);
    setStatus(
      meta.status === "soon"
        ? `Red ${meta.label}: importa deploy JSON para contratos`
        : `Red ${meta.label}`,
      "ok"
    );
  });

  async function switchNetwork(network: PerantoNetwork) {
    closeNetworkMenu();
    if (!state || state.settings.network === network) return;
    const meta = networkMeta(network);
    const res = await send({
      type: "UPDATE_SETTINGS",
      settings: { network },
    });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderIdentity();
    renderSettings();
    setStatus(
      meta.status === "soon"
        ? `${meta.label}: sin deploy aún — importa JSON en Ajustes`
        : `Cambiado a ${meta.label}`,
      "ok"
    );
  }

  $("#network-pill")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("#network-menu");
    const pill = $("#network-pill") as HTMLButtonElement;
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    pill.setAttribute("aria-expanded", open ? "true" : "false");
  });

  $("#network-menu-list")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-network]"
    );
    if (!btn?.dataset.network) return;
    void switchNetwork(btn.dataset.network as PerantoNetwork);
  });

  document.addEventListener("click", (e) => {
    const sw = document.querySelector(".network-switch");
    if (sw && !sw.contains(e.target as Node)) closeNetworkMenu();
  });

  $("#btn-import-deploy").addEventListener("click", async () => {
    const json = ($("#settings-deploy") as HTMLTextAreaElement).value;
    const res = await send({ type: "IMPORT_DEPLOYMENT", json });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderIdentity();
    renderSettings();
    setStatus("Deployment importado — probando RPC…", "ok");
    await runAction("rpc.ping");
  });

  $("#vault-list").addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest(
      "[data-vault]"
    ) as HTMLButtonElement | null;
    if (!btn || !state) return;
    const item = btn.closest(".vault-item") as HTMLElement;
    const hash = item.dataset.hash!;
    const cred = state.credentials.find((c) => c.credHash === hash);
    if (!cred) return;
    const op = btn.dataset.vault;
    if (op === "verify") {
      ($("#vc-jwt") as HTMLTextAreaElement).value = cred.jwt;
      await runAction("vc.verify", { jwt: cred.jwt });
    } else if (op === "export") {
      const file = buildCredentialFile({
        jwt: cred.jwt,
        label: cred.label,
        schemaKey: cred.schemaKey,
        credHash: cred.credHash,
        issuerDid: cred.issuerDid,
        subjectDid: cred.subjectDid,
      });
      downloadCredentialJson(file);
      setStatus("JSON exportado (.peranto.json)", "ok");
    } else if (op === "copy") {
      await navigator.clipboard.writeText(cred.jwt);
      setStatus("JWT copiado", "ok");
    } else if (op === "fill-revoke") {
      ($("#vc-revoke-hash") as HTMLInputElement).value = cred.credHash;
      setStatus("credHash listo para revocar", "ok");
    } else if (op === "remove") {
      await runAction("vc.remove", { credHash: cred.credHash });
    }
  });

  $("#trusted-sites")?.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest(
      "[data-forget-site]"
    ) as HTMLButtonElement | null;
    if (!btn) return;
    const item = btn.closest(".vault-item") as HTMLElement | null;
    const origin = item?.dataset.origin;
    if (!origin) return;
    const res = await send({ type: "FORGET_TRUSTED_SITE", origin });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderTrustedSites();
    setStatus(`Olvidado ${origin}`, "ok");
  });

  $("#btn-forget-all-sites")?.addEventListener("click", async () => {
    if (!confirm("¿Olvidar todos los orígenes verificados?")) return;
    const res = await send({ type: "FORGET_ALL_TRUSTED_SITES" });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderTrustedSites();
    setStatus("Sitios de confianza borrados", "ok");
  });

  $("#btn-save-mode")?.addEventListener("click", async () => {
    const mode = ($("#settings-ui-mode") as HTMLSelectElement).value as
      | "holder"
      | "lab";
    const res = await send({
      type: "UPDATE_SETTINGS",
      settings: { uiMode: mode },
    });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state!;
    renderIdentity();
    renderVault();
    renderSettings();
    setStatus(mode === "lab" ? "Modo Lab activo" : "Modo Holder activo", "ok");
  });

  $("#btn-go-credentials")?.addEventListener("click", () => {
    const tab = document.querySelector<HTMLButtonElement>(
      '.tab[data-tab="vc"]'
    );
    tab?.click();
  });

  $("#btn-copy-did")?.addEventListener("click", async () => {
    if (!state?.identity?.did) return;
    await navigator.clipboard.writeText(state.identity.did);
    setStatus("DID copiado", "ok");
  });

  $("#btn-approve-site")?.addEventListener("click", async () => {
    const res = await send({ type: "APPROVE_PENDING_SITE" });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state ?? state;
    await renderAuthorizePanel();
    renderTrustedSites();
    setStatus("Sitio aprobado — la dapp puede reintentar", "ok");
    showOutput(res.data);
  });

  $("#btn-reject-site")?.addEventListener("click", async () => {
    const res = await send({ type: "REJECT_PENDING_SITE" });
    if (!res.ok) return setStatus(res.error, "err");
    state = res.state ?? state;
    await renderAuthorizePanel();
    renderTrustedSites();
    setStatus("Sitio rechazado", "ok");
  });

  $("#btn-approve-save")?.addEventListener("click", async () => {
    const res = await send({ type: "APPROVE_SAVE_CREDENTIAL" });
    if (!res.ok) return setStatus(res.error, "err");
    setStatus("Guardando… espera a que la dapp confirme", "ok");
    // SW completes addCredential; refresh shortly
    setTimeout(() => void refresh(), 600);
  });

  $("#btn-reject-save")?.addEventListener("click", async () => {
    const res = await send({ type: "REJECT_HOLDER_REQUEST", reason: "rejected-save" });
    if (!res.ok) return setStatus(res.error, "err");
    await renderHolderPanels();
    setStatus("Guardado rechazado", "ok");
  });

  $("#btn-approve-prove")?.addEventListener("click", async () => {
    const res = await send({ type: "APPROVE_PROVE_COMPLIANCE" });
    if (!res.ok) return setStatus(res.error, "err");
    setStatus("Prueba ZK aprobada", "ok");
    await refresh();
  });
  $("#btn-reject-prove")?.addEventListener("click", async () => {
    await send({
      type: "REJECT_HOLDER_REQUEST",
      reason: "rejected-prove",
    });
    setStatus("Prueba ZK rechazada", "err");
    await refresh();
  });
  $("#btn-reject-share")?.addEventListener("click", async () => {
    const res = await send({
      type: "REJECT_HOLDER_REQUEST",
      reason: "rejected-share",
    });
    if (!res.ok) return setStatus(res.error, "err");
    await renderHolderPanels();
    setStatus("Compartir rechazado", "ok");
  });

  $("#share-candidates")?.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      ".share-pick"
    );
    if (!btn?.dataset.hash) return;
    const hash = btn.dataset.hash;
    shareSelectedHash = hash;
    document
      .querySelectorAll(".share-pick")
      .forEach((el) => el.classList.remove("selected"));
    btn.classList.add("selected");

    if (sharePendingMode === "claims") {
      const cand = shareCandidates.find((c) => c.credHash === hash);
      if (cand) renderShareClaimsPicker(cand);
      setStatus("Marca claims y confirma", "ok");
      return;
    }

    const res = await send({
      type: "APPROVE_SHARE_CREDENTIAL",
      credHash: hash,
    });
    if (!res.ok) return setStatus(res.error, "err");
    setStatus("Compartiendo… la dapp recibirá la presentación", "ok");
    setTimeout(() => void refresh(), 600);
  });

  $("#btn-confirm-share-claims")?.addEventListener("click", async () => {
    if (!shareSelectedHash) {
      return setStatus("Elige una credencial primero", "err");
    }
    const checked = [
      ...document.querySelectorAll<HTMLInputElement>(
        "#share-claims-list input[data-claim]"
      ),
    ]
      .filter((el) => el.checked || el.disabled)
      .map((el) => el.dataset.claim!)
      .filter(Boolean);
    for (const req of shareRequiredDisclose) {
      if (!checked.includes(req)) {
        return setStatus(`Falta claim requerido: ${req}`, "err");
      }
    }
    const res = await send({
      type: "APPROVE_SHARE_CREDENTIAL",
      credHash: shareSelectedHash,
      disclose: checked,
    });
    if (!res.ok) return setStatus(res.error, "err");
    setStatus("Compartiendo claims firmados…", "ok");
    setTimeout(() => void refresh(), 600);
  });
}

bindTabs();
bindActions();
void refresh().then(() => setStatus("Listo"));
// Mantener paneles holder al día si llega una solicitud con el popup abierto
setInterval(() => {
  void renderAuthorizePanel();
  void renderHolderPanels();
}, 1500);
