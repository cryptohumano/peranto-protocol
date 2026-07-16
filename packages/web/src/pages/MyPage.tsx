import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  BadgeCheck,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDesc, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldHint, HelpCallout } from "@/components/HelpCallout";
import { Linktr33Preview } from "@/components/Linktr33Preview";
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
  buildPublicPageShareUrl,
  encodePageProfile,
  extractPublicLinks,
  parsePageProfile,
  schemaShort,
  deriveServiceSlot,
  maxServiceSlotLength,
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
import type { DidService, VaultCredential } from "@peranto/sdk";
import type { Address, Hex } from "viem";
import { cn } from "@/lib/utils";
import {
  fetchAuraVault,
  getReadClient,
  portalClearDidService,
  portalListMembershipNodes,
  portalResolveDid,
  portalSetDidService,
  vault,
} from "@/lib/client";
import type { SessionIdentity } from "@/lib/session";

const LINK_PRESETS = [
  { type: "LinkedDomains", hint: "Red / perfil (github, web, X…)" },
  { type: "Website", hint: "Sitio principal" },
  {
    type: "CredentialInbox",
    hint: "Email o URL de contacto — un email se abre como mailto:",
  },
] as const;

type BadgeCandidate = {
  credHash: Hex;
  schemaKey: string;
  label: string;
  source: "vault" | "anchor";
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
};

function hrefToLabel(href: string, slot: string, type: string): string {
  if (slot.trim()) return slot.trim();
  if (/^mailto:/i.test(href)) return href.replace(/^mailto:/i, "");
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return type;
  }
}

function normalizeHref(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return `https://${t}`;
  return t;
}

function profileSnapshot(p: PublicPageProfile): string {
  return encodePageProfile(p);
}

