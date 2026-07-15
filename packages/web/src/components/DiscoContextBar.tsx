import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn, shortAddr } from "@/lib/utils";
import type { ActiveDisco } from "@/lib/disco";
import { PASEO_CHAIN_ID } from "@/lib/deployment";

/** Banner: leaves no doubt which DisCO + chain ops run against. */
export function DiscoContextBar({
  disco,
  className,
}: {
  disco: ActiveDisco | null;
  className?: string;
}) {
  const networkBadge = (
    <Badge variant="secondary" className="text-[10px]">
      Paseo Hub · {PASEO_CHAIN_ID}
    </Badge>
  );

  if (!disco) {
    return (
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-[var(--color-moss)]/30 bg-[var(--color-mist)]/30 px-4 py-3",
          className
        )}
      >
        <div className="space-y-1">
          <p className="text-sm text-[var(--color-ink)]/70">
            Ningún DisCO seleccionado. Elige uno para emitir o solicitar en su
            contexto.
          </p>
          {networkBadge}
        </div>
        <Link
          to="/coop"
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
        >
          Explorar nodos
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-moss)]/20 bg-[var(--color-moss)]/8 px-4 py-3",
        className
      )}
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-moss)]">
          Desplegando en DisCO
        </p>
        <p className="font-display text-lg font-semibold text-[var(--color-moss-deep)]">
          {disco.name}
        </p>
        <p className="font-mono text-[10px] text-[var(--color-ink)]/45">
          {disco.address}
        </p>
        <div className="mt-2">{networkBadge}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {disco.offerSchemas.slice(0, 3).map((s) => (
          <Badge key={s} variant="outline" className="text-[10px]">
            {s.replace(/^peranto:/, "")}
          </Badge>
        ))}
        <Link
          to="/coop"
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
        >
          Cambiar
        </Link>
      </div>
    </div>
  );
}
