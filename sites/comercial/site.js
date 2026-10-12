(function () {
  const WA_NUMBER = "";
  const WA_TEXT = "Hola Edgar, quiero conocer la demo de CiGo";
  const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

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
    if (WA_NUMBER) {
      node.href = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(WA_TEXT);
      return;
    }
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
      out.members.textContent = n.toLocaleString("es-MX");
      out.cost.textContent = money.format(c);
      out.rate.textContent = rate.value + "%";
      out.spend.textContent = money.format(Math.round(cards * c));
      out.kg.textContent = "~" + (cards * 0.005).toLocaleString("es-MX", { maximumFractionDigits: 2 }) + " kg";
    };
    [members, cost, rate].forEach((input) => input.addEventListener("input", paint));
    paint();
  }

  const form = document.querySelector("[data-form]");
  if (form) {
    const ready = form.querySelector("[data-ready]");
    const summary = form.querySelector("[data-summary]");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const text = [
        "Postulación · Piloto pionero CiGo",
        "Responsable: " + String(data.get("name")).trim(),
        "Organización: " + String(data.get("kind")),
        "Miembros: " + String(data.get("size")).trim(),
        "Correo: " + String(data.get("email")).trim(),
        "WhatsApp: " + String(data.get("phone")).trim(),
        "Piloto: 50 credenciales",
        "La postulación queda en esta página. No se envía a un servidor.",
      ].join("\n");
      summary.textContent = text;
      ready.hidden = false;
      ready.dataset.text = text;
    });
    form.querySelector("[data-copy]").addEventListener("click", async () => {
      const button = form.querySelector("[data-copy]");
      try {
        await navigator.clipboard.writeText(ready.dataset.text || summary.textContent);
        button.textContent = "Copiado";
      } catch {
        button.textContent = "Selecciona el texto y cópialo";
      }
    });
  }
})();
