import type { CSSProperties } from "react";
import { BadgeCheck, ExternalLink, Heart } from "lucide-react";
import type { PublicPageLink, PublicPageProfile } from "@/lib/public-page";
import { schemaShort } from "@/lib/public-page";
import {
  resolvePageLayoutId,
  resolvePageThemeId,
  themeTokens,
} from "@/lib/page-themes";
import { iconForPublicLink } from "@/lib/link-icons";
import { cn } from "@/lib/utils";

type PreviewBadge = {
  credHash: string;
  schemaKey: string;
  label?: string;
};

type Props = {
  profile: PublicPageProfile;
  links: PublicPageLink[];
  badges: PreviewBadge[];
  handle: string | null;
  titleFallback: string;
  className?: string;
  /** Compact phone-frame style */
  framed?: boolean;
  /** When true, caption says draft has unpublished changes */
  dirty?: boolean;
};

/** Local preview of the public linktr33 (no chain reads). */
export function Linktr33Preview({
  profile,
  links,
  badges,
  handle,
  titleFallback,
  className,
  framed = true,
  dirty = false,
}: Props) {
  const theme = themeTokens(resolvePageThemeId(profile.theme));
  const layout = resolvePageLayoutId(profile.layout);
  const accent = profile.accent || theme.accent;
  const title = profile.title?.trim() || titleFallback;
  const align =
    layout === "rail" ? "text-left items-start" : "text-center items-center";

  const inner = (
    <div
      className={cn(
        "relative overflow-hidden",
        framed ? "min-h-[420px]" : "min-h-full"
      )}
      style={
        {
          "--page-accent": accent,
        } as CSSProperties
      }
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: theme.surface }}
      />
      <div className="relative z-10 flex min-h-[420px] flex-col px-4 pb-6 pt-6">
        <p
          className={cn(
            "mb-5 font-display text-[10px] font-semibold tracking-[0.2em] uppercase",
            layout === "rail" ? "text-left" : "text-center"
          )}
          style={{ color: theme.brand }}
        >
          Peranto
        </p>
        <header className={cn("mb-5 flex flex-col", align)}>
          <h2
            className={cn(
              "font-display font-bold tracking-tight",
              layout === "blocks" ? "text-2xl" : "text-xl"
            )}
            style={{ color: theme.ink }}
          >
            {title}
          </h2>
          {handle && profile.title && (
            <p className="mt-0.5 text-xs" style={{ color: theme.brand }}>
              @{handle}
            </p>
          )}
          {profile.bio && (
            <p
              className={cn(
                "mt-2 max-w-[16rem] text-xs leading-relaxed",
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
                "mt-3 flex flex-wrap gap-1.5",
                layout === "rail" ? "justify-start" : "justify-center"
              )}
            >
              {badges.map((b) => (
                <span
                  key={b.credHash}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    borderColor: theme.badgeBorder,
                    background: theme.badgeBg,
                    color: theme.ink,
                  }}
                >
                  <BadgeCheck
                    className="size-2.5"
                    style={{ color: theme.brand }}
                  />
                  {b.label?.trim() || schemaShort(b.schemaKey)}
                </span>
              ))}
            </div>
          )}
        </header>

        <ul
          className={cn(
            "flex flex-col",
            layout === "classic" && "gap-2",
            layout === "rail" && "gap-0",
            layout === "blocks" && "gap-1.5"
          )}
        >
          {links.map((l) => {
            const Icon = iconForPublicLink(l);
            return (
              <li key={l.attrKey}>
                <div
                  className={cn(
                    "group flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-semibold",
                    layout === "classic" && "rounded-xl border shadow-md shadow-black/10",
                    layout === "rail" &&
                      "rounded-none border-b bg-transparent px-0 shadow-none",
                    layout === "blocks" && "rounded-sm border-0 shadow-none"
                  )}
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
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.06]">
                    <Icon className="size-3.5 opacity-80" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">
                    {l.label}
                  </span>
                  <ExternalLink className="size-3 shrink-0 opacity-35" />
                </div>
              </li>
            );
          })}
          {links.length === 0 && (
            <li
              className="rounded-xl border border-dashed px-3 py-6 text-center text-[11px]"
              style={{
                borderColor: "rgba(255,255,255,0.2)",
                color: theme.muted,
              }}
            >
              Sin links aún
            </li>
          )}
        </ul>

        {profile.showLoveInvite !== false && (
          <div className="mt-6 flex flex-col items-center text-center">
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: theme.brand }}
            >
              Apoyar con Love
            </p>
            <div
              className="mt-3 flex size-20 items-center justify-center rounded-xl"
              style={{ background: theme.linkBg }}
            >
              <Heart
                className="size-6"
                style={{ color: theme.linkInk, opacity: 0.35 }}
              />
            </div>
            <p className="mt-2 text-[10px]" style={{ color: theme.muted }}>
              QR · {profile.loveDefaultAmt || "0.01"} PAS
              {profile.loveNode
                ? ` · nodo ${profile.loveNode.slice(0, 6)}…`
                : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (!framed) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <div className={cn("mx-auto w-full max-w-[280px]", className)}>
      <div className="rounded-[1.75rem] border border-[var(--color-moss)]/20 bg-[var(--color-ink)]/5 p-2 shadow-inner">
        <div className="overflow-hidden rounded-[1.35rem]">{inner}</div>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground">
        {dirty
          ? "Vista previa · hay cambios sin publicar"
          : "Vista previa · al día con lo publicado"}
      </p>
    </div>
  );
}
