const DESK = "0xA82a249c48236fd75a1Dd84d2516070b754eAB64";
const CHAIN_ID = 420420417;
const RPC = "https://eth-rpc-testnet.polkadot.io/";
const SCHEMA = "peranto:DayPass:v1";
const SELF_ATTEST = "0xf93133d2";
const DEMO_SUBJECT = "0xcbce3310";

const form = document.querySelector("#form");
const statusNode = document.querySelector("#status");
const done = document.querySelector("#done");
const button = document.querySelector("#go");

function wallet() {
  if (window.aura?.request) return window.aura;
  if (window.ethereum?.request) return window.ethereum;
  return null;
}

function say(text, bad = false) {
  statusNode.textContent = text;
  statusNode.className = bad ? "status bad" : "status";
}

function mexicoDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function human(error) {
  const text = String(error?.shortMessage || error?.message || error || "No se pudo completar.");
  if (/user rejected|denied|rechaz/i.test(text)) return "Cancelaste la firma en la cartera.";
  if (/domain linkage|did-configuration/i.test(text)) {
    return "La cartera no reconoció este sitio. Ábrelo desde la página publicada de CiGo, con Aura o dentro de CiGo.";
  }
  if (/insufficient funds|fondos/i.test(text)) return "Esta cuenta no tiene PAS para el gas de Paseo.";
  if (/unknown schema/i.test(text)) return "El pase de día no está registrado en esta red.";
  return text.slice(0, 280);
}

async function portrait(name, file) {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 300;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a1018";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  } else {
    ctx.fillStyle = "#3da1bc";
    ctx.font = "600 28px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    const lines = name.trim().split(/\s+/).slice(0, 3);
    lines.forEach((line, index) => {
      ctx.fillText(line.slice(0, 16), canvas.width / 2, 140 + index * 36);
    });
  }
  const url = canvas.toDataURL("image/jpeg", 0.72);
  return url.slice(url.indexOf(",") + 1);
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || "La red no contestó.");
  return body.result;
}

async function alreadyAttested(account) {
  const data = DEMO_SUBJECT + account.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const raw = await rpc("eth_call", [{ to: DESK, data }, "latest"]);
  return BigInt(raw) === 1n;
}

async function waitReceipt(hash) {
  for (let i = 0; i < 30; i += 1) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("La red rechazó la marca de la taquilla.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("La marca de la taquilla sigue en camino. Revisa la cartera en unos segundos.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = wallet();
  if (!provider) {
    say("Abre esta página con Aura en el escritorio, o dentro del navegador de CiGo.", true);
    return;
  }
  button.disabled = true;
  done.hidden = true;
  try {
    say("Conectando la cartera…");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = accounts?.[0];
    if (!account) throw new Error("La cartera no entregó una cuenta.");
    const chainId = Number(await provider.request({ method: "eth_chainId" }));
    if (chainId !== CHAIN_ID) {
      throw new Error("Cambia Aura o CiGo a la red Paseo y vuelve a intentar.");
    }
    const name = document.querySelector("#name").value.trim();
    if (name.length < 2) throw new Error("Escribe el nombre que verá la puerta.");
    say("Preparando la fotografía…");
    const photo = await portrait(name, document.querySelector("#photo").files?.[0]);
    const gate = await provider.request({
      method: "peranto_action",
      params: ["attester.isAuthorized", { schemaKey: SCHEMA }],
    });
    if (!gate?.authorized) {
      say("Acepta en la cartera el alta para emitir este pase. No aparta saldo.");
      await provider.request({
        method: "peranto_action",
        params: ["attester.join", { schemaKey: SCHEMA }],
      });
    }
    say("Acepta en la cartera la firma y el ancla del pase.");
    const issued = await provider.request({
      method: "peranto_action",
      params: [
        "vc.issueClaims",
        {
          subject: account,
          schemaKey: SCHEMA,
          credentialType: "DayPass",
          label: "Pase de prueba",
          claims: {
            fullName: name,
            day: mexicoDay(),
            place: "Prueba",
            photo,
            status: "active",
          },
        },
      ],
    });
    let ticket = "La taquilla ya tenía marcada esta cuenta.";
    if (!(await alreadyAttested(account))) {
      say("Acepta en la cartera la marca para comprar boletos.");
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ to: DESK, data: SELF_ATTEST, value: "0x0" }],
      });
      await waitReceipt(hash);
      ticket = "La taquilla ya acepta esta cuenta.";
    }
    const credHash = String(issued?.credHash || "");
    document.querySelector("#summary").textContent = `El pase quedó en la cartera. En el puesto, preséntalo con CiGo. ${ticket}`;
    document.querySelector("#hash").textContent = credHash;
    done.hidden = false;
    say("Pase listo.");
  } catch (error) {
    say(human(error), true);
  } finally {
    button.disabled = false;
  }
});
