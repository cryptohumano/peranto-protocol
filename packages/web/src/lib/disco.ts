import type { Address } from "viem";

const KEY = "peranto.activeDisco.v1";

export type ActiveDisco = {
  address: Address;
  name: string;
  /** Schemas this DisCO publicly offers to claim. */
  offerSchemas: string[];
};

const DEFAULT_OFFERS = [
  "peranto:Member:v1",
  "peranto:EcoTestResult:v1",
  "peranto:CommonsWork:v1",
  "peranto:CareContribution:v1",
];

export function loadActiveDisco(): ActiveDisco | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveDisco;
  } catch {
    return null;
  }
}

export function saveActiveDisco(d: ActiveDisco | null) {
  if (!d) localStorage.removeItem(KEY);
  else {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...d,
        offerSchemas: d.offerSchemas?.length ? d.offerSchemas : DEFAULT_OFFERS,
      })
    );
  }
  window.dispatchEvent(new CustomEvent("peranto:disco", { detail: d }));
}

export function defaultOffers(): string[] {
  return [...DEFAULT_OFFERS];
}

export function useActiveDiscoListener(
  onChange: (d: ActiveDisco | null) => void
) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (ev: Event) => {
    onChange((ev as CustomEvent<ActiveDisco | null>).detail ?? loadActiveDisco());
  };
  window.addEventListener("peranto:disco", handler);
  return () => window.removeEventListener("peranto:disco", handler);
}