export function MyPagePage() {
  const { session } = useOutletContext<{
    session: SessionIdentity;
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
  const [linkType, setLinkType] = useState<string>("LinkedDomains");
  const [linkSlot, setLinkSlot] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const shareRef = session.displayName
    ? `@${session.displayName}`
    : session.did;
  const shareUrl = useMemo(
    () => buildPublicPageShareUrl(shareRef),
    [shareRef]
  );
  const publicPath = session.displayName
    ? `/u/@${session.displayName}`
    : `/u/${encodeURIComponent(session.did)}`;

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
    profileSnapshot(draftProfile) !== publishedProfileJson;

  const linksToAdd = draftLinks.filter((l) => l.pending === "add");
  const linksToRemove = draftLinks.filter((l) => l.pending === "remove");
  const linksToKeep = draftLinks.filter((l) => l.pending === "none");
  const linksDirty = linksToAdd.length + linksToRemove.length > 0;
  const dirty = profileDirty || linksDirty;
  /** When links change, re-write every kept link so RPC lookback can’t drop them. */
  const linkWriteCount = linksDirty
    ? linksToKeep.length + linksToAdd.length + linksToRemove.length
    : 0;
  const txCount = (profileDirty ? 1 : 0) + linkWriteCount;

  const featuredHashes = useMemo(
    () => new Set(badges.map((b) => b.credHash.toLowerCase())),
    [badges]
  );

  const titleFallback = session.displayName
    ? `@${session.displayName}`
    : "Tu página";

  const refresh = useCallback(async () => {
    const client = await getReadClient();
    const doc = await portalResolveDid(session.did);
    const list = doc.service ?? [];
    const p = parsePageProfile(list);
    const membership = await portalListMembershipNodes(session.address);
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
    const published: PublicPageProfile = {
      title: p.title,
      bio: p.bio,
      accent: resolvedAccent,
      theme: resolvedTheme,
      layout: resolvedLayout,
      badges: p.badges ?? [],
      showLoveInvite: showInvite,
      loveNode: showInvite && resolvedLove ? resolvedLove : undefined,
      loveDefaultAmt: showInvite ? resolvedAmt : undefined,
    };
    setTitle(p.title ?? "");
    setBio(p.bio ?? "");
    setAccent(resolvedAccent);
    setTheme(resolvedTheme);
    setLayout(resolvedLayout);
    setShowLoveInvite(showInvite);
    setLoveDefaultAmt(resolvedAmt);
    setBadges(p.badges ?? []);
    setPublishedProfileJson(profileSnapshot(published));

    const publishedLinks = extractPublicLinks(list);
    setDraftLinks((prev) => {
      const pendingAdds = prev.filter((l) => l.pending === "add");
      const removeKeys = new Set(
        prev
          .filter((l) => l.pending === "remove" && l.attrKey)
          .map((l) => l.attrKey!.toLowerCase())
      );
      const fromChain: DraftLink[] = publishedLinks.map((l) => {
        const slot = l.attrKey.includes(".")
          ? l.attrKey.slice(l.attrKey.indexOf(".") + 1)
          : "";
        const markedRemove = removeKeys.has(l.attrKey.toLowerCase());
        return {
          id: l.attrKey,
          attrKey: l.attrKey,
          type: l.type,
          slot,
          href: l.href,
          label: l.label,
          pending: markedRemove ? ("remove" as const) : ("none" as const),
        };
      });
      const chainKeys = new Set(
        fromChain.map((l) => l.attrKey?.toLowerCase()).filter(Boolean)
      );
      const keptAdds = pendingAdds.filter((a) => {
        const slot = a.slot.toLowerCase();
        const key = `${a.type}.${a.slot}`.toLowerCase();
        return !fromChain.some(
          (c) =>
            c.type === a.type &&
            c.slot.toLowerCase() === slot
        ) && !chainKeys.has(key);
      });
      return [...fromChain, ...keptAdds];
    });

    const local = await vault.list();
    let aura: VaultCredential[] = [];
    try {
      aura = await fetchAuraVault();
    } catch {
      aura = [];
    }
    const vaultCreds = [...local, ...aura];
    const anchors = await client.queryCredentialAnchors({
      subject: session.address,
    });
    const map = new Map<string, BadgeCandidate>();
    for (const c of vaultCreds) {
      if (!c.credHash) continue;
      const subjectOk =
        !c.subjectDid ||
        c.subjectDid.toLowerCase() === session.did.toLowerCase();
      if (!subjectOk) continue;
      map.set(c.credHash.toLowerCase(), {
        credHash: c.credHash,
        schemaKey: c.schemaKey,
        label: c.label ?? schemaShort(c.schemaKey),
        source: "vault",
      });
    }
    for (const a of anchors) {
      const key = a.credHash.toLowerCase();
      if (map.has(key)) continue;
      map.set(key, {
        credHash: a.credHash,
        schemaKey: `schema:${a.schemaId.slice(0, 10)}…`,
        label: `Ancla ${a.credHash.slice(0, 10)}…`,
        source: "anchor",
      });
    }
    setCandidates([...map.values()]);
  }, [session.address, session.did]);

  useEffect(() => {
    void refresh().catch((e) =>
      setErr(e instanceof Error ? e.message : String(e))
    );
  }, [refresh]);

  function toggleBadge(c: BadgeCandidate) {
    const key = c.credHash.toLowerCase();
    const exists = badges.some((b) => b.credHash.toLowerCase() === key);
    if (exists) {
      setBadges(badges.filter((b) => b.credHash.toLowerCase() !== key));
      return;
    }
    if (badges.length >= 8) {
      setErr("Máximo 8 badges en la página pública");
      return;
    }
    setErr("");
    setBadges([
      ...badges,
      {
        credHash: c.credHash,
        schemaKey: c.schemaKey,
        label: c.label,
      },
    ]);
  }

  function queueAddLink() {
    const href = normalizeHref(linkUrl);
    if (!href) return;
    const slot = deriveServiceSlot(linkType, href, linkSlot);
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Avoid duplicate slots for same type in draft
    const clash = draftLinks.some(
      (l) =>
        l.pending !== "remove" &&
        l.type === linkType &&
        l.slot.toLowerCase() === slot.toLowerCase()
    );
    const uniqueSlot = clash
      ? `${slot.slice(0, Math.max(1, maxServiceSlotLength(linkType) - 2))}${Math.floor(Math.random() * 90 + 10)}`
      : slot;
    setDraftLinks((prev) => [
      ...prev,
      {
        id,
        type: linkType,
        slot: uniqueSlot,
        href,
        label: hrefToLabel(href, uniqueSlot, linkType),
        pending: "add",
      },
    ]);
    setLinkUrl("");
    setLinkSlot("");
    setMsg("Link añadido al borrador (aún no on-chain)");
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

  async function publishAll() {
    if (!dirty || txCount === 0) {
      setMsg("No hay cambios pendientes");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    let step = 0;
    try {
      if (profileDirty) {
        step += 1;
        setProgress(`Tx ${step}/${txCount}: personalización (PerantoPage)`);
        await portalSetDidService(
          PAGE_PROFILE_TYPE,
          encodePageProfile(draftProfile),
          session
        );
      }
      if (linksDirty) {
        // Re-assert every link we want to keep (avoids “vanishing” after RPC lookback)
        for (const l of [...linksToKeep, ...linksToAdd]) {
          step += 1;
          setProgress(`Tx ${step}/${txCount}: link ${l.label}`);
          const slot = l.slot.trim() || deriveServiceSlot(l.type, l.href);
          await portalSetDidService(
            l.type,
            l.href,
            session,
            slot,
            l.label || slot
          );
        }
        for (const l of linksToRemove) {
          if (!l.attrKey) continue;
          step += 1;
          setProgress(`Tx ${step}/${txCount}: quitar ${l.label}`);
          await portalClearDidService(l.attrKey, session);
        }
      }
      setProgress("");
      setMsg(
        `Publicado: ${txCount} transacción${txCount === 1 ? "" : "es"} on-chain`
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const previewBlock = (
    <Linktr33Preview
      profile={draftProfile}
      links={visibleLinks}
      badges={badges}
      handle={session.displayName ?? null}
      titleFallback={titleFallback}
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
            hasta que pulses <strong>Publicar todo</strong>.
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
          <Link to={publicPath} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" type="button">
              <ExternalLink className="size-3.5" />
              Página live
            </Button>
          </Link>
        </div>
      </div>

      <HelpCallout title="Transparencia de gas">
        <p>
          Cada cambio en el DID es una tx. Aquí acumulas perfil, badges, tema y
          links en local; al publicar verás{" "}
          <strong>
            {dirty ? `${txCount} tx` : "0 tx (sin cambios)"}
          </strong>
          .
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
                  <Label>Monto sugerido (PAS)</Label>
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
              Solo hashes; el estado Active se verifica en la página live.
            </CardDesc>
            {candidates.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Sin credenciales/anclas aún.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {candidates.map((c) => {
                  const on = featuredHashes.has(c.credHash.toLowerCase());
                  return (
                    <li
                      key={c.credHash}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl border px-3 py-2",
                        on
                          ? "border-[var(--color-moss)]/30 bg-[var(--color-moss)]/5"
                          : "border-[var(--color-moss)]/12"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {c.label}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {c.schemaKey} · {c.source}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={on ? "default" : "secondary"}
                        disabled={busy}
                        onClick={() => toggleBadge(c)}
                      >
                        <BadgeCheck className="size-3.5" />
                        {on ? "En página" : "Mostrar"}
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
          </Card>

          <Card>
            <CardTitle>Links</CardTitle>
            <CardDesc>
              Se encolan en el borrador. Al publicar un cambio de links se
              reescriben todos los que quieras conservar (así no se “pierden”
              LinkedIn/GitHub al añadir Telegram).
            </CardDesc>
            <div className="mt-3 flex flex-wrap gap-1">
              {LINK_PRESETS.map((p) => (
                <Button
                  key={p.type}
                  size="sm"
                  variant={linkType === p.type ? "default" : "secondary"}
                  onClick={() => setLinkType(p.type)}
                >
                  {p.type}
                </Button>
              ))}
            </div>
            <FieldHint className="mt-2">
              {LINK_PRESETS.find((p) => p.type === linkType)?.hint} Si no pones
              etiqueta, se deriva del dominio/email (hace falta un slot único:
              sin él, el mismo tipo sobrescribe el link anterior).
            </FieldHint>
            <Label className="mt-2">Etiqueta / slot</Label>
            <Input
              value={linkSlot}
              onChange={(e) => setLinkSlot(e.target.value)}
              placeholder="github · web · x"
            />
            <Label className="mt-2">URL o email</Label>
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder={
                linkType === "CredentialInbox"
                  ? "hola@ejemplo.org o https://…"
                  : "https://…"
              }
            />
            <Button
              className="mt-3"
              variant="secondary"
              disabled={busy || !linkUrl.trim()}
              onClick={queueAddLink}
            >
              <Link2 className="size-3.5" />
              Añadir al borrador
            </Button>

            <ul className="mt-4 space-y-2">
              {draftLinks.length === 0 && (
                <p className="text-sm text-muted-foreground">Ningún link.</p>
              )}
              {draftLinks.map((l) => (
                <li
                  key={l.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border px-3 py-2",
                    l.pending === "add" &&
                      "border-[var(--color-moss)]/40 bg-[var(--color-moss)]/5",
                    l.pending === "remove" &&
                      "border-[var(--color-danger)]/30 opacity-60"
                  )}
                >
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-sm font-semibold capitalize",
                        l.pending === "remove" && "line-through"
                      )}
                    >
                      {l.label}
                      {l.pending === "add" && (
                        <span className="ml-2 text-[10px] font-normal text-[var(--color-moss)]">
                          nuevo
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
                Borrador con cambios ·{" "}
                <strong className="text-[var(--color-moss-deep)]">
                  {txCount} tx
                </strong>{" "}
                al publicar
                {profileDirty && (
                  <span className="text-xs"> · perfil/tema/badges</span>
                )}
                {linksDirty && (
                  <span className="text-xs">
                    {" "}
                    · links sync {linksToKeep.length + linksToAdd.length} / −
                    {linksToRemove.length}
                  </span>
                )}
              </>
            ) : (
              "Sin cambios pendientes"
            )}
          </p>
          <Button
            disabled={busy || !dirty}
            onClick={() => void publishAll()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Publicar todo
            {dirty && !busy ? ` (${txCount})` : ""}
          </Button>
        </div>
      </div>
      <div className="h-20" aria-hidden />
    </div>
  );
}
