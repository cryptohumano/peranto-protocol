import type { DidDocument, DidService } from "@peranto/sdk";
import type { Address, Hex } from "viem";
import { getAddress, isAddress } from "viem";
import {
  resolvePageLayoutId,
  resolvePageThemeId,
  themeTokens,
  type PageLayoutId,
  type PageThemeId,
} from "./page-themes";

/** DID service that holds public page personalization (visible on-chain). */
export const PAGE_PROFILE_TYPE = "PerantoPage";

/** Tip amount presets (PAS) shown on the public Love sheet / QR. */
export const TIP_AMOUNT_PRESETS = ["0.001", "0.01", "0.05", "0.1"] as const;
export const DEFAULT_TIP_AMT = "0.01";

export type PublicPageBadge = {
  /** On-chain credential hash (no JWT on the public page). */
  credHash: Hex;
  schemaKey: string;
  /** Optional display label */
  label?: string;
};

export type PublicPageProfile = {
  title?: string;
  bio?: string;
  /** CSS color, e.g. #1a5f4a */
  accent?: string;
  /** Visual theme template id */
  theme?: PageThemeId;
  /** Layout template id */
  layout?: PageLayoutId;
  /** Featured credential badges (hashes only). */
  badges?: PublicPageBadge[];
  /**
   * Show Love QR / invite on the public page.
   * Default true when omitted (opt-out).
   */
  showLoveInvite?: boolean;
  /** Preferred DisCO node for Love tips (owner must be a member). */
  loveNode?: Address;
  /** Suggested tip amount in PAS (QR default); tipper can change it. */
  loveDefaultAmt?: string;
  /**
   * Manual order of public links (attrKeys like `Website.blog`).
   * Stored in PerantoPage so the DID document services keep a stable display order.
   */
  linkOrder?: string[];
};

export type PublicPageLink = {
  attrKey: string;
  type: string;
  label: string;
  href: string;
};

export type ResolvedPublicBadge = PublicPageBadge & {
  status: "Active" | "Revoked" | "None" | "Unknown";
};

const LINK_TYPES = new Set([
  "LinkedDomains",
  "Website",
  "CredentialInbox",
  "AuraInbox",
]);

/** User-facing link kinds: pick one → type + default button label. */
export const LINK_KINDS = [
  {
    id: "github",
    type: "LinkedDomains",
    label: "GitHub",
    slot: "github",
    placeholder: "https://github.com/usuario",
  },
  {
    id: "linkedin",
    type: "LinkedDomains",
    label: "LinkedIn",
    slot: "linkedin",
    placeholder: "https://www.linkedin.com/in/…",
  },
  {
    id: "telegram",
    type: "LinkedDomains",
    label: "Telegram",
    slot: "telegram",
    placeholder: "https://t.me/usuario",
  },
  {
    id: "x",
    type: "LinkedDomains",
    label: "X",
    slot: "x",
    placeholder: "https://x.com/usuario",
  },
  {
    id: "website",
    type: "Website",
    label: "Website",
    slot: "website",
    placeholder: "https://tu-sitio.org",
  },
  {
    id: "mail",
    type: "CredentialInbox",
    label: "Mail",
    slot: "mail",
    placeholder: "hola@ejemplo.org",
  },
  {
    id: "custom",
    type: "LinkedDomains",
    label: "",
    slot: "",
    placeholder: "https://…",
  },
] as const;

export type LinkKindId = (typeof LINK_KINDS)[number]["id"];

/** Max slot length so `did/svc/<Type>.<slot>` fits in bytes32. */
export function maxServiceSlotLength(serviceType: string): number {
  const t = serviceType.trim().replace(/[./]/g, "");
  return Math.max(1, 32 - 8 - t.length - 1);
}

const HOST_SLOT: Array<{ test: RegExp; slot: string; label: string }> = [
  { test: /(^|\.)t\.me$/i, slot: "telegram", label: "Telegram" },
  { test: /(^|\.)telegram\.me$/i, slot: "telegram", label: "Telegram" },
  { test: /(^|\.)linkedin\.com$/i, slot: "linkedin", label: "LinkedIn" },
  { test: /(^|\.)github\.com$/i, slot: "github", label: "GitHub" },
  { test: /(^|\.)x\.com$/i, slot: "x", label: "X" },
  { test: /(^|\.)twitter\.com$/i, slot: "x", label: "X" },
];

/** Slug for on-chain attr (a-z0-9_- only). */
export function slugifyLinkLabel(label: string, maxLen: number): string {
  const s = label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/^-+|-+$/g, "");
  return (s || "link").slice(0, maxLen);
}

/**
 * Friendly button label for a URL (Telegram, not t.me).
 */
