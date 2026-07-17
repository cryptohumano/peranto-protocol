import { useEffect, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  schemaShort,
  type PublicPageBadge,
  type PublicPageProfile,
} from "@/lib/public-page";
import { shortAddr, cn } from "@/lib/utils";
import type { Address } from "viem";
import { formatEther, formatGwei } from "viem";

export type CheckoutLink = {
  /** Real on-chain key after `did/svc/` (may be bare `Website` or `Website.blog`). */
  attrKey: string;
  type: string;
  /** Button label on the public page (not the chain key). */
  label: string;
  href: string;
  /** True when attrKey has no `.id` — legacy single attr per type. */
  legacyBare?: boolean;
};

export type ProfileFieldDiff = {
  key: string;
  label: string;
  before: string;
  after: string;
};

export type TxPlanRow = {
  id: string;
  kind: "profile" | "add" | "remove";
  title: string;
  detail: string;
  /** Estimated gas units (if available). */
  gas?: bigint;
  /** Starting nonce for this tx in the batch (account nonce + index). */
  nonce?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  txCount: number;
  did: string;
  address: Address;
  baselineProfile: PublicPageProfile;
  draftProfile: PublicPageProfile;
  profileDiffs: ProfileFieldDiff[];
  beforeLinks: CheckoutLink[];
  afterLinks: CheckoutLink[];
  linksToAdd: CheckoutLink[];
  linksToRemove: CheckoutLink[];
  txPlan: TxPlanRow[];
  busy: boolean;
  progress?: string;
  onConfirm: () => void;
  /** Refresh gas/nonce estimates when sheet opens. */
  onEstimate?: () => Promise<{
    nextNonce: number;
    gasPriceWei?: bigint;
    rows: TxPlanRow[];
  } | null>;
};

function LinkCard({
  link,
  tone,
}: {
  link: CheckoutLink;
  tone?: "add" | "remove" | "keep";
}) {
  return (
    <li
      className={cn(
        "rounded-lg border px-2.5 py-2",
        tone === "add" &&
          "border-[var(--color-moss)]/35 bg-[var(--color-moss)]/8",
        tone === "remove" &&
          "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 opacity-80",
        tone === "keep" && "border-[var(--color-moss)]/12",
        !tone && "border-[var(--color-moss)]/12"
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1 text-sm font-semibold",
          tone === "remove" && "line-through"
        )}
      >
        {tone === "add" && (
          <Plus className="size-3.5 shrink-0 text-[var(--color-moss)]" />
        )}
        {tone === "remove" && (
          <Minus className="size-3.5 shrink-0 text-[var(--color-danger)]" />
        )}
        {link.label || link.attrKey}
      </p>
      <p className="truncate text-[11px] text-muted-foreground">{link.href}</p>
      <p className="truncate font-mono text-[10px] text-muted-foreground/80">
        {link.attrKey}
      </p>
    </li>
  );
}

