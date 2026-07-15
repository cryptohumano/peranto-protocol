/**
 * Runs in MAIN world (page context). Exposes window.aura + EIP-6963.
 * Must NOT use chrome.* APIs — only postMessage to the isolated bridge.
 */
(() => {
  const CHANNEL = "aura-peranto";
  let reqId = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  function emit(event: string, data?: unknown) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch {
        /* ignore */
      }
    }
  }

  function request(method: string, params?: unknown[]): Promise<unknown> {
    const id = ++reqId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.postMessage(
        { channel: CHANNEL, direction: "inpage→cs", id, method, params },
        "*"
      );
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Aura timeout: ${method}`));
        }
      }, 120_000);
    });
  }

  window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data || data.channel !== CHANNEL || data.direction !== "cs→inpage") {
      return;
    }
    if (data.event) {
      emit(data.event, data.payload);
      return;
    }
    const p = pending.get(data.id as number);
    if (!p) return;
    pending.delete(data.id as number);
    if (data.error) p.reject(new Error(String(data.error)));
    else p.resolve(data.result);
  });

  const provider = {
    isAura: true,
    isMetaMask: false,
    request: ({ method, params }: { method: string; params?: unknown[] }) =>
      request(method, params),
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return provider;
    },
    removeListener(event: string, handler: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(handler);
      return provider;
    },
  };

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "a11a0000-pera-4nto-aura-000000000001",
            name: "Aura Wallet",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect fill='%231a5f4a' width='32' height='32' rx='6'/></svg>",
            rdns: "app.peranto.aura",
          },
          provider,
        },
      })
    );
  };

  try {
    Object.defineProperty(window, "aura", {
      value: provider,
      writable: false,
      configurable: true,
    });
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).aura = provider;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!w.ethereum) {
    try {
      Object.defineProperty(window, "ethereum", {
        value: provider,
        writable: true,
        configurable: true,
      });
    } catch {
      w.ethereum = provider;
    }
  } else {
    if (!Array.isArray(w.ethereum.providers)) {
      w.ethereum.providers = [w.ethereum];
    }
    if (!w.ethereum.providers.includes(provider)) {
      w.ethereum.providers.push(provider);
    }
  }

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