export function suggestLinkLabel(href: string): string {
  const h = href.trim();
  if (/^mailto:/i.test(h) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h)) {
    return "Mail";
  }
  try {
    const host = new URL(
      /^https?:\/\//i.test(h) ? h : `https://${h}`
    ).hostname.replace(/^www\./, "");
    for (const row of HOST_SLOT) {
      if (row.test.test(host)) return row.label;
    }
    const brand = host.split(".")[0] || "Website";
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  } catch {
    return "Link";
  }
}

/**
 * On-chain slot. Prefer explicit label/slot; else known hosts; else brand.
 * Always returns a non-empty unique-capable slug (never bare type).
 */
export function deriveServiceSlot(
  serviceType: string,
  href: string,
  explicit?: string
): string {
  const max = maxServiceSlotLength(serviceType);
  const fromExplicit = slugifyLinkLabel(explicit ?? "", max);
  if (explicit?.trim() && fromExplicit) return fromExplicit;

  const h = href.trim();
  if (/^mailto:/i.test(h) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h)) {
    return "mail".slice(0, max);
  }
  try {
    const host = new URL(
      /^https?:\/\//i.test(h) ? h : `https://${h}`
    ).hostname.replace(/^www\./, "");
    for (const row of HOST_SLOT) {
      if (row.test.test(host)) return row.slot.slice(0, max);
    }
    const brand = host.split(".")[0]?.replace(/[^a-zA-Z0-9_-]/g, "") || "web";
    return slugifyLinkLabel(brand === "www" ? "website" : brand, max);
  } catch {
    return "link".slice(0, max);
  }
}

const STATUS_LABEL = ["None", "Active", "Revoked"] as const;

export function schemaShort(key: string): string {
  const parts = key.split(":");
  return parts.length >= 2 ? parts[parts.length - 2] : key;
}

function normalizeBadges(raw: unknown): PublicPageBadge[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PublicPageBadge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const credHash = typeof b.credHash === "string" ? b.credHash : "";
    const schemaKey = typeof b.schemaKey === "string" ? b.schemaKey : "";
    if (!/^0x[a-fA-F0-9]{64}$/.test(credHash) || !schemaKey) continue;
    out.push({
      credHash: credHash as Hex,
      schemaKey: schemaKey.slice(0, 120),
      label:
        typeof b.label === "string" ? b.label.slice(0, 48) : undefined,
    });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}

function normalizeLinkOrder(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const k = item.trim().slice(0, 48);
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= 32) break;
  }
  return out.length ? out : undefined;
}

function parseProfileObject(j: Record<string, unknown>): PublicPageProfile {
  const loveNodeRaw =
    typeof j.loveNode === "string" ? j.loveNode.trim() : "";
  const loveDefaultAmtRaw =
    typeof j.loveDefaultAmt === "string" ? j.loveDefaultAmt.trim() : "";
  const loveDefaultAmt =
    loveDefaultAmtRaw &&
    /^\d+(\.\d+)?$/.test(loveDefaultAmtRaw) &&
    Number(loveDefaultAmtRaw) > 0
      ? loveDefaultAmtRaw.slice(0, 18)
      : undefined;
  return {
    title: typeof j.title === "string" ? j.title.slice(0, 80) : undefined,
    bio: typeof j.bio === "string" ? j.bio.slice(0, 280) : undefined,
    accent:
      typeof j.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(j.accent)
        ? j.accent
        : undefined,
    theme: resolvePageThemeId(j.theme),
    layout: resolvePageLayoutId(j.layout),
    badges: normalizeBadges(j.badges),
    showLoveInvite:
      typeof j.showLoveInvite === "boolean" ? j.showLoveInvite : undefined,
    loveNode: isAddress(loveNodeRaw) ? (loveNodeRaw as Address) : undefined,
    loveDefaultAmt,
    linkOrder: normalizeLinkOrder(j.linkOrder),
  };
}

