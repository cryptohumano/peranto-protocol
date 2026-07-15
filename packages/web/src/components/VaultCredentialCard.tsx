import { useMemo, useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { peekJwtClaims, type VaultCredential } from "@peranto/sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function formatClaimValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return JSON.stringify(v);
}

type Props = {
  cred: VaultCredential;
  onVerify?: () => void;
  verifyBusy?: boolean;
  className?: string;
  defaultOpen?: boolean;
};

export function VaultCredentialCard({
  cred,
  onVerify,
  className,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const peeked = useMemo(() => peekJwtClaims(cred.jwt), [cred.jwt]);
  const claimEntries = Object.entries(peeked.claims);

  return (
    <li
      className={cn(
        "rounded-[var(--radius-sm)] border border-[var(--color-moss)]/15 p-3 text-sm",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="flex items-center gap-2">
            <span className="font-semibold text-[var(--color-moss-deep)]">
              {cred.label ?? peeked.schemaKey ?? cred.schemaKey}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-[var(--color-moss)]/60 transition-transform",
                open && "rotate-180"
              )}
            />
          </span>
          <p className="mt-0.5 truncate text-xs text-[var(--color-ink)]/55">
            {cred.schemaKey}
          </p>
        </button>
        {onVerify && (
          <Button size="sm" variant="ghost" onClick={onVerify}>
            Verificar
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-[var(--color-moss)]/10 pt-3">
          {!peeked.ok ? (
            <p className="text-xs text-[var(--color-danger)]">
              No se pudieron leer los claims: {peeked.error}
            </p>
          ) : claimEntries.length === 0 ? (
            <p className="text-xs text-[var(--color-ink)]/55">
              Sin campos en credentialSubject.
            </p>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              {claimEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg bg-[var(--color-moss)]/5 px-2.5 py-2"
                >
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-moss)]">
                    {key}
                  </dt>
                  <dd className="mt-0.5 break-all text-sm text-[var(--color-ink)]/85">
                    {formatClaimValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="flex flex-wrap gap-1.5">
            {peeked.types?.filter((t) => t !== "VerifiableCredential").map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>

          <p className="truncate font-mono text-[10px] text-[var(--color-ink)]/40">
            hash {cred.credHash}
          </p>
          {peeked.issuerDid && (
            <p className="truncate text-[10px] text-[var(--color-ink)]/45">
              issuer {peeked.issuerDid}
            </p>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(cred.jwt);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="size-3.5" />
            {copied ? "JWT copiado" : "Copiar JWT"}
          </Button>
        </div>
      )}
    </li>
  );
}
