import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { BadgeCheck, ExternalLink, Loader2 } from "lucide-react";
import {
  getReadClient,
  portalResolveDid,
  portalResolveIdentityRef,
} from "@/lib/client";
import {
  buildPublicPageShareUrl,
  profileFromDocument,
  schemaShort,
  statusLabelFromCode,
  type PublicPageLink,
  type PublicPageProfile,
  type ResolvedPublicBadge,
} from "@/lib/public-page";
import {
  resolvePageLayoutId,
  resolvePageThemeId,
  themeTokens,
} from "@/lib/page-themes";
import { shortAddr, cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  PublicLoveInvite,
  PublicVertexStats,
} from "@/components/PublicTipPanel";

export function PublicProfilePage() {
  const { ref: refParam } = useParams<{ ref: string }>();
  const ref = decodeURIComponent(refParam ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [did, setDid] = useState("");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublicPageProfile>({});
  const [links, setLinks] = useState<PublicPageLink[]>([]);
  const [badges, setBadges] = useState<ResolvedPublicBadge[]>([]);

  useEffect(() => {
    if (!ref) {
      setErr("Falta @nombre, DID o address");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr("");
      try {
        const resolved = await portalResolveIdentityRef(ref);
        const doc = await portalResolveDid(resolved.did);
        if (cancelled) return;
        const { profile: p, links: L } = profileFromDocument(doc);
        setDid(resolved.did);
        setAddress(resolved.address);
        setHandle(
          resolved.kind === "name" && resolved.label ? resolved.label : null
        );
        setProfile(p);
        setLinks(L);

        const client = await getReadClient();
        const featured = p.badges ?? [];
        const resolvedBadges: ResolvedPublicBadge[] = await Promise.all(
          featured.map(async (b) => {
            try {
              const st = await client.getCredentialStatus(b.credHash);
              const subjectOk =
                st.subject.toLowerCase() === resolved.address.toLowerCase();
              return {
                ...b,
                status: subjectOk
                  ? statusLabelFromCode(st.st)
                  : ("None" as const),
              };
            } catch {
              return { ...b, status: "Unknown" as const };
            }
          })
        );
        if (!cancelled) {
          setBadges(
            resolvedBadges.filter(
              (b) => b.status === "Active" || b.status === "Revoked"
            )
          );
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ref]);

  const theme = themeTokens(resolvePageThemeId(profile.theme));
  const layout = resolvePageLayoutId(profile.layout);
  const accent = profile.accent || theme.accent;
  const title =
    profile.title?.trim() ||
    (handle
      ? `@${handle}`
      : did
        ? shortAddr(did.replace(/^did:peranto:[^:]+:/, ""), 6)
        : "Peranto");

  const shareHint = useMemo(
    () =>
      handle
        ? buildPublicPageShareUrl(`@${handle}`)
        : did
          ? buildPublicPageShareUrl(did)
          : "",
    [handle, did]
  );

  const align = layout === "rail" ? "text-left items-start" : "text-center items-center";
  const linkClass = cn(
    "group flex w-full items-center justify-between gap-3 px-4 py-3.5 font-semibold transition",
    layout === "classic" &&
      "rounded-2xl border shadow-lg shadow-black/15 hover:-translate-y-0.5",
    layout === "rail" &&
      "rounded-none border-b bg-transparent px-0 shadow-none hover:opacity-80",
    layout === "blocks" &&
      "rounded-sm border-0 shadow-none hover:brightness-95"
  );

  return (
    <div
      className="relative min-h-dvh overflow-hidden"
      style={
        {
          "--page-accent": accent,
          "--page-ink": theme.ink,
          "--page-brand": theme.brand,
          "--page-muted": theme.muted,
        } as CSSProperties
      }
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: theme.surface }}
      />
      {theme.patternOpacity > 0 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: theme.patternOpacity,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
      )}

      <div
        className={cn(
          "relative z-10 mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-12",
          layout === "rail" && "max-w-lg"
        )}
      >
        <p
          className={cn(
            "mb-8 font-display text-sm font-semibold tracking-[0.2em] uppercase",
            layout === "rail" ? "text-left" : "text-center"
          )}
          style={{ color: theme.brand }}
        >
          Peranto
        </p>

        {loading && (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3"
            style={{ color: theme.muted }}
          >
            <Loader2
              className="size-8 animate-spin"
              style={{ color: accent }}
            />
            <p className="text-sm">Resolviendo identidad…</p>
          </div>
        )}

        {!loading && err && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: theme.ink }}
            >
              No se pudo abrir
            </h1>
            <p className="text-sm" style={{ color: theme.muted }}>
              {err}
            </p>
            <Link
              to="/login"
              className={cn(buttonVariants({ variant: "secondary" }), "mt-2")}
            >
              Ir al portal
            </Link>
          </div>
        )}

        {!loading && !err && (
          <>
            <header
              className={cn(
                "mb-8 flex flex-col animate-[fadeIn_0.6s_ease-out]",
                align
              )}
            >
              <h1
                className={cn(
                  "font-display font-bold tracking-tight",
                  layout === "blocks" ? "text-5xl" : "text-4xl"
                )}
                style={{ color: theme.ink }}
              >
                {title}
              </h1>
              {handle && profile.title && (
                <p className="mt-1 text-sm" style={{ color: theme.brand }}>
                  @{handle}
                </p>
              )}
              {profile.bio && (
                <p
                  className={cn(
                    "mt-4 max-w-sm text-base leading-relaxed",
                    layout !== "rail" && "mx-auto"
                  )}
                  style={{ color: theme.muted }}
                >
                  {profile.bio}
                </p>
              )}
              {badges.length > 0 && (
                <div
                  className={cn(
                    "mt-5 flex flex-wrap gap-2",
                    layout === "rail" ? "justify-start" : "justify-center"
                  )}
                >
                  {badges.map((b) => (
                    <span
                      key={b.credHash}
                      title={`${b.schemaKey} · ${b.credHash}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                        b.status !== "Active" && "opacity-45 line-through"
                      )}
                      style={{
                        borderColor: theme.badgeBorder,
                        background: theme.badgeBg,
                        color: theme.ink,
                      }}
                    >
                      <BadgeCheck
                        className="size-3.5"
                        style={{ color: theme.brand }}
                      />
                      {b.label?.trim() || schemaShort(b.schemaKey)}
                      {b.status === "Revoked" && (
                        <span className="text-[10px] font-normal">
                          revocada
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {address && <PublicVertexStats profileAddress={address} />}
            </header>

            <ul
              className={cn(
                "flex flex-col",
                layout === "classic" && "mt-6 gap-3",
                layout === "rail" && "mt-4 gap-0",
                layout === "blocks" && "mt-6 gap-2"
              )}
            >
              {links.map((l, i) => (
                <li
                  key={l.attrKey}
                  className="animate-[slideUp_0.5s_ease-out_both]"
                  style={{ animationDelay: `${80 + i * 60}ms` }}
                >
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className={linkClass}
                    style={
                      layout === "rail"
                        ? {
                            color: theme.ink,
                            borderColor: "rgba(255,255,255,0.12)",
                          }
                        : {
                            background: theme.linkBg,
                            color: theme.linkInk,
                            borderColor: theme.linkBorder,
                          }
                    }
                  >
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        layout === "blocks" && "text-lg tracking-tight"
                      )}
                    >
                      {l.label}
                    </span>
                    <ExternalLink className="size-4 shrink-0 opacity-40 transition group-hover:opacity-80" />
                  </a>
                </li>
              ))}
              {links.length === 0 && (
                <li
                  className="rounded-2xl border border-dashed px-4 py-8 text-sm"
                  style={{
                    borderColor: "rgba(255,255,255,0.2)",
                    color: theme.muted,
                    textAlign: layout === "rail" ? "left" : "center",
                  }}
                >
                  Sin links públicos aún. El dueño puede publicarlos en{" "}
                  <strong style={{ color: theme.ink }}>linktr33</strong>.
                </li>
              )}
            </ul>

            {address && profile.showLoveInvite !== false && (
              <PublicLoveInvite
                profileAddress={address}
                handle={handle}
                pageRef={ref}
                preferredNode={profile.loveNode}
                defaultAmt={profile.loveDefaultAmt}
              />
            )}

            <footer
              className={cn(
                "mt-auto pt-12",
                layout === "rail" ? "text-left" : "text-center"
              )}
            >
              <p
                className="truncate font-mono text-[10px]"
                style={{ color: "color-mix(in srgb, var(--page-ink) 35%, transparent)" }}
              >
                {did}
              </p>
              {shareHint && (
                <p
                  className="mt-2 truncate text-[10px]"
                  style={{ color: "color-mix(in srgb, var(--page-ink) 25%, transparent)" }}
                >
                  {shareHint.replace(/^https?:\/\//, "")}
                </p>
              )}
              <Link
                to="/login"
                className="mt-4 inline-block text-xs underline-offset-2 hover:underline"
                style={{ color: theme.brand }}
              >
                Crea tu linktr33
              </Link>
            </footer>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