export function parsePageProfile(services: DidService[] | undefined): PublicPageProfile {
  const svc = services?.find(
    (s) => s.type === PAGE_PROFILE_TYPE || s.attrKey?.startsWith(PAGE_PROFILE_TYPE)
  );
  if (!svc) return {};
  const raw = svc.serviceEndpoint;
  if (typeof raw === "string") {
    try {
      return parseProfileObject(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return { bio: raw.slice(0, 280) };
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return parseProfileObject(raw as Record<string, unknown>);
  }
  return {};
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function endpointToHref(endpoint: DidService["serviceEndpoint"]): string | null {
  if (typeof endpoint === "string") {
    const t = endpoint.trim();
    if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) return t;
    if (isEmail(t)) return `mailto:${t}`;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return `https://${t}`;
    return null;
  }
  if (Array.isArray(endpoint) && typeof endpoint[0] === "string") {
    return endpointToHref(endpoint[0]);
  }
  if (endpoint && typeof endpoint === "object") {
    const o = endpoint as Record<string, unknown>;
    for (const k of ["uri", "url", "href", "id", "email"]) {
      if (typeof o[k] === "string") return endpointToHref(o[k] as string);
    }
  }
  return null;
}

function titleCaseSlot(slot: string): string {
  if (!slot) return slot;
  if (slot.length <= 2) return slot.toUpperCase();
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function labelFor(svc: DidService, href: string): string {
  const slot = svc.attrKey?.includes(".")
    ? svc.attrKey.slice(svc.attrKey.indexOf(".") + 1)
    : undefined;
  const name = typeof svc.name === "string" ? svc.name.trim() : "";
  const suggested = suggestLinkLabel(href);

  if (name) {
    // SDK often copies the raw slot into `name` ("github") — prefer a friendly tag
    const isRawSlotEcho =
      !!slot &&
      name.toLowerCase() === slot.toLowerCase() &&
      name === name.toLowerCase();
    if (isRawSlotEcho) {
      if (
        suggested &&
        suggested !== "Website" &&
        !suggested.includes(".") &&
        !suggested.includes("@")
      ) {
        return suggested;
      }
      return titleCaseSlot(slot!);
    }
    return name;
  }
  if (slot) {
    if (
      suggested &&
      suggested !== "Website" &&
      !suggested.includes(".") &&
      !suggested.includes("@")
    ) {
      return suggested;
    }
    return titleCaseSlot(slot);
  }
  // Legacy bare attr — host/email is a weak last resort
  return suggested;
}

function linkHrefKey(href: string): string {
  return href.trim().toLowerCase().replace(/\/$/, "");
}

/**
 * Prefer slotted + named services; drop bare legacy duplicates of the same URL
 * (and bare Type when Type.slot already covers that URL).
 */
export function dedupePublicLinks(links: PublicPageLink[]): PublicPageLink[] {
  if (links.length < 2) return links;

  const rank = (l: PublicPageLink): number => {
    let r = 0;
    if (l.attrKey.includes(".")) r += 4;
    if (l.label && !l.label.includes(".") && !/^mailto:/i.test(l.label)) r += 2;
    if (/[A-Z]/.test(l.label)) r += 1;
    return r;
  };

  const byHref = new Map<string, PublicPageLink>();
  for (const l of links) {
    const k = linkHrefKey(l.href);
    const prev = byHref.get(k);
    if (!prev || rank(l) > rank(prev)) byHref.set(k, l);
  }

  const unique = [...byHref.values()];
  const slottedTypes = new Set(
    unique.filter((l) => l.attrKey.includes(".")).map((l) => l.type)
  );

  return unique.filter((l) => {
    if (l.attrKey.includes(".")) return true;
    // Bare leftover after migrate to Type.slot — drop when slotted peers exist
    return !slottedTypes.has(l.type);
  });
}

/** Links shown on the public page (not the PerantoPage profile blob). */
export function extractPublicLinks(services: DidService[] | undefined): PublicPageLink[] {
  if (!services?.length) return [];
  const out: PublicPageLink[] = [];
  for (const s of services) {
    if (s.type === PAGE_PROFILE_TYPE) continue;
    if (s.attrKey?.startsWith(PAGE_PROFILE_TYPE)) continue;
    if (!LINK_TYPES.has(s.type)) continue;
    const href = endpointToHref(s.serviceEndpoint);
    if (!href) continue;
    out.push({
      attrKey: s.attrKey ?? `${s.type}-${href}`,
      type: s.type,
      label: labelFor(s, href),
      href,
    });
  }
  return dedupePublicLinks(out);
}

/** Stable key for ordering (`Website.blog` or draft id). */
export function publicLinkOrderKey(link: {
  attrKey?: string;
  type: string;
  slot?: string;
  id?: string;
}): string {
  if (link.attrKey?.trim()) return link.attrKey.trim();
  if (link.slot?.trim()) return `${link.type}.${link.slot.trim()}`;
  if (link.id?.trim()) return link.id.trim();
  return link.type;
}

/** Apply PerantoPage.linkOrder; unknown keys append in original order. */
export function sortPublicLinks<T extends { attrKey: string }>(
  links: T[],
  order?: string[] | null
): T[] {
  if (!order?.length || links.length < 2) return links;
  const rank = new Map(
    order.map((k, i) => [k.toLowerCase(), i] as const)
  );
  return [...links].sort((a, b) => {
    const ra = rank.get(a.attrKey.toLowerCase());
    const rb = rank.get(b.attrKey.toLowerCase());
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}

export function profileFromDocument(doc: DidDocument): {
  profile: PublicPageProfile;
  links: PublicPageLink[];
} {
  const profile = parsePageProfile(doc.service);
  return {
    profile,
    links: sortPublicLinks(extractPublicLinks(doc.service), profile.linkOrder),
  };
}

/** Share URL for HashRouter on GH Pages: `…/#/u/@alice` */
export function buildPublicPageShareUrl(ref: string): string {
  const clean = ref.trim().replace(/^@+/, "");
  const segment = encodeURIComponent(
    ref.trim().startsWith("@") ? `@${clean}` : clean || ref.trim()
  );
  const base = import.meta.env.BASE_URL || "/";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pathBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${origin}${pathBase}/#/u/${segment}`;
}

export function encodePageProfile(profile: PublicPageProfile): string {
  const amt = profile.loveDefaultAmt?.trim();
  return JSON.stringify({
    title: profile.title?.trim() || undefined,
    bio: profile.bio?.trim() || undefined,
    accent: profile.accent?.trim() || undefined,
    theme: resolvePageThemeId(profile.theme),
    layout: resolvePageLayoutId(profile.layout),
    badges: profile.badges?.length ? profile.badges.slice(0, 8) : undefined,
    // Always persist so owners can opt out explicitly
    showLoveInvite: profile.showLoveInvite !== false,
    loveNode: profile.loveNode && isAddress(profile.loveNode)
      ? profile.loveNode
      : undefined,
    loveDefaultAmt:
      amt && /^\d+(\.\d+)?$/.test(amt) && Number(amt) > 0
        ? amt.slice(0, 18)
        : undefined,
    linkOrder: profile.linkOrder?.length
      ? profile.linkOrder.slice(0, 32).map((k) => k.trim())
      : undefined,
  });
}

/** Drop stale keys; append new links — keeps linkOrder aligned with live services. */
export function reconcileLinkOrder(
  order: string[] | undefined,
  attrKeys: string[]
): string[] | undefined {
  if (!attrKeys.length) return undefined;
  const byLower = new Map(attrKeys.map((k) => [k.toLowerCase(), k] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of order ?? []) {
    const k = byLower.get(raw.trim().toLowerCase());
    if (!k || seen.has(k.toLowerCase())) continue;
    out.push(k);
    seen.add(k.toLowerCase());
  }
  for (const k of attrKeys) {
    if (seen.has(k.toLowerCase())) continue;
    out.push(k);
    seen.add(k.toLowerCase());
  }
  return out.length ? out.slice(0, 32) : undefined;
}

function stableBadgesForSnapshot(
  badges?: PublicPageBadge[]
): PublicPageBadge[] | undefined {
  if (!badges?.length) return undefined;
  return [...badges]
    .sort((a, b) => a.credHash.localeCompare(b.credHash))
    .map((b) => ({
      credHash: b.credHash,
      schemaKey: b.schemaKey.trim(),
    }));
}

function normalizeLoveDefaultAmt(
  raw: string | undefined,
  showLove: boolean
): string | undefined {
  if (!showLove) return undefined;
  const amt = raw?.trim();
  if (amt && /^\d+(\.\d+)?$/.test(amt) && Number(amt) > 0) {
    return amt.slice(0, 18);
  }
  return DEFAULT_TIP_AMT;
}

/**
 * Canonical PerantoPage JSON for dirty-checking.
 * Ignores stale linkOrder keys and normalizes badge/love fields.
 */
export function buildPageProfileSnapshot(
  profile: PublicPageProfile,
  linkAttrKeys: string[]
): string {
  const theme = resolvePageThemeId(profile.theme);
  const showLove = profile.showLoveInvite !== false;
  let loveNode: Address | undefined;
  if (showLove && profile.loveNode && isAddress(profile.loveNode)) {
    try {
      loveNode = getAddress(profile.loveNode);
    } catch {
      loveNode = undefined;
    }
  }
  const accentRaw = profile.accent?.trim();
  const accent =
    accentRaw && /^#[0-9a-fA-F]{6}$/.test(accentRaw)
      ? accentRaw
      : themeTokens(theme).accent;
  const amt = profile.loveDefaultAmt?.trim();
  const loveDefaultAmt = normalizeLoveDefaultAmt(amt, showLove);

  return encodePageProfile({
    title: profile.title?.trim() || undefined,
    bio: profile.bio?.trim() || undefined,
    accent,
    theme,
    layout: resolvePageLayoutId(profile.layout),
    badges: stableBadgesForSnapshot(profile.badges),
    showLoveInvite: showLove,
    loveNode,
    loveDefaultAmt,
    linkOrder: reconcileLinkOrder(profile.linkOrder, linkAttrKeys),
  });
}

export function statusLabelFromCode(st: number): ResolvedPublicBadge["status"] {
  if (st >= 0 && st < STATUS_LABEL.length) return STATUS_LABEL[st];
  return "Unknown";
}
