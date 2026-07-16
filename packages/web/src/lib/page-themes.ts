/** Visual templates for public linktr33 pages (off-chain UI; id stored in PerantoPage). */

export const PAGE_THEME_IDS = [
  "moss",
  "midnight",
  "clay",
  "paper",
  "signal",
] as const;

export type PageThemeId = (typeof PAGE_THEME_IDS)[number];

export const PAGE_LAYOUT_IDS = ["classic", "rail", "blocks"] as const;
export type PageLayoutId = (typeof PAGE_LAYOUT_IDS)[number];

export type PageThemeTokens = {
  id: PageThemeId;
  label: string;
  blurb: string;
  /** Default accent if owner does not override */
  accent: string;
  brand: string;
  ink: string;
  muted: string;
  linkBg: string;
  linkInk: string;
  linkBorder: string;
  badgeBorder: string;
  badgeBg: string;
  /** CSS background layers */
  surface: string;
  patternOpacity: number;
};

export const PAGE_THEMES: Record<PageThemeId, PageThemeTokens> = {
  moss: {
    id: "moss",
    label: "Musgo",
    blurb: "Bosque / DisCO clásico",
    accent: "#1a5f4a",
    brand: "#c4a35a",
    ink: "#f3efe6",
    muted: "rgba(243,239,230,0.7)",
    linkBg: "rgba(243,239,230,0.95)",
    linkInk: "#14221c",
    linkBorder: "rgba(255,255,255,0.15)",
    badgeBorder: "rgba(196,163,90,0.5)",
    badgeBg: "rgba(196,163,90,0.15)",
    surface: `
      radial-gradient(ellipse 90% 60% at 50% -10%, color-mix(in srgb, var(--page-accent) 35%, transparent), transparent 55%),
      linear-gradient(165deg, #0f3d30 0%, #14221c 42%, #1a2e26 100%)
    `,
    patternOpacity: 0.07,
  },
  midnight: {
    id: "midnight",
    label: "Medianoche",
    blurb: "Azul profundo, tipografía clara",
    accent: "#3d7ea6",
    brand: "#8eb8d4",
    ink: "#e8eef4",
    muted: "rgba(232,238,244,0.68)",
    linkBg: "rgba(232,238,244,0.94)",
    linkInk: "#0c1822",
    linkBorder: "rgba(255,255,255,0.12)",
    badgeBorder: "rgba(142,184,212,0.45)",
    badgeBg: "rgba(61,126,166,0.25)",
    surface: `
      radial-gradient(ellipse 80% 50% at 80% 0%, color-mix(in srgb, var(--page-accent) 28%, transparent), transparent 50%),
      linear-gradient(160deg, #0a1219 0%, #121c28 45%, #1a2838 100%)
    `,
    patternOpacity: 0.05,
  },
  clay: {
    id: "clay",
    label: "Arcilla",
    blurb: "Tierra cálida, sin crema genérica",
    accent: "#8b4a2b",
    brand: "#d4a574",
    ink: "#f6f0e8",
    muted: "rgba(246,240,232,0.72)",
    linkBg: "rgba(246,240,232,0.96)",
    linkInk: "#2a1810",
    linkBorder: "rgba(255,255,255,0.12)",
    badgeBorder: "rgba(212,165,116,0.5)",
    badgeBg: "rgba(139,74,43,0.28)",
    surface: `
      radial-gradient(ellipse 70% 45% at 20% 0%, color-mix(in srgb, var(--page-accent) 30%, transparent), transparent 55%),
      linear-gradient(170deg, #2c1a14 0%, #3d2418 40%, #1f1410 100%)
    `,
    patternOpacity: 0.06,
  },
  paper: {
    id: "paper",
    label: "Papel",
    blurb: "Claro, lectura diurna",
    accent: "#1a5f4a",
    brand: "#5a7a3a",
    ink: "#1a2218",
    muted: "rgba(26,34,24,0.62)",
    linkBg: "#ffffff",
    linkInk: "#1a2218",
    linkBorder: "rgba(26,34,24,0.12)",
    badgeBorder: "rgba(26,95,74,0.35)",
    badgeBg: "rgba(26,95,74,0.1)",
    surface: `
      radial-gradient(ellipse 90% 50% at 50% -5%, color-mix(in srgb, var(--page-accent) 18%, transparent), transparent 55%),
      linear-gradient(180deg, #e8efe4 0%, #dce6d6 50%, #cfdcc8 100%)
    `,
    patternOpacity: 0.04,
  },
  signal: {
    id: "signal",
    label: "Señal",
    blurb: "Alto contraste, links bloque",
    accent: "#e8ff47",
    brand: "#e8ff47",
    ink: "#f5f5f0",
    muted: "rgba(245,245,240,0.65)",
    linkBg: "#e8ff47",
    linkInk: "#0a0a08",
    linkBorder: "transparent",
    badgeBorder: "rgba(232,255,71,0.5)",
    badgeBg: "rgba(232,255,71,0.12)",
    surface: `
      linear-gradient(180deg, #0a0a08 0%, #141410 60%, #0a0a08 100%)
    `,
    patternOpacity: 0,
  },
};

export const PAGE_LAYOUTS: Record<
  PageLayoutId,
  { id: PageLayoutId; label: string; blurb: string }
> = {
  classic: {
    id: "classic",
    label: "Clásico",
    blurb: "Centrado, botones redondeados",
  },
  rail: {
    id: "rail",
    label: "Editorial",
    blurb: "Alineado a la izquierda, links sobrios",
  },
  blocks: {
    id: "blocks",
    label: "Bloques",
    blurb: "Filas a todo ancho, tipografía fuerte",
  },
};

export function resolvePageThemeId(raw: unknown): PageThemeId {
  if (typeof raw === "string" && (PAGE_THEME_IDS as readonly string[]).includes(raw)) {
    return raw as PageThemeId;
  }
  return "moss";
}

export function resolvePageLayoutId(raw: unknown): PageLayoutId {
  if (
    typeof raw === "string" &&
    (PAGE_LAYOUT_IDS as readonly string[]).includes(raw)
  ) {
    return raw as PageLayoutId;
  }
  return "classic";
}

export function themeTokens(id: PageThemeId): PageThemeTokens {
  return PAGE_THEMES[id] ?? PAGE_THEMES.moss;
}
