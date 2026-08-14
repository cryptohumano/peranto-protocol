import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  BadgeCheck,
  Copy,
  ExternalLink,
  Eye,
  GripVertical,
  Link2,
  Loader2,
  QrCode,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldHint, HelpCallout } from "@/components/HelpCallout";
import { Linktr33Preview } from "@/components/Linktr33Preview";
import { PublicPresentationCard } from "@/components/PublicPresentationCard";
import {
  PublishCheckoutSheet,
  buildProfileFieldDiffs,
  toCheckoutLink,
  type TxPlanRow,
} from "@/components/PublishCheckoutSheet";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  PAGE_PROFILE_TYPE,
  TIP_AMOUNT_PRESETS,
  DEFAULT_TIP_AMT,
  LINK_KINDS,
  buildPublicPageShareUrl,
  buildPageProfileSnapshot,
  encodePageProfile,
  extractPublicLinks,
  parsePageProfile,
  schemaShort,
  deriveServiceSlot,
  publicLinkOrderKey,
  sortPublicLinks,
  reconcileLinkOrder,
  suggestLinkLabel,
  type LinkKindId,
  type PublicPageBadge,
  type PublicPageLink,
  type PublicPageProfile,
} from "@/lib/public-page";
import {
  PAGE_LAYOUTS,
  PAGE_LAYOUT_IDS,
  PAGE_THEMES,
  PAGE_THEME_IDS,
  themeTokens,
  type PageLayoutId,
  type PageThemeId,
} from "@/lib/page-themes";
import {
  didRegistryAbi,
  encodeDidServiceValue,
  serviceAttributeName,
  type VaultCredential,
} from "@peranto/sdk";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { cn } from "@/lib/utils";
import {
  fetchAuraVault,
  getAddresses,
  getReadClient,
  portalClearDidService,
  portalListMembershipNodes,
  portalResolveDid,
  portalSetDidService,
  vault,
} from "@/lib/client";
import { seedExpectedDidServices } from "@/lib/did-service-cache";
import type { SessionIdentity } from "@/lib/session";
import type { DidService } from "@peranto/sdk";

type BadgeCandidate = {
  credHash: Hex;
  schemaKey: string;
  label: string;
  source: "vault" | "anchor";
  /** Status on the current CredentialStatusRegistry (not an old deploy). */
  status: "Active" | "Revoked" | "None" | "Unknown" | "checking";
};

type DraftLink = {
  id: string;
  /** On-chain attrKey when already published */
  attrKey?: string;
  type: string;
  slot: string;
  href: string;
  label: string;
  pending: "none" | "add" | "remove";
  /** Bare `did/svc/Type` (sin slot) — no auto-migrar; evita pisar Type.slot existentes */
  legacyBare?: boolean;
};

function hrefToLabel(href: string, label: string): string {
  if (label.trim()) return label.trim();
  return suggestLinkLabel(href);
}

function normalizeHref(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return `https://${t}`;
  return t;
}

function profileSnapshot(
  p: PublicPageProfile,
  linkAttrKeys: string[]
): string {
  return buildPageProfileSnapshot(p, linkAttrKeys);
}

