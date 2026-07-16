import type { DidDocument, DidService } from "@peranto/sdk";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import {
  resolvePageLayoutId,
  resolvePageThemeId,
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

/** Max slot length so `did/svc/<Type>.<slot>` fits in bytes32. */
export function maxServiceSlotLength(serviceType: string): number {
  const t = serviceType.trim().replace(/[./]/g, "");
  // "did/svc/" = 8, plus optional "." before slot
  return Math.max(1, 32 - 8 - t.length - 1);
}

/**
 * Slot for DID service attribute. Without a unique slot, same type overwrites
 * (only ~3 bare types → appears as “max 3 links”).
 */
export function deriveServiceSlot(
  serviceType: string,
  href: string,
  explicit?: string
): string {
  const max = maxServiceSlotLength(serviceType);
  const cleaned = (explicit ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (cleaned) return cleaned.slice(0, max);

  let base = "link";
  const h = href.trim();
  if (/^mailto:/i.test(h) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h)) {
    const email = h.replace(/^mailto:/i, "");
    base = (email.split("@")[0] || "mail").replace(/[^a-zA-Z0-9_-]/g, "");
  } else {
    try {
      const host = new URL(
        /^https?:\/\//i.test(h) ? h : `https://${h}`
      ).hostname.replace(/^www\./, "");
      base = host.split(".")[0]?.replace(/[^a-zA-Z0-9_-]/g, "") || "web";
    } catch {
      base = "link";
    }
  }
  if (!base) base = "link";
  return base.slice(0, max);
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

function labelFor(svc: DidService, href: string): string {
  // 1) Explicit name stored in service JSON (linktr33 tag)
  if (typeof svc.name === "string" && svc.name.trim()) {
    return svc.name.trim();
  }
  // 2) Slot from attribute key (LinkedDomains.github → github)
  const slot = svc.attrKey?.includes(".")
    ? svc.attrKey.slice(svc.attrKey.indexOf(".") + 1)
    : undefined;
  if (slot) return slot;
  // 3) Fallback: host / email (legacy links without slot)
  if (/^mailto:/i.test(href)) {
    return href.replace(/^mailto:/i, "");
  }
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return svc.type;
  }
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
  return out;
}

export function profileFromDocument(doc: DidDocument): {
  profile: PublicPageProfile;
  links: PublicPageLink[];
} {
  return {
    profile: parsePageProfile(doc.service),
    links: extractPublicLinks(doc.service),
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
  });
}

export function statusLabelFromCode(st: number): ResolvedPublicBadge["status"] {
  if (st >= 0 && st < STATUS_LABEL.length) return STATUS_LABEL[st];
  return "Unknown";
}
