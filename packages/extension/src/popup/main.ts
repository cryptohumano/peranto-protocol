import type {
  AuraState,
  ExtensionMessage,
  ExtensionResponse,
} from "../lib/types";
import { dispatch } from "../lib/dispatch";

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

function renderIdentity() {
  const bar = $("#identity-bar");
  const pill = $("#network-pill");
  const revealBtn = $("#btn-reveal-secrets");
  if (!state) return;
  pill.textContent = state.settings.network;

  if (!state.identity) {
    bar.innerHTML = `<p class="muted">Sin identidad. Crea o importa mnemonic / clave.</p>`;
    if (revealBtn) revealBtn.hidden = true;
    return;
  }
  const sub = state.identity.substrate;
  bar.innerHTML = `
    <p class="did">${state.identity.did}</p>
    <p class="addr">EVM/PVM ${state.identity.address}</p>
    ${
      sub
        ? `<p class="addr">sr25519 ${short(sub.sr25519Address, 8)}</p>
           <p class="addr">ed25519 ${short(sub.ed25519Address, 8)}</p>`
        : `<p class="addr muted">Sin Substrate (importa mnemonic)</p>`
    }
  `;
  if (revealBtn) {
    revealBtn.hidden = !(state.identity.mnemonic || state.identity.privateKey);
  }
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
  if (!state || state.credentials.length === 0) {
    list.innerHTML = `<p class="muted">Vacío — emite o importa un JWT.</p>`;
    return;
  }
  list.innerHTML = state.credentials
    .map(
      (c) => `
    <div class="vault-item" data-hash="${c.credHash}">
      <strong>${escapeHtml(c.label)}</strong>
      <div class="meta">${short(c.credHash, 8)}<br/>${escapeHtml(c.subjectDid)}</div>
      <div class="vault-actions">
        <button type="button" class="btn tiny" data-vault="verify">Verificar</button>
        <button type="button" class="btn tiny" data-vault="copy">Copiar JWT</button>
        <button type="button" class="btn tiny" data-vault="fill-revoke">Revocar…</button>
        <button type="button" class="btn tiny danger" data-vault="remove">Quitar</button>
      </div>
    </div>`
    )
    .join("");
}

function renderSettings() {
  if (!state) return;
  ($("#settings-network") as HTMLSelectElement).value = state.settings.network;
  ($("#settings-rpc") as HTMLInputElement).value = state.settings.rpcUrl;
  const ws = $("#settings-ws") as HTMLInputElement | null;
  if (ws) ws.value = state.settings.substrateWsUrl ?? "";
  $("#settings-addresses").textContent = JSON.stringify(
    state.settings.addresses,
    null,
    2
  );

  const nodes = $("#known-nodes");
  if (state.knownNodes.length) {
    nodes.textContent =
      "Nodos recientes: " +
      state.knownNodes.map((n) => `${n.name} (${short(n.address, 6)})`).join(", ");
  } else {
    nodes.textContent = "";
  }

  // Prefill nodes if empty
  const tipNode = $("#tip-node") as HTMLInputElement;
  const ecoNode = $("#eco-node") as HTMLInputElement;
  const scoreNode = $("#score-node") as HTMLInputElement;
  const defaultNode =
    state.knownNodes[0]?.address ||
    state.settings.addresses.PerantoNode ||
    "";
  if (defaultNode && !tipNode.value) tipNode.value = defaultNode;
  if (defaultNode && !ecoNode.value) ecoNode.value = defaultNode;
  if (defaultNode && !scoreNode.value) scoreNode.value = defaultNode;

  if (state.identity) {
    const scoreAccount = $("#score-account") as HTMLInputElement;
    const vcSubject = $("#vc-subject") as HTMLInputElement;
    if (!scoreAccount.value) scoreAccount.value = state.identity.address;
    if (!vcSubject.value) vcSubject.value = state.identity.address;
    const resolveDid = $("#resolve-did") as HTMLInputElement;
    if (!resolveDid.value) resolveDid.value = state.identity.did;
  }
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
  renderIdentity();
  renderVault();
  renderSettings();
}

function payloadFor(action: string): Record<string, unknown> {
  switch (action) {
    case "did.resolve":
      return { did: ($("#resolve-did") as HTMLInputElement).value.trim() };
    case "attester.join":
    case "attester.isAuthorized":
      return {
        schemaKey: ($("#attester-schema") as HTMLInputElement).value.trim(),
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
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      document
        .querySelectorAll(".panel")
        .forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const id = tab.dataset.tab;
      $(`#panel-${id}`).classList.add("active");
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
    const network = ($("#settings-network") as HTMLSelectElement).value as
      | "hardhat"
      | "paseo";
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
    setStatus("Red actualizada", "ok");
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
}

bindTabs();
bindActions();
void refresh().then(() => setStatus("Listo"));