function ProfileMini({ profile }: { profile: PublicPageProfile }) {
  const badges = profile.badges?.length
    ? profile.badges
        .map((b) => schemaShort(b.schemaKey) || b.credHash.slice(0, 10))
        .join(", ")
    : "—";
  return (
    <dl className="space-y-1.5 text-[11px]">
      <div>
        <dt className="text-muted-foreground">Título</dt>
        <dd className="font-medium">{profile.title?.trim() || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Bio</dt>
        <dd className="leading-snug">{profile.bio?.trim() || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Tema / layout</dt>
        <dd className="font-mono">
          {profile.theme ?? "moss"} · {profile.layout ?? "classic"}
          {profile.accent ? ` · ${profile.accent}` : ""}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Badges</dt>
        <dd>{badges}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Love</dt>
        <dd>
          {profile.showLoveInvite === false
            ? "oculto"
            : profile.loveNode
              ? `${shortAddr(profile.loveNode as Address)}${
                  profile.loveDefaultAmt
                    ? ` · ${profile.loveDefaultAmt}`
                    : ""
                }`
              : "activo"}
        </dd>
      </div>
    </dl>
  );
}

/** Review sheet: full before/after DID services + txs (gas/nonce). */
export function PublishCheckoutSheet({
  open,
  onOpenChange,
  txCount,
  did,
  address,
  baselineProfile,
  draftProfile,
  profileDiffs,
  beforeLinks,
  afterLinks,
  linksToAdd,
  linksToRemove,
  txPlan,
  busy,
  progress,
  onConfirm,
  onEstimate,
}: Props) {
  const [estimating, setEstimating] = useState(false);
  const [nextNonce, setNextNonce] = useState<number | null>(null);
  const [gasPriceWei, setGasPriceWei] = useState<bigint | null>(null);
  const [estimatedRows, setEstimatedRows] = useState<TxPlanRow[] | null>(null);

  useEffect(() => {
    if (!open || !onEstimate) {
      setEstimatedRows(null);
      setNextNonce(null);
      setGasPriceWei(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    void onEstimate()
      .then((r) => {
        if (cancelled || !r) return;
        setNextNonce(r.nextNonce);
        setGasPriceWei(r.gasPriceWei ?? null);
        setEstimatedRows(r.rows);
      })
      .catch(() => {
        if (!cancelled) setEstimatedRows(null);
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onEstimate, txCount, linksToAdd, linksToRemove, profileDiffs]);

  const removeKeys = new Set(
    linksToRemove.map((l) => l.attrKey.toLowerCase())
  );
  const addKeys = new Set(linksToAdd.map((l) => l.attrKey.toLowerCase()));
  const rows = estimatedRows ?? txPlan;

  const totalGas = rows.reduce(
    (acc, r) => (r.gas != null ? acc + r.gas : acc),
    0n
  );
  const totalCostWei =
    gasPriceWei != null && totalGas > 0n ? totalGas * gasPriceWei : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-[var(--color-moss)]/10 px-4 py-3">
          <SheetTitle>Revisar antes de publicar</SheetTitle>
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            {did}
          </p>
          <p className="text-xs text-muted-foreground">
            Izquierda = publicado ahora · derecha = tras firmar. Solo cambia el
            texto del botón y la URL; el resto lo gestiona la app.
          </p>
        </SheetHeader>

        <div
          className="overflow-y-auto px-4 py-4"
          style={{ maxHeight: "calc(92vh - 8.5rem)" }}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3 rounded-2xl border border-[var(--color-moss)]/12 bg-black/[0.02] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Publicado (antes)
              </h3>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold">Perfil</p>
                <ProfileMini profile={baselineProfile} />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold">
                  Links ({beforeLinks.length})
                </p>
                {beforeLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ninguno</p>
                ) : (
                  <ul className="space-y-1.5">
                    {beforeLinks.map((l) => (
                      <LinkCard
                        key={l.attrKey}
                        link={l}
                        tone={
                          removeKeys.has(l.attrKey.toLowerCase())
                            ? "remove"
                            : "keep"
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-[var(--color-moss)]/25 bg-[var(--color-moss)]/5 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-moss-deep)]">
                Borrador (después)
              </h3>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold">Perfil</p>
                <ProfileMini profile={draftProfile} />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold">
                  Links ({afterLinks.length})
                </p>
                {afterLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ninguno</p>
                ) : (
                  <ul className="space-y-1.5">
                    {afterLinks.map((l) => (
                      <LinkCard
                        key={l.attrKey}
                        link={l}
                        tone={
                          addKeys.has(l.attrKey.toLowerCase()) ? "add" : "keep"
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <section className="mt-5 space-y-3 border-t border-[var(--color-moss)]/10 pt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Plan de transacciones
              </h3>
              <p className="font-mono text-[10px] text-muted-foreground">
                cuenta {shortAddr(address)}
                {nextNonce != null ? ` · nonce base ${nextNonce}` : ""}
                {estimating ? " · estimando…" : ""}
              </p>
            </div>

            {profileDiffs.length > 0 && (
              <ul className="space-y-2 rounded-xl border border-[var(--color-moss)]/12 px-3 py-2 text-[11px]">
                {profileDiffs.map((d) => (
                  <li key={d.key} className="space-y-1">
                    <p className="font-semibold">{d.label}</p>
                    <p className="text-muted-foreground line-through break-all">
                      {d.before || "(vacío)"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">pasa a</p>
                    <p className="text-[var(--color-moss-deep)] break-all">
                      {d.after || "(vacío)"}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-[var(--color-moss)]/12 px-3 py-2 text-[11px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      {r.kind === "remove" ? (
                        <Minus className="mr-1 inline size-3.5 text-[var(--color-danger)]" />
                      ) : (
                        <Plus className="mr-1 inline size-3.5 text-[var(--color-moss)]" />
                      )}
                      {r.title}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {r.nonce != null ? `nonce ${r.nonce}` : ""}
                      {r.gas != null ? ` · ~${r.gas.toString()} gas` : ""}
                      {r.gas != null && gasPriceWei != null
                        ? ` · ~${formatEther(r.gas * gasPriceWei)} PAS`
                        : ""}
                    </p>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{r.detail}</p>
                </li>
              ))}
            </ul>

            {txCount === 0 && (
              <p className="text-sm text-muted-foreground">Sin txs pendientes.</p>
            )}

            {totalCostWei != null && (
              <p className="text-xs text-muted-foreground">
                Estimación total (aprox.):{" "}
                <strong className="text-[var(--color-moss-deep)]">
                  {formatEther(totalCostWei)} PAS
                </strong>
                {gasPriceWei != null && (
                  <span className="font-mono text-[10px]">
                    {" "}
                    · {formatGwei(gasPriceWei)} gwei
                  </span>
                )}
                . El gas real puede variar.
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-moss)]/10 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Seguir editando
          </Button>
          <Button
            type="button"
            disabled={busy || txCount === 0}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {busy ? progress || "Publicando…" : `Confirmar · ${txCount} tx`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function fmtBadges(badges?: PublicPageBadge[]): string {
  if (!badges?.length) return "";
  return badges
    .map((b) => schemaShort(b.schemaKey) || b.credHash.slice(0, 10))
    .join(", ");
}

function fmtLove(node?: string, amt?: string): string {
  if (!node) return amt ? `monto ${amt}` : "";
  return `${shortAddr(node as Address)}${amt ? ` · ${amt}` : ""}`;
}

export function buildProfileFieldDiffs(
  before: PublicPageProfile,
  after: PublicPageProfile
): ProfileFieldDiff[] {
  const rows: Array<{
    key: string;
    label: string;
    a: string;
    b: string;
  }> = [
    {
      key: "title",
      label: "Título",
      a: before.title?.trim() ?? "",
      b: after.title?.trim() ?? "",
    },
    {
      key: "bio",
      label: "Bio",
      a: before.bio?.trim() ?? "",
      b: after.bio?.trim() ?? "",
    },
    {
      key: "theme",
      label: "Tema",
      a: before.theme ?? "moss",
      b: after.theme ?? "moss",
    },
    {
      key: "layout",
      label: "Layout",
      a: before.layout ?? "classic",
      b: after.layout ?? "classic",
    },
    {
      key: "accent",
      label: "Acento",
      a: (before.accent ?? "").toLowerCase(),
      b: (after.accent ?? "").toLowerCase(),
    },
    {
      key: "love",
      label: "Love / tip",
      a:
        before.showLoveInvite === false
          ? "oculto"
          : fmtLove(before.loveNode, before.loveDefaultAmt) || "activo",
      b:
        after.showLoveInvite === false
          ? "oculto"
          : fmtLove(after.loveNode, after.loveDefaultAmt) || "activo",
    },
    {
      key: "badges",
      label: "Badges",
      a: fmtBadges(before.badges),
      b: fmtBadges(after.badges),
    },
    {
      key: "linkOrder",
      label: "Orden de links",
      a: (before.linkOrder ?? []).join(" → "),
      b: (after.linkOrder ?? []).join(" → "),
    },
  ];

  return rows
    .filter((r) => r.a !== r.b)
    .map((r) => ({
      key: r.key,
      label: r.label,
      before: r.a,
      after: r.b,
    }));
}

/** Checkout row — never invents Type.slot from a derived UI slot. */
export function toCheckoutLink(l: {
  attrKey?: string;
  type: string;
  slot?: string;
  label: string;
  href: string;
  pending?: string;
  legacyBare?: boolean;
}): CheckoutLink {
  const bare = Boolean(
    l.legacyBare || (l.attrKey && !l.attrKey.includes("."))
  );
  // Future on-chain key for new drafts; published bare keeps real attrKey.
  const attrKey =
    l.attrKey?.trim() ||
    (l.slot?.trim() ? `${l.type}.${l.slot.trim()}` : l.type);
  return {
    attrKey,
    type: l.type,
    label: l.label,
    href: l.href,
    legacyBare: bare && !attrKey.includes("."),
  };
}
