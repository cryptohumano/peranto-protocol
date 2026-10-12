(function () {
  const en = document.documentElement.lang === "en";
  const WA_NUMBER = "525621208481";
  const MAIL_TO = "outreach@peranto.app";
  const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(en ? "en-US" : "es-MX");

  document.querySelectorAll("a.lang").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!location.hash) return;
      event.preventDefault();
      const url = new URL(link.href, location.href);
      url.hash = location.hash;
      location.href = url.href;
    });
  });

  const menuBtn = document.querySelector(".menu-btn");
  const menu = document.querySelector("#menu");
  if (menuBtn && menu) {
    menuBtn.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        menu.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  document.querySelectorAll("[data-wa]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      const phone = document.querySelector('[name="phone"]');
      document.querySelector("#postular")?.scrollIntoView({ behavior: "smooth" });
      if (phone) window.setTimeout(() => phone.focus(), 350);
    });
  });

  const sim = document.querySelector("[data-sim]");
  if (sim) {
    const status = sim.querySelector("[data-status]");
    const log = sim.querySelector("[data-log]");
    const bar = sim.querySelector("[data-bar]");
    const state = sim.querySelector("[data-sign]");
    const button = sim.querySelector("[data-run]");
    let timers = [];
    const stamp = () => new Date().toTimeString().slice(0, 8);
    const clear = () => { timers.forEach((id) => window.clearTimeout(id)); timers = []; };
    const run = () => {
      clear();
      log.replaceChildren();
      bar.style.width = "0%";
      state.textContent = "Reto dinámico · en curso";
      status.textContent = "Esperando presentación de wallet";
      const push = (line) => {
        const item = document.createElement("li");
        item.textContent = "[" + stamp() + "] " + line;
        log.appendChild(item);
      };
      push("Servicio de escritorio listo. Lector NFC conectado. READY");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const marks = reduced
        ? [{ at: 0, pct: 100, status: "Verificación lista", sign: "Firma secp256k1 · autenticidad verificada", line: "Challenge firmado localmente. Verificación en la laptop OK. VALID" }]
        : [
            { at: 2000, pct: 20, status: "Acercando el teléfono al lector", sign: "Leyendo NFC / QR", line: "" },
            { at: 5000, pct: 55, status: "Firma del reto en el teléfono", sign: "Firma secp256k1 · recibida", line: "Challenge firmado localmente." },
            { at: 8000, pct: 80, status: "Cálculo en la laptop del puesto", sign: "Verificando en el escritorio", line: "" },
            { at: 10000, pct: 100, status: "Confirmado en pantalla", sign: "Firma secp256k1 · autenticidad verificada", line: "Verificación en la laptop OK. VALID" },
          ];
      marks.forEach((mark) => {
        timers.push(window.setTimeout(() => {
          bar.style.width = mark.pct + "%";
          status.textContent = mark.status;
          state.textContent = mark.sign;
          if (mark.line) push(mark.line);
        }, mark.at));
      });
    };
    button.addEventListener("click", run);
  }

  const calc = document.querySelector("[data-calc]");
  if (calc) {
    const members = calc.querySelector('[name="members"]');
    const cost = calc.querySelector('[name="cost"]');
    const rate = calc.querySelector('[name="rate"]');
    const out = {
      members: calc.querySelector("[data-members]"),
      cost: calc.querySelector("[data-cost]"),
      rate: calc.querySelector("[data-rate]"),
      spend: calc.querySelector("[data-spend]"),
      kg: calc.querySelector("[data-kg]"),
    };
    const paint = () => {
      const n = Number(members.value);
      const c = Number(cost.value);
      const r = Number(rate.value) / 100;
      const cards = n * (1 + r * 2);
      out.members.textContent = num.format(n);
      out.cost.textContent = money.format(c);
      out.rate.textContent = rate.value + "%";
      const spend = Math.round(cards * c);
      const kg = (cards * 0.005).toLocaleString(en ? "en-US" : "es-MX", { maximumFractionDigits: 2 });
      out.spend.textContent = money.format(spend);
      out.kg.textContent = "~" + kg + " kg";
      const formula = calc.querySelector("[data-formula]");
      if (formula) {
        formula.textContent = en
          ? "One issue plus two years of replacement, at 5 g per card. With "
            + num.format(n) + " people, " + money.format(c) + " and " + rate.value
            + "%, the spend comes to " + money.format(spend) + " and the plastic to ~" + kg + " kg."
          : "Una emisión más dos años de reposición, a 5 g por tarjeta. Con "
            + num.format(n) + " personas, " + money.format(c) + " y " + rate.value
            + " %, el gasto sale en " + money.format(spend) + " y el plástico en ~" + kg + " kg.";
      }
    };
    [members, cost, rate].forEach((input) => input.addEventListener("input", paint));
    calc.querySelectorAll("[data-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = button.parentElement.querySelector('input[type="range"]');
        const next = Number(input.value) + Number(button.dataset.step) * Number(input.step);
        input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), next)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    calc.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
    paint();
  }

  const form = document.querySelector("[data-form]");
  if (form) {
    const ready = form.querySelector("[data-ready]");
    const summary = form.querySelector("[data-summary]");
    const status = form.querySelector("[data-status]");
    const send = form.querySelector("[data-send]");
    const labelFor = () => (form.querySelector('[name="via"]:checked')?.value === "mail"
      ? (en ? "Open email with this application" : "Abrir el correo con la postulación")
      : (en ? "Open WhatsApp with this application" : "Abrir WhatsApp con la postulación"));
    form.querySelectorAll('[name="via"]').forEach((input) => {
      input.addEventListener("change", () => { send.textContent = labelFor(); });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name")).trim();
      const text = (en ? [
        "Application · CiGo pioneer pilot",
        "Lead: " + name,
        "Organization: " + String(data.get("kind")),
        "Members: " + String(data.get("size")).trim(),
        "Email: " + String(data.get("email")).trim(),
        "Phone: " + String(data.get("phone")).trim(),
        "Pilot: 50 credentials",
        "I want the 10-minute call.",
      ] : [
        "Postulación · Piloto pionero CiGo",
        "Responsable: " + name,
        "Organización: " + String(data.get("kind")),
        "Miembros: " + String(data.get("size")).trim(),
        "Correo: " + String(data.get("email")).trim(),
        "Teléfono: " + String(data.get("phone")).trim(),
        "Piloto: 50 credenciales",
        "Quiero la videollamada de 10 minutos.",
      ]).join("\n");
      summary.textContent = text;
      ready.hidden = false;
      ready.dataset.text = text;
      if (data.get("via") === "mail") {
        window.location.href = "mailto:" + MAIL_TO
          + "?subject=" + encodeURIComponent((en ? "CiGo pioneer pilot application — " : "Postulación piloto pionero CiGo — ") + name)
          + "&body=" + encodeURIComponent(text);
        status.textContent = en
          ? "Email opened with this application, addressed to " + MAIL_TO + "."
          : "Se abrió el correo con esta postulación, dirigida a " + MAIL_TO + ".";
        return;
      }
      const link = document.createElement("a");
      link.href = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(text);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
      status.textContent = en
        ? "WhatsApp opened with this application, to +52 56 2120 8481."
        : "Se abrió WhatsApp con esta postulación, al +52 56 2120 8481.";
    });
    form.querySelector("[data-copy]").addEventListener("click", async () => {
      const button = form.querySelector("[data-copy]");
      try {
        await navigator.clipboard.writeText(ready.dataset.text || summary.textContent);
        button.textContent = en ? "Copied" : "Copiado";
      } catch {
        button.textContent = en ? "Select the text and copy it" : "Selecciona el texto y cópialo";
      }
    });
  }

  const fee = document.querySelector("[data-fee]");
  if (fee) {
    const cap = fee.querySelector('[name="cap"]');
    const face = fee.querySelector('[name="face"]');
    const cut = fee.querySelector('[name="cut"]');
    const leak = fee.querySelector("[data-leak]");
    const detail = fee.querySelector("[data-detail]");
    const paint = () => {
      const n = Number(cap.value) || 0;
      const price = Number(face.value) || 0;
      const pct = Number(cut.value) || 0;
      const extra = Math.round(n * price * (pct / 100));
      leak.textContent = money.format(extra);
      detail.textContent = en
        ? num.format(n) + " tickets at " + money.format(price) + " with a " + pct + "% fee."
        : num.format(n) + " boletos a " + money.format(price) + " con " + pct + "% de cargo.";
    };
    [cap, face, cut].forEach((input) => input.addEventListener("input", paint));
    paint();
  }

  const door = document.querySelector("[data-door]");
  if (door) {
    const verdict = door.querySelector("[data-verdict]");
    const when = door.querySelector("[data-when]");
    let admittedAt = 0;
    const elapsed = () => {
      const sec = Math.max(0, Math.round((Date.now() - admittedAt) / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m + "m " + String(s).padStart(2, "0") + "s";
    };
    const pass = door.querySelector("[data-pass]");
    door.querySelector("[data-scan]").addEventListener("click", () => {
      admittedAt = Date.now();
      if (pass) pass.textContent = en ? "Used" : "Ya pasó";
      verdict.className = "verdict ok";
      verdict.innerHTML = en
        ? "<b>Admitted</b><span>Ticket 0419, North Hall. It can no longer be transferred.</span>"
        : "<b>Entró</b><span>Boleto 0419 de Foro Norte. Ya no se puede ceder.</span>";
      when.textContent = en ? "Presentation read. Holder's signature." : "Presentación leída. Firma del titular.";
    });
    door.querySelector("[data-again]").addEventListener("click", () => {
      verdict.className = "verdict bad";
      if (!admittedAt) {
        verdict.innerHTML = en
          ? "<b>No entry yet</b><span>Read the phone presentation first.</span>"
          : "<b>Todavía no hay entrada</b><span>Primero lee la presentación del teléfono.</span>";
        return;
      }
      verdict.innerHTML = en
        ? "<b>Already through the door</b><span>Ticket 0419 already passed. The same screenshot arrives " + elapsed() + " late.</span>"
        : "<b>Ya pasó la puerta</b><span>El boleto 0419 ya pasó. La misma captura llega " + elapsed() + " tarde.</span>";
      when.textContent = en ? "Rejected on this screen." : "Rechazado en esta pantalla.";
    });
  }
})();