export function MyPagePage() {
  const { session } = useOutletContext<{
    session: SessionIdentity | null;
    setSession: (s: SessionIdentity | null) => void;
  }>();

  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [accent, setAccent] = useState("#1a5f4a");
  const [theme, setTheme] = useState<PageThemeId>("moss");
  const [layout, setLayout] = useState<PageLayoutId>("classic");
  const [showLoveInvite, setShowLoveInvite] = useState(true);
  const [loveNode, setLoveNode] = useState<Address | "">("");
  const [loveDefaultAmt, setLoveDefaultAmt] = useState(DEFAULT_TIP_AMT);
  const [memberNodes, setMemberNodes] = useState<
    Array<{ address: Address; name: string }>
  >([]);
  const [badges, setBadges] = useState<PublicPageBadge[]>([]);
  const [candidates, setCandidates] = useState<BadgeCandidate[]>([]);
  const [draftLinks, setDraftLinks] = useState<DraftLink[]>([]);
  const [publishedProfileJson, setPublishedProfileJson] = useState("");
  const [baselineProfile, setBaselineProfile] = useState<PublicPageProfile>({});
  const [baselineLinks, setBaselineLinks] = useState<
    Array<{ attrKey: string; type: string; label: string; href: string }>
  >([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<LinkKindId>("github");
  const [linkLabel, setLinkLabel] = useState("GitHub");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  /** When true, next refresh ignores local pending-add drafts (post-publish). */
  const clearPendingOnRefresh = useRef(false);
  const dragLinkId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const shareRef = session?.displayName
    ? `@${session.displayName}`
    : session?.did ?? "";
  const shareUrl = useMemo(
    () => (shareRef ? buildPublicPageShareUrl(shareRef) : ""),
    [shareRef]
  );
  const publicPath = session?.displayName
    ? `/u/@${session.displayName}`
    : session?.did
      ? `/u/${encodeURIComponent(session.did)}`
      : "/page";

  const draftLinkAttrKeys = useMemo(
    () =>
      draftLinks
        .filter((l) => l.pending !== "remove")
        .map((l) =>
          l.attrKey?.trim()
            ? l.attrKey.trim()
            : l.slot.trim()
              ? `${l.type}.${l.slot.trim()}`
              : publicLinkOrderKey(l)
        ),
    [draftLinks]
  );

  const draftProfile: PublicPageProfile = useMemo(
    () => ({
      title: title.trim() || undefined,
      bio: bio.trim() || undefined,
      accent: /^#[0-9a-fA-F]{6}$/.test(accent)
        ? accent
        : themeTokens(theme).accent,
      theme,
      layout,
      badges,
      showLoveInvite,
      loveNode: showLoveInvite && loveNode ? loveNode : undefined,
      loveDefaultAmt: showLoveInvite ? loveDefaultAmt : undefined,
      linkOrder: reconcileLinkOrder(
        draftLinks
          .filter((l) => l.pending !== "remove")
          .map((l) => publicLinkOrderKey(l)),
        draftLinkAttrKeys
      ),
    }),
    [
      title,
      bio,
      accent,
      theme,
      layout,
      badges,
      showLoveInvite,
      loveNode,
      loveDefaultAmt,
      draftLinks,
      draftLinkAttrKeys,
    ]
  );

  const visibleLinks: PublicPageLink[] = useMemo(
    () =>
      draftLinks
        .filter((l) => l.pending !== "remove")
        .map((l) => ({
          attrKey: l.attrKey ?? l.id,
          type: l.type,
          label: l.label,
          href: l.href,
        })),
    [draftLinks]
  );

  const profileDirty =
    publishedProfileJson !== "" &&
    profileSnapshot(draftProfile, draftLinkAttrKeys) !== publishedProfileJson;

  const linksToAdd = draftLinks.filter((l) => l.pending === "add");
  const linksToRemove = draftLinks.filter((l) => l.pending === "remove");
  const linksDirty = linksToAdd.length + linksToRemove.length > 0;
  const dirty = profileDirty || linksDirty;
  /** Solo lo que el usuario cambió — no reescribir links bare existentes. */
  const txCount =
    (profileDirty ? 1 : 0) + linksToAdd.length + linksToRemove.length;

  const profileDiffs = useMemo(
    () =>
      profileDirty ? buildProfileFieldDiffs(baselineProfile, draftProfile) : [],
    [profileDirty, baselineProfile, draftProfile]
  );

  const afterCheckoutLinks = useMemo(
    () =>
      draftLinks
        .filter((l) => l.pending !== "remove")
        .map((l) => toCheckoutLink(l)),
    [draftLinks]
  );

  const bareLegacyWarning = useMemo(() => {
    const bares = draftLinks.filter(
      (l) =>
        l.pending !== "remove" &&
        Boolean(l.legacyBare || (l.attrKey && !l.attrKey.includes(".")))
    );
    if (!bares.length) return null;
    return bares.map((b) => `“${b.label}”`).join(", ");
  }, [draftLinks]);

  const txPlan = useMemo((): TxPlanRow[] => {
    const rows: TxPlanRow[] = [];
    if (profileDirty) {
      rows.push({
        id: "profile",
        kind: "profile",
        title: "Personalización",
        detail:
          profileDiffs.map((d) => d.label).join(", ") || "Actualizar página",
      });
    }
    for (const l of linksToAdd) {
      const slot = l.slot.trim() || deriveServiceSlot(l.type, l.href, l.label);
      const attrKey = `${l.type}.${slot}`;
      rows.push({
        id: `add-${l.id}`,
        kind: "add",
        title: `Añadir “${l.label}”`,
        detail: `${attrKey} · ${l.href}`,
      });
    }
    for (const l of linksToRemove) {
      rows.push({
        id: `rm-${l.attrKey ?? l.id}`,
        kind: "remove",
        title: `Quitar “${l.label}”`,
        detail: `${l.attrKey ?? l.type} · ${l.href}`,
      });
    }
    return rows;
  }, [profileDirty, profileDiffs, linksToAdd, linksToRemove]);

  const estimateCheckout = useCallback(async () => {
    if (!session) return null;
    const client = await getReadClient();
    const addresses = await getAddresses();
    const nextNonce = Number(
      await client.publicClient.getTransactionCount({
        address: session.address,
        blockTag: "pending",
      })
    );
    let gasPriceWei: bigint | undefined;
    try {
      const fees = await client.publicClient.estimateFeesPerGas();
      gasPriceWei = fees.maxFeePerGas ?? fees.gasPrice ?? undefined;
    } catch {
      /* optional */
    }

    const FALLBACK = 150_000n;
    const validity = 60n * 60n * 24n * 365n * 100n;

    async function estimateSet(name: Hex, value: Hex, validitySec: bigint) {
      try {
        const data = encodeFunctionData({
          abi: didRegistryAbi,
          functionName: "setAttribute",
          args: [session!.address, name, value, validitySec],
        });
        return (await client.publicClient.estimateGas({
          account: session!.address,
          to: addresses.DIDRegistry,
          data,
        })) as bigint;
      } catch {
        return FALLBACK;
      }
    }

    const rows: TxPlanRow[] = [];
    let i = 0;

    if (profileDirty) {
      const value = encodeDidServiceValue({
        type: PAGE_PROFILE_TYPE,
        serviceEndpoint: encodePageProfile(draftProfile),
      });
      const gas = await estimateSet(
        serviceAttributeName(PAGE_PROFILE_TYPE),
        value,
        validity
      );
      rows.push({
        id: "profile",
        kind: "profile",
        title: "Personalización",
        detail:
          profileDiffs.map((d) => d.label).join(", ") || "Actualizar página",
        gas,
        nonce: nextNonce + i,
      });
      i += 1;
    }

    for (const l of linksToAdd) {
      const slot = l.slot.trim() || deriveServiceSlot(l.type, l.href, l.label);
      if (!slot) continue;
      const key = `${l.type}.${slot}`;
      const value = encodeDidServiceValue({
        id: `${session.did}#service-${key}`,
        type: l.type,
        serviceEndpoint: l.href,
        name: l.label || slot,
      });
      const gas = await estimateSet(
        serviceAttributeName(l.type, slot),
        value,
        validity
      );
      rows.push({
        id: `add-${l.id}`,
        kind: "add",
        title: `Añadir “${l.label}”`,
        detail: `${key} · ${l.href}`,
        gas,
        nonce: nextNonce + i,
      });
      i += 1;
    }

    for (const l of linksToRemove) {
      if (!l.attrKey) continue;
      const gas = await estimateSet(
        l.attrKey.includes(".")
          ? serviceAttributeName(
              l.attrKey.slice(0, l.attrKey.indexOf(".")),
              l.attrKey.slice(l.attrKey.indexOf(".") + 1)
            )
          : serviceAttributeName(l.attrKey),
        "0x" as Hex,
        0n
      );
      rows.push({
        id: `rm-${l.attrKey}`,
        kind: "remove",
        title: `Quitar “${l.label}”`,
        detail: `${l.attrKey} · ${l.href}`,
        gas,
        nonce: nextNonce + i,
      });
      i += 1;
    }

    return { nextNonce, gasPriceWei, rows };
  }, [
    session,
    profileDirty,
    profileDiffs,
    linksToAdd,
    linksToRemove,
    draftProfile,
  ]);

  const featuredHashes = useMemo(
    () => new Set(badges.map((b) => b.credHash.toLowerCase())),
    [badges]
  );

  const titleFallback = session?.displayName
    ? `@${session.displayName}`
    : "Tu página";

  const refresh = useCallback(async (opts?: { forceCold?: boolean }) => {
    if (!session) return;
    const client = await getReadClient();

    // Profile + membership in parallel — don't wait on badge anchors.
    const [doc, membership] = await Promise.all([
      portalResolveDid(session.did, {
        forceCold: opts?.forceCold,
      }),
      portalListMembershipNodes(session.address),
    ]);

    const list = doc.service ?? [];
    const p = parsePageProfile(list);
    setMemberNodes(
      membership.map((n) => ({ address: n.address, name: n.name }))
    );
    const pref = p.loveNode;
    let resolvedLove: Address | "" = "";
    if (
      pref &&
      membership.some((n) => n.address.toLowerCase() === pref.toLowerCase())
    ) {
      resolvedLove = pref;
    } else if (membership.length === 1) {
      resolvedLove = membership[0].address;
    } else if (pref) {
      resolvedLove = "";
    } else if (membership[0]) {
      resolvedLove = membership[0].address;
    }
    setLoveNode(resolvedLove);

    const showInvite = p.showLoveInvite !== false;
    const resolvedTheme = p.theme ?? "moss";
    const resolvedLayout = p.layout ?? "classic";
    const resolvedAccent =
      p.accent ?? themeTokens(resolvedTheme).accent;
    const resolvedAmt = p.loveDefaultAmt ?? DEFAULT_TIP_AMT;

    const publishedLinks = sortPublicLinks(
      extractPublicLinks(list, { keepBareWithSlotted: true }),
      p.linkOrder
    );
    const linkAttrKeys = publishedLinks.map((l) => l.attrKey);
    setTitle(p.title ?? "");
    setBio(p.bio ?? "");
    setAccent(resolvedAccent);
    setTheme(resolvedTheme);
    setLayout(resolvedLayout);
    setShowLoveInvite(showInvite);
    setLoveDefaultAmt(resolvedAmt);
    setBadges(p.badges ?? []);
    const baseline: PublicPageProfile = {
      title: p.title,
      bio: p.bio,
      accent: resolvedAccent,
      theme: resolvedTheme,
      layout: resolvedLayout,
      badges: p.badges,
      showLoveInvite: showInvite,
      loveNode: showInvite && resolvedLove ? resolvedLove : undefined,
      loveDefaultAmt: p.loveDefaultAmt,
      linkOrder: reconcileLinkOrder(p.linkOrder, linkAttrKeys),
    };
    setBaselineProfile(baseline);
    setBaselineLinks(
      publishedLinks.map((l) => ({
        attrKey: l.attrKey,
        type: l.type,
        label: l.label,
        href: l.href,
      }))
    );
    setPublishedProfileJson(profileSnapshot(baseline, linkAttrKeys));

    const discardLocalPending = clearPendingOnRefresh.current;
    clearPendingOnRefresh.current = false;

    setDraftLinks((prev) => {
      const pendingAdds = discardLocalPending
        ? []
        : prev.filter((l) => l.pending === "add");
      const removeKeys = new Set(
        discardLocalPending
          ? []
          : prev
              .filter((l) => l.pending === "remove" && l.attrKey)
              .map((l) => l.attrKey!.toLowerCase())
      );
      const fromChain: DraftLink[] = publishedLinks.map((l) => {
        const hasSlot = l.attrKey.includes(".");
        const slot = hasSlot
          ? l.attrKey.slice(l.attrKey.indexOf(".") + 1)
          : deriveServiceSlot(l.type, l.href, l.label);
        const display =
          l.label &&
          l.label !== l.href &&
          !/^https?:/i.test(l.label) &&
          !l.label.includes("@") &&
          !l.label.includes(".")
            ? l.label
            : suggestLinkLabel(l.href);
        const markedRemove = removeKeys.has(l.attrKey.toLowerCase());
        return {
          id: l.attrKey,
          attrKey: l.attrKey,
          type: l.type,
          slot,
          href: l.href,
          label: display,
          legacyBare: !hasSlot,
          // Never auto-queue bare→slot rewrite: that cleared bare and often
          // overwrote an existing Type.slot with the same derived slot.
          pending: markedRemove ? ("remove" as const) : ("none" as const),
        };
      });
      const keptAdds = pendingAdds.filter((a) => {
        if (a.id.startsWith("draft-")) return true;
        const slot = a.slot.toLowerCase();
        return !fromChain.some(
          (c) => c.type === a.type && c.slot.toLowerCase() === slot
        );
      });
      const seen = new Set(
        fromChain.map((c) => `${c.type}.${c.slot}`.toLowerCase())
      );
      const extra = keptAdds.filter((a) => {
        const k = `${a.type}.${a.slot}`.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return [...fromChain, ...extra];
    });

    // Badges: vault first (fast), then verify each hash on current registry.
    void (async () => {
      const local = await vault.list();
      let aura: VaultCredential[] = [];
      try {
        aura = await fetchAuraVault();
      } catch {
        aura = [];
      }
      const vaultCreds = [...local, ...aura];
      const map = new Map<string, BadgeCandidate>();
      for (const c of vaultCreds) {
        if (!c.credHash) continue;
        const subjectOk =
          !c.subjectDid ||
          c.subjectDid.toLowerCase() === session.did.toLowerCase();
        if (!subjectOk) continue;
        const hash = c.credHash.toLowerCase() as Hex;
        map.set(hash, {
          credHash: hash,
          schemaKey: c.schemaKey,
          label: c.label ?? schemaShort(c.schemaKey),
          source: "vault",
          status: "checking",
        });
      }
      setCandidates([...map.values()]);

      try {
        const anchors = await client.queryCredentialAnchors({
          subject: session.address,
        });
        for (const a of anchors) {
          const key = a.credHash.toLowerCase() as Hex;
          if (map.has(key)) continue;
          map.set(key, {
            credHash: key,
            schemaKey: `schema:${a.schemaId.slice(0, 10)}…`,
            label: `Ancla ${a.credHash.slice(0, 10)}…`,
            source: "anchor",
            status: "checking",
          });
        }
      } catch {
        /* anchors optional */
      }

      // Resolve live status — badges only show publicly if Active (or Revoked).
      await Promise.all(
        [...map.values()].map(async (c) => {
          try {
            const st = await client.getCredentialStatus(c.credHash);
            const subjectOk =
              st.subject &&
              st.subject.toLowerCase() === session.address.toLowerCase();
            const label =
              st.st === 1
                ? "Active"
                : st.st === 2
                  ? "Revoked"
                  : st.st === 0
                    ? "None"
                    : "Unknown";
            map.set(c.credHash, {
              ...c,
              status: subjectOk ? label : "None",
            });
          } catch {
            map.set(c.credHash, { ...c, status: "Unknown" });
          }
        })
      );
      setCandidates([...map.values()]);
    })();
  }, [session?.address, session?.did, session]);

  useEffect(() => {
    if (!session) return;
    void refresh().catch((e) =>
      setErr(e instanceof Error ? e.message : String(e))
    );
  }, [refresh, session]);

  function toggleBadge(c: BadgeCandidate) {
    const key = c.credHash.toLowerCase() as Hex;
    const exists = badges.some((b) => b.credHash.toLowerCase() === key);
    if (exists) {
      setBadges(badges.filter((b) => b.credHash.toLowerCase() !== key));
      setErr("");
      return;
    }
    if (badges.length >= 8) {
      setErr("Máximo 8 badges en la página pública");
      return;
    }
    if (c.status === "None" || c.status === "Unknown") {
      setErr(
        "Esa credencial no tiene ancla Active en el CredentialStatusRegistry actual (¿emitida en un deploy viejo?). En la página pública no se mostrará hasta re-anclarla aquí."
      );
      return;
    }
    if (c.status === "Revoked") {
      setErr("Esa ancla está Revoked — no sirve como badge de confianza.");
      return;
    }
    if (c.status === "checking") {
      setErr("Aún comprobando el ancla on-chain…");
      return;
    }
    setErr("");
    setBadges([
      ...badges,
      {
        credHash: key,
        schemaKey: c.schemaKey,
        label: c.label,
      },
    ]);
  }

  function selectLinkKind(id: LinkKindId) {
    const kind = LINK_KINDS.find((k) => k.id === id) ?? LINK_KINDS[0];
    setLinkKind(kind.id);
    if (kind.id !== "custom") {
      setLinkLabel(kind.label);
    }
  }

  function queueAddLink() {
    const href = normalizeHref(linkUrl);
    if (!href) {
      setErr("Pega una URL o email");
      return;
    }
    const kind = LINK_KINDS.find((k) => k.id === linkKind) ?? LINK_KINDS[0];
    const type = kind.type;
    const display = hrefToLabel(href, linkLabel || suggestLinkLabel(href));
    if (!display.trim()) {
      setErr("Escribe el texto del botón (ej. Blog, Criteria, Mail)");
      return;
    }
    const slot = deriveServiceSlot(type, href, display);

    const clash = draftLinks.find((l) => {
      if (l.pending === "remove") return false;
      const s = l.attrKey?.includes(".")
        ? l.attrKey.slice(l.attrKey.indexOf(".") + 1)
        : l.slot.trim() || deriveServiceSlot(l.type, l.href, l.label);
      return l.type === type && s.toLowerCase() === slot.toLowerCase();
    });
    if (clash) {
      setErr(
        `Ya tienes un botón “${clash.label}”. Usa otro nombre (Blog, Lab, Docs…).`
      );
      return;
    }

    setDraftLinks((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        slot,
        href,
        label: display,
        pending: "add",
      },
    ]);
    setLinkUrl("");
    if (kind.id === "custom") setLinkLabel("");
    setMsg(`Añadido: “${display}”`);
    setErr("");
  }

  function queueRemoveLink(link: DraftLink) {
    if (link.pending === "add") {
      setDraftLinks((prev) => prev.filter((l) => l.id !== link.id));
      return;
    }
    setDraftLinks((prev) =>
      prev.map((l) =>
        l.id === link.id ? { ...l, pending: "remove" as const } : l
      )
    );
  }

  function undoRemove(link: DraftLink) {
    setDraftLinks((prev) =>
      prev.map((l) =>
        l.id === link.id ? { ...l, pending: "none" as const } : l
      )
    );
  }

  function reorderDraftLink(fromId: string, toId: string) {
    if (fromId === toId) return;
    setDraftLinks((prev) => {
      const from = prev.findIndex((l) => l.id === fromId);
      const to = prev.findIndex((l) => l.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setMsg("Orden actualizado en el borrador — publica para guardarlo on-chain");
    setErr("");
  }

  async function publishAll() {
    if (!session) return;
    if (!dirty || txCount === 0) {
      setMsg("No hay cambios pendientes");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    let step = 0;
    const writtenAttrKeys: string[] = [];
    const expectedServices: DidService[] = [];
    try {
      const profilePayload = encodePageProfile({
        ...draftProfile,
        linkOrder: reconcileLinkOrder(
          draftProfile.linkOrder,
          draftLinkAttrKeys
        ),
      });

      if (profileDirty) {
        step += 1;
        setProgress(`Tx ${step}/${txCount}: personalización (PerantoPage)`);
        await portalSetDidService(PAGE_PROFILE_TYPE, profilePayload, session);
        writtenAttrKeys.push(PAGE_PROFILE_TYPE);
        expectedServices.push({
          id: `${session.did}#service-${PAGE_PROFILE_TYPE}`,
          type: PAGE_PROFILE_TYPE,
          serviceEndpoint: profilePayload,
          attrKey: PAGE_PROFILE_TYPE,
        });
      }

      if (linksDirty) {
        const takenSlots = new Set(
          draftLinks
            .filter((l) => l.pending === "none" && l.attrKey?.includes("."))
            .map((l) => `${l.type}.${l.slot}`.toLowerCase())
        );
        for (const l of linksToAdd) {
          let slot = l.slot.trim() || deriveServiceSlot(l.type, l.href, l.label);
          if (!slot) {
            throw new Error(
              `No se pudo derivar id on-chain para “${l.label}”. Cambia el texto del botón.`
            );
          }
          let guard = 0;
          while (
            takenSlots.has(`${l.type}.${slot}`.toLowerCase()) &&
            guard < 8
          ) {
            slot = `${slot}${guard + 2}`.slice(0, 24);
            guard += 1;
          }
          if (!slot.trim()) {
            throw new Error(`Slot vacío al publicar “${l.label}”`);
          }
          const attrKey = `${l.type}.${slot}`;
          takenSlots.add(attrKey.toLowerCase());
          step += 1;
          setProgress(`Tx ${step}/${txCount}: ${l.label} (${attrKey})`);
          await portalSetDidService(
            l.type,
            l.href,
            session,
            slot,
            l.label || slot
          );
          writtenAttrKeys.push(attrKey);
          expectedServices.push({
            id: `${session.did}#service-${attrKey}`,
            type: l.type,
            serviceEndpoint: l.href,
            attrKey,
            name: l.label || slot,
          });
        }
        for (const l of linksToRemove) {
          if (!l.attrKey) continue;
          step += 1;
          setProgress(`Tx ${step}/${txCount}: quitar ${l.label} (${l.attrKey})`);
          await portalClearDidService(l.attrKey, session);
        }
      }

      // Keep surviving links in expected seed (incl. bare legacy).
      for (const l of draftLinks) {
        if (l.pending === "remove" || l.pending === "add") continue;
        if (!l.attrKey) continue;
        expectedServices.push({
          id: `${session.did}#service-${l.attrKey}`,
          type: l.type,
          serviceEndpoint: l.href,
          attrKey: l.attrKey,
          name: l.label,
        });
      }

      const addresses = await getAddresses();
      seedExpectedDidServices(
        addresses.DIDRegistry,
        session.did,
        expectedServices
      );

      setProgress("");
      setMsg(
        `Publicado: ${txCount} transacción${txCount === 1 ? "" : "es"} on-chain`
      );
      clearPendingOnRefresh.current = true;
      await refresh();

      // Verify expected attrKeys survived warm sync.
      const doc = await portalResolveDid(session.did);
      const got = new Set(
        (doc.service ?? [])
          .map((s) => s.attrKey?.toLowerCase())
          .filter(Boolean) as string[]
      );
      const missing = writtenAttrKeys.filter((k) => !got.has(k.toLowerCase()));
      if (missing.length) {
        // Un firmante sin soporte de slot escribe `Type` en vez de `Type.slot`:
        // se distingue porque el tipo bare sí quedó on-chain.
        const bare = missing.filter((k) => {
          const dot = k.indexOf(".");
          return dot > 0 && got.has(k.slice(0, dot).toLowerCase());
        });
        setErr(
          bare.length
            ? `El firmante escribió ${bare
                .map((k) => k.slice(0, k.indexOf(".")))
                .join(", ")} sin slot (${bare.join(", ")}). Recarga la extensión Aura en chrome://extensions y la pestaña (Ctrl+Shift+R), luego vuelve a publicar el enlace.`
            : `Sync incompleto tras publicar — no aparecen: ${missing.join(", ")}. Reintenta “Revisar y publicar” o recarga; si persiste, el RPC puede estar truncando logs.`
        );
      }
      setCheckoutOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Cargando sesión…</p>
      </div>
    );
  }

  const previewBlock = (
    <Linktr33Preview
      profile={draftProfile}
      links={visibleLinks}
      badges={badges}
      handle={session.displayName ?? null}
      titleFallback={titleFallback}
      dirty={dirty}
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
            linktr33
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Edita en borrador y publica todo junto. Nada se escribe on-chain
            hasta que pulses <strong>Revisar y publicar</strong>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
            <SheetTrigger
              render={
                <Button size="sm" variant="outline" className="lg:hidden" />
              }
            >
              <Eye className="size-3.5" />
              Vista previa
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Vista previa</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6">{previewBlock}</div>
            </SheetContent>
          </Sheet>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setMsg("Enlace copiado");
            }}
          >
            <Copy className="size-3.5" />
            Copiar URL
          </Button>
          <Sheet open={cardOpen} onOpenChange={setCardOpen}>
            <SheetTrigger
              render={<Button size="sm" variant="outline" type="button" />}
            >
              <QrCode className="size-3.5" />
              QR evento
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Tarjeta de presentación</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-8">
                <p className="mb-4 text-sm text-muted-foreground">
                  Muéstralo en el evento. Quien escanee abre tu linktr33 y puede
                  guardar el contacto o descargar un vCard.
                </p>
                <PublicPresentationCard
                  shareUrl={shareUrl}
                  title={title.trim() || titleFallback}
                  handle={
                    session.displayName ? `@${session.displayName}` : null
                  }
                  did={session.did}
                  address={session.address}
                  links={visibleLinks}
                  bio={bio}
                  size="lg"
                />
              </div>
            </SheetContent>
          </Sheet>
          <Link to={publicPath} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" type="button">
              <ExternalLink className="size-3.5" />
              Página live
            </Button>
          </Link>
        </div>
      </div>

      <HelpCallout title="Cómo funciona">
        <p>
          Edita con calma: nada se cobra hasta{" "}
          <strong>Publicar todo</strong>. Los links usan un texto de botón
          (Telegram, Website, Mail…) — no la URL cruda. PerantoPage y servicios
          DID no cobran fee al protocolo (solo gas de red); anclar credenciales
          o registrar nombre sí van al tesoro. Esas txs aparecen en{" "}
          <strong>Actividad</strong> tras sincronizar.
          {dirty ? (
            <>
              {" "}
              Ahora mismo: <strong>{txCount} transacción(es)</strong> al
              publicar.
            </>
          ) : null}
        </p>
      </HelpCallout>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card>
            <CardTitle>Personalización</CardTitle>
            <CardDesc>
              Servicio DID{" "}
              <code className="text-[10px]">{PAGE_PROFILE_TYPE}</code>
            </CardDesc>
            <Label className="mt-3">Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={titleFallback}
              maxLength={80}
            />
            <Label className="mt-2">Bio</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Una línea sobre ti o tu cooperativa…"
              maxLength={280}
              rows={3}
            />
            <Label className="mt-2">Plantilla visual</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {PAGE_THEME_IDS.map((id) => {
                const t = PAGE_THEMES[id];
                const on = theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTheme(id);
                      if (
                        !accent ||
                        accent === "#1a5f4a" ||
                        Object.values(PAGE_THEMES).some(
                          (x) => x.accent === accent
                        )
                      ) {
                        setAccent(t.accent);
                      }
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition",
                      on
                        ? "border-[var(--color-moss)] bg-[var(--color-moss)]/10"
                        : "border-[var(--color-moss)]/15 hover:border-[var(--color-moss)]/35"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                        style={{ background: t.accent }}
                      />
                      <span className="text-sm font-semibold">{t.label}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {t.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PAGE_LAYOUT_IDS.map((id) => {
                const L = PAGE_LAYOUTS[id];
                const on = layout === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLayout(id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs",
                      on
                        ? "border-[var(--color-moss)] bg-[var(--color-moss)]/10 font-semibold"
                        : "border-[var(--color-moss)]/20 text-muted-foreground"
                    )}
                    title={L.blurb}
                  >
                    {L.label}
                  </button>
                );
              })}
            </div>

            <Label className="mt-3">Color de acento</Label>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#1a5f4a"}
                onChange={(e) => setAccent(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-[var(--color-moss)]/20 bg-transparent"
              />
              <Input
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="font-mono text-xs"
                maxLength={7}
              />
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-moss)]/15 bg-[var(--color-mist)]/40 px-3 py-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--color-moss-deep)]"
                checked={showLoveInvite}
                onChange={(e) => setShowLoveInvite(e.target.checked)}
              />
              <span className="text-sm leading-snug">
                <span className="font-medium text-[var(--color-moss-deep)]">
                  Mostrar QR de Love
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Al final de la página pública.
                </span>
              </span>
            </label>

            {showLoveInvite && (
              <div className="mt-3 space-y-3 rounded-xl border border-[var(--color-moss)]/12 px-3 py-3">
                <div>
                  <Label>DisCO del tip</Label>
                  {memberNodes.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Sin membresía aún — Cooperativa.
                    </p>
                  ) : (
                    <select
                      className="mt-2 w-full rounded-xl border border-[var(--color-moss)]/20 bg-background px-3 py-2 text-sm"
                      value={loveNode}
                      onChange={(e) =>
                        setLoveNode(e.target.value as Address)
                      }
                    >
                      <option value="">— elegir nodo —</option>
                      {memberNodes.map((n) => (
                        <option key={n.address} value={n.address}>
                          {n.name || n.address.slice(0, 10)}…
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <Label>Monto sugerido</Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {TIP_AMOUNT_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setLoveDefaultAmt(p)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs tabular-nums",
                          loveDefaultAmt === p
                            ? "border-[var(--color-moss)] bg-[var(--color-moss)]/10 font-semibold"
                            : "border-[var(--color-moss)]/20 text-muted-foreground"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input
                    className="mt-2 font-mono text-xs"
                    value={loveDefaultAmt}
                    onChange={(e) =>
                      setLoveDefaultAmt(e.target.value.replace(/[^\d.]/g, ""))
                    }
                    placeholder={DEFAULT_TIP_AMT}
                  />
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Badges</CardTitle>
            <CardDesc>
              Solo hashes en PerantoPage; la página pública exige ancla{" "}
              <strong>Active</strong> en el registry actual. Credenciales de un
              deploy anterior aparecen aquí pero no valen hasta re-emitir/anclar.
            </CardDesc>
            {candidates.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Sin credenciales/anclas aún.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {candidates.map((c) => {
                  const on = featuredHashes.has(c.credHash.toLowerCase());
                  const canFeature = c.status === "Active";
                  return (
                    <li
                      key={c.credHash}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2",
                        on
                          ? "border-[var(--color-moss)]/30 bg-[var(--color-moss)]/5"
                          : "border-[var(--color-moss)]/12",
                        !canFeature && !on && "opacity-70"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {c.label}
                          <span
                            className={cn(
                              "ml-2 text-[10px] font-normal",
                              c.status === "Active" &&
                                "text-[var(--color-moss)]",
                              c.status === "Revoked" &&
                                "text-[var(--color-danger)]",
                              (c.status === "None" ||
                                c.status === "Unknown" ||
                                c.status === "checking") &&
                                "text-muted-foreground"
                            )}
                          >
                            {c.status === "checking"
                              ? "comprobando…"
                              : c.status === "None"
                                ? "sin ancla aquí"
                                : c.status}
                          </span>
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {c.schemaKey} · {c.source}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={on ? "default" : "secondary"}
                        disabled={busy || (!on && !canFeature)}
                        onClick={() => toggleBadge(c)}
                      >
                        <BadgeCheck className="size-3.5" />
                        {on ? "En página" : canFeature ? "Mostrar" : "No válida"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {badges.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {badges.length}/8 en el borrador
              </p>
            )}
            {badges.some((b) => {
              const c = candidates.find(
                (x) => x.credHash.toLowerCase() === b.credHash.toLowerCase()
              );
              return c && (c.status === "None" || c.status === "Unknown");
            }) && (
              <p className="mt-2 rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/5 px-3 py-2 text-xs text-[var(--color-moss-deep)]">
                Hay badges guardados en PerantoPage sin ancla Active en este
                registry. Quítalos o vuelve a emitir/anclar la VC en Credenciales
                con el deploy actual.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Links</CardTitle>
            <CardDesc>
              Tipo, URL y el <strong>texto del botón</strong> (Blog, Mail…).
              Puedes tener varios del mismo tipo si el nombre es distinto.
            </CardDesc>

            {bareLegacyWarning && (
              <p className="mt-3 rounded-xl border border-[#c4a35a]/35 bg-[#c4a35a]/10 px-3 py-2 text-xs text-[var(--color-moss-deep)]">
                Link(s) antiguo(s) sin id on-chain: {bareLegacyWarning}. No se
                reescriben solos; bórralos y vuelve a añadirlos con nombre si
                quieres varios del mismo tipo. Añadir uno nuevo{" "}
                <em>no</em> los borra.
              </p>
            )}

            {draftLinks.filter((l) => l.pending !== "remove").length === 0 && (
              <p className="mt-3 rounded-xl border border-[var(--color-moss)]/25 bg-[var(--color-moss)]/8 px-3 py-2 text-xs text-[var(--color-moss-deep)]">
                Aún no hay links. Añade canales abajo y pulsa{" "}
                <strong>Revisar y publicar</strong>.
              </p>
            )}

            <Label className="mt-3">Tipo de link</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LINK_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => selectLinkKind(k.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium",
                    linkKind === k.id
                      ? "border-[var(--color-moss)] bg-[var(--color-moss)]/10 text-[var(--color-moss-deep)]"
                      : "border-[var(--color-moss)]/20 text-muted-foreground hover:border-[var(--color-moss)]/40"
                  )}
                >
                  {k.id === "custom" ? "Otro" : k.label}
                </button>
              ))}
            </div>

            <Label className="mt-3">URL o email</Label>
            <Input
              value={linkUrl}
              onChange={(e) => {
                const v = e.target.value;
                setLinkUrl(v);
                if (linkKind === "custom" || !linkLabel.trim()) {
                  const href = normalizeHref(v);
                  if (href) setLinkLabel(suggestLinkLabel(href));
                }
              }}
              placeholder={
                LINK_KINDS.find((k) => k.id === linkKind)?.placeholder ??
                "https://…"
              }
            />

            <Label className="mt-3">Texto del botón (obligatorio)</Label>
            <Input
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              placeholder="Telegram · Website · Mail · GitHub…"
              maxLength={48}
            />
            <FieldHint>
              Así se muestra en tu linktr33. No uses la URL completa como texto.
            </FieldHint>

            {linkLabel.trim() && linkUrl.trim() && (
              <p className="mt-2 text-xs text-muted-foreground">
                Vista del botón:{" "}
                <span className="inline-flex rounded-lg border border-[var(--color-moss)]/20 bg-[var(--color-mist)]/50 px-2.5 py-1 font-semibold text-[var(--color-moss-deep)]">
                  {linkLabel.trim()}
                </span>
              </p>
            )}

            <Button
              className="mt-3"
              variant="secondary"
              disabled={busy || !linkUrl.trim() || !linkLabel.trim()}
              onClick={queueAddLink}
            >
              <Link2 className="size-3.5" />
              Añadir al borrador
            </Button>

            <ul className="mt-4 space-y-2">
              {draftLinks.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Ningún link aún. Empieza por GitHub, Website o Mail.
                </p>
              )}
              {draftLinks.map((l) => (
                <li
                  key={l.id}
                  draggable={!busy}
                  onDragStart={(e) => {
                    dragLinkId.current = l.id;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", l.id);
                  }}
                  onDragEnd={() => {
                    dragLinkId.current = null;
                    setDragOverId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverId !== l.id) setDragOverId(l.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverId === l.id) setDragOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragLinkId.current ||
                      e.dataTransfer.getData("text/plain");
                    setDragOverId(null);
                    if (from) reorderDraftLink(from, l.id);
                    dragLinkId.current = null;
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-2 py-2.5 transition",
                    l.pending === "add" &&
                      "border-[var(--color-moss)]/40 bg-[var(--color-moss)]/5",
                    l.pending === "remove" &&
                      "border-[var(--color-danger)]/30 opacity-60",
                    dragOverId === l.id &&
                      "border-[var(--color-moss)] ring-1 ring-[var(--color-moss)]/30"
                  )}
                >
                  <button
                    type="button"
                    className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-black/[0.04] active:cursor-grabbing"
                    aria-label={`Arrastrar ${l.label}`}
                    disabled={busy}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-semibold",
                        l.pending === "remove" && "line-through"
                      )}
                    >
                      {l.label}
                      {l.pending === "add" && (
                        <span className="ml-2 text-[10px] font-normal text-[var(--color-moss)]">
                          nuevo
                        </span>
                      )}
                      {l.pending === "none" &&
                        (l.legacyBare ||
                          (l.attrKey && !l.attrKey.includes("."))) && (
                        <span className="ml-2 text-[10px] font-normal text-[#8a7040]">
                          sin id
                        </span>
                      )}
                      {l.pending === "remove" && (
                        <span className="ml-2 text-[10px] font-normal text-[var(--color-danger)]">
                          se quitará
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {l.href}
                    </p>
                  </div>
                  {l.pending === "remove" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => undoRemove(l)}
                    >
                      Deshacer
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => queueRemoveLink(l)}
                    >
                      <Trash2 className="size-3.5 text-[var(--color-danger)]" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {(msg || err || progress) && (
            <p
              className={`text-sm ${err ? "text-[var(--color-danger)]" : "text-[var(--color-moss)]"}`}
            >
              {err || progress || msg}
            </p>
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Vista previa
            </p>
            {previewBlock}
          </div>
        </aside>
      </div>

      {/* Sticky publish bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-moss)]/15 bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/85">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                {progress || "Publicando…"}
              </span>
            ) : dirty ? (
              <>
                Borrador ·{" "}
                <strong className="text-[var(--color-moss-deep)]">
                  {txCount} tx
                </strong>
                {profileDirty && (
                  <span className="text-xs"> · perfil/tema/badges</span>
                )}
                {linksDirty && (
                  <span className="text-xs">
                    {" "}
                    · links +{linksToAdd.length} / −{linksToRemove.length}
                  </span>
                )}
              </>
            ) : (
              "Sin cambios pendientes"
            )}
          </p>
          <Button
            disabled={busy || !dirty}
            onClick={() => setCheckoutOpen(true)}
          >
            Revisar y publicar
            {dirty && !busy ? ` (${txCount})` : ""}
          </Button>
        </div>
      </div>
      <div className="h-20" aria-hidden />

      <PublishCheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        txCount={txCount}
        did={session.did}
        address={session.address}
        baselineProfile={baselineProfile}
        draftProfile={draftProfile}
        profileDiffs={profileDiffs}
        beforeLinks={baselineLinks.map((l) => toCheckoutLink(l))}
        afterLinks={afterCheckoutLinks}
        linksToAdd={linksToAdd.map((l) => toCheckoutLink(l))}
        linksToRemove={linksToRemove.map((l) => toCheckoutLink(l))}
        txPlan={txPlan}
        busy={busy}
        progress={progress}
        onConfirm={() => void publishAll()}
        onEstimate={estimateCheckout}
      />
    </div>
  );
}
