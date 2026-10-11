(function () {
  const money = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
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

  document.querySelectorAll("[data-gate]").forEach((root) => {
    const phone = root.querySelector("[data-phone]");
    const result = root.querySelector("[data-result]");
    const status = root.querySelector("[data-status]");
    const log = root.querySelector("[data-log]");
    let gen = 0;
    const play = () => {
      const id = ++gen;
      phone.classList.remove("is-in");
      result.hidden = true;
      if (log) log.hidden = true;
      status.textContent = "Lector listo";
      window.setTimeout(() => {
        if (id !== gen) return;
        phone.classList.add("is-in");
        status.textContent = "Leyendo pase…";
      }, 280);
      window.setTimeout(() => {
        if (id !== gen) return;
        result.hidden = false;
        if (log) log.hidden = false;
        status.textContent = "Listo";
      }, 980);
    };
    root.querySelector("[data-replay]").addEventListener("click", play);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) play();
  });

  const roi = document.querySelector("[data-roi]");
  if (roi) {
    const form = roi.querySelector("[data-plan]");
    const range = form.querySelector('[name="members"]');
    const count = form.querySelector("[data-count]");
    const plastic = roi.querySelector("[data-plastic]");
    const pilot = roi.querySelector("[data-pilot]");
    const rest = roi.querySelector("[data-rest]");
    const CARD = 48;
    const REPLACEMENT = 0.15;
    const YEARS = 3;

    const paint = () => {
      const members = Number(range.value);
      count.textContent = members.toLocaleString("es-MX");
      const total = Math.round(members * CARD * (1 + REPLACEMENT * YEARS));
      plastic.textContent = money.format(total);
      const included = Math.min(members, 50);
      pilot.textContent = included + " incluidas";
      const extra = Math.max(0, members - 50);
      rest.textContent = extra === 0
        ? "Toda la organización cabe en el piloto."
        : extra.toLocaleString("es-MX") + " credenciales más entran al plan de la organización.";
    };
    range.addEventListener("input", paint);
    paint();

    const ready = form.querySelector("[data-ready]");
    const summary = form.querySelector("[data-summary]");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const members = Number(data.get("members"));
      const extra = Math.max(0, members - 50);
      const total = Math.round(members * CARD * (1 + REPLACEMENT * YEARS));
      const text = [
        "Plan CiGo",
        "Organización: " + String(data.get("org")).trim(),
        "Tipo: " + String(data.get("kind")),
        "Correo: " + String(data.get("email")).trim(),
        "Personas: " + members,
        "Piloto: " + Math.min(members, 50) + " credenciales",
        "Por cotizar: " + extra,
        "Plástico estimado a 3 años: " + money.format(total),
        "Supuesto: $48 MXN por carnet y 15% de reposición anual.",
        "Este plan queda en esta página. Cópialo y envíalo a outreach@peranto.app si quieres que lo revisemos.",
      ].join("\n");
      summary.textContent = text;
      ready.hidden = false;
      ready.dataset.text = text;
    });
    form.querySelector("[data-copy]").addEventListener("click", async () => {
      const text = ready.dataset.text || summary.textContent;
      try {
        await navigator.clipboard.writeText(text);
        form.querySelector("[data-copy]").textContent = "Copiado";
      } catch {
        form.querySelector("[data-copy]").textContent = "Selecciona el texto y cópialo";
      }
    });
  }

  const scalp = document.querySelector("[data-scalp]");
  if (scalp) {
    const fields = scalp.querySelectorAll("input");
    const leak = scalp.querySelector("[data-leak]");
    const detail = scalp.querySelector("[data-detail]");
    const paint = () => {
      const cap = Number(scalp.querySelector('[name="cap"]').value) || 0;
      const face = Number(scalp.querySelector('[name="face"]').value) || 0;
      const rate = Number(scalp.querySelector('[name="rate"]').value) || 0;
      const mult = Number(scalp.querySelector('[name="mult"]').value) || 1;
      const resold = cap * (rate / 100);
      const extra = Math.max(0, resold * face * (mult - 1));
      leak.textContent = money.format(extra);
      detail.textContent = Math.round(resold).toLocaleString("es-MX")
        + " boletos revendidos, a "
        + mult.toLocaleString("es-MX")
        + " veces el precio de cara.";
    };
    fields.forEach((field) => field.addEventListener("input", paint));
    paint();
  }

  document.querySelectorAll("[data-clone]").forEach((root) => {
    const phone = root.querySelector("[data-phone]");
    const ok = root.querySelector("[data-ok]");
    const no = root.querySelector("[data-no]");
    const status = root.querySelector("[data-status]");
    const state = root.querySelector("[data-ticket-state]");
    let used = false;
    const approach = () => {
      phone.classList.remove("is-in");
      window.setTimeout(() => phone.classList.add("is-in"), 40);
    };
    root.querySelector("[data-scan]").addEventListener("click", () => {
      approach();
      used = true;
      ok.hidden = false;
      no.hidden = true;
      status.textContent = "Entrada registrada";
      state.textContent = "Consumido";
    });
    root.querySelector("[data-again]").addEventListener("click", () => {
      if (!used) {
        status.textContent = "Primero valida el boleto";
        return;
      }
      approach();
      ok.hidden = true;
      no.hidden = false;
      status.textContent = "Rechazado";
      state.textContent = "Rechazado";
    });
  });
})();
