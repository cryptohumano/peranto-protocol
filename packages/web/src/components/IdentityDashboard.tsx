import { Link } from "react-router-dom";
import {
  Fingerprint,
  Users,
  Wallet,
  Landmark,
  ShieldCheck,
  FileKey2,
  Globe,
  AtSign,
  Crown,
  UserRound,
  ArrowRight,
  ArrowLeftRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shortAddr } from "@/lib/utils";
import { formatPas } from "@/lib/format";
import type { DidService, VaultCredential } from "@peranto/sdk";
import { peekJwtClaims } from "@peranto/sdk";
import type { Address, Hex } from "viem";

export type Belonging = {
  name: string;
  address: Address;
  balanceWei: bigint;
  role: "governance" | "member";
};

type Props = {
  displayName?: string;
  did: string;
  address: Address;
  source: string;
  walletWei: bigint | null;
  belongings: Belonging[];
  creds: VaultCredential[];
  anchors: Array<{ credHash: Hex; attester: Address }>;
  services: DidService[];
  attesterOk: boolean | null;
  onOpenTools?: (tab: string) => void;
};

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-moss)]/15 bg-[var(--color-paper)]/80 px-4 py-4">
      <div className="absolute -right-4 -top-4 size-20 rounded-full bg-[var(--color-moss)]/5" />
      <div className="flex items-center gap-2 text-[var(--color-moss)]">
        <Icon className="size-4" strokeWidth={1.75} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink)]/55">
          {label}
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--color-moss-deep)]">
        {value}
      </p>
      <p className="mt-1 text-xs leading-snug text-[var(--color-ink)]/55">{hint}</p>
    </div>
  );
}

export function IdentityDashboard({
  displayName,
  did,
  address,
  source,
  walletWei,
  belongings,
  creds,
  anchors,
  services,
  attesterOk,
  onOpenTools,
}: Props) {
  const gov = belongings.filter((b) => b.role === "governance");
  const mem = belongings.filter((b) => b.role === "member");
  const managedWei = gov.reduce((a, b) => a + b.balanceWei, 0n);

  return (
    <div className="space-y-8">
      {/* Identity masthead — one composition */}
      <section className="relative overflow-hidden rounded-[1.75rem] border border-[var(--color-moss)]/20 bg-gradient-to-br from-[#e8f0ea] via-[var(--color-paper)] to-[#e4dcc8] px-6 py-8 sm:px-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 20%, rgba(26,95,74,0.18), transparent 42%), radial-gradient(circle at 88% 70%, rgba(196,163,90,0.22), transparent 38%)",
          }}
        />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-moss)]">
            Tu identidad Peranto
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-[var(--color-moss-deep)] sm:text-5xl">
            {displayName ? `@${displayName}` : "Sin nombre aún"}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-ink)]/70">
            {displayName
              ? "Este es tu alias público. Debajo, lo que tienes registrado, dónde perteneces y qué puedes acreditar."
              : "Tu DID ya existe (implícito). Registra un nombre legible para que otras personas te reconozcan."}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Badge className="gap-1 bg-[var(--color-moss)]/10 text-[var(--color-moss-deep)]">
              <Fingerprint className="size-3" />
              {shortAddr(address, 6)}
            </Badge>
            <Badge variant="outline" className="gap-1">
              {source === "aura" ? "Aura Wallet" : "Sesión local"}
            </Badge>
            {attesterOk === true && (
              <Badge className="gap-1 bg-[var(--color-clay)]/25 text-[var(--color-moss-deep)]">
                <ShieldCheck className="size-3" />
                Attester activo
              </Badge>
            )}
            {attesterOk === false && (
              <Badge variant="outline" className="text-[var(--color-ink)]/50">
                Sin attester
              </Badge>
            )}
          </div>
          <p className="mt-4 break-all font-mono text-[10px] text-[var(--color-ink)]/40">{did}</p>
          {!displayName && (
            <Button
              className="mt-5"
              size="sm"
              onClick={() => onOpenTools?.("name")}
            >
              Registrar nombre
              <ArrowRight className="size-3.5" />
            </Button>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/activity"
              className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
            >
              <ArrowLeftRight className="size-3.5" />
              Ver transacciones
            </Link>
          </div>
        </div>
      </section>

      {/* What you have */}
      <section>
        <h2 className="font-display text-xl font-semibold text-[var(--color-moss-deep)]">
          Con lo que cuentas
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink)]/60">
          Resumen de activos, pertenencias y prueba de identidad — no hace falta
          leer hashes para orientarte.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={Wallet}
            label="Wallet"
            value={walletWei === null ? "…" : `${formatPas(walletWei)}`}
            hint="PAS en tu address (gasto libre)"
          />
          <Metric
            icon={Landmark}
            label="Tesoros que gobiernas"
            value={`${formatPas(managedWei)}`}
            hint={
              gov.length === 0
                ? "Ningún nodo bajo tu gobernanza"
                : `${gov.length} nodo${gov.length === 1 ? "" : "s"} · saldo a cargo`
            }
          />
          <Metric
            icon={FileKey2}
            label="Credenciales"
            value={String(creds.length)}
            hint={
              anchors.length
                ? `${anchors.length} ancla${anchors.length === 1 ? "" : "s"} on-chain`
                : "JWT en vault local / Aura"
            }
          />
          <Metric
            icon={Users}
            label="Pertenencias"
            value={String(belongings.length)}
            hint={
              belongings.length === 0
                ? "Aún no eres miembro de ningún nodo"
                : `${gov.length} gov · ${mem.length} miembro`
            }
          />
        </div>
      </section>

      {/* Belonging map */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--color-moss-deep)]">
              Dónde perteneces
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink)]/60">
              Nodos DisCO en los que eres gobernanza o miembro.
            </p>
          </div>
          <Link
            to="/coop"
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
          >
            Ir a Cooperativa
          </Link>
        </div>

        {belongings.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--color-moss)]/25 px-5 py-8 text-center">
            <Users className="mx-auto size-8 text-[var(--color-moss)]/40" />
            <p className="mt-3 text-sm text-[var(--color-ink)]/65">
              Todavía no figuras en ningún nodo. Crea uno o pide que te añadan
              como miembro.
            </p>
            <Link
              to="/coop"
              className={cn(buttonVariants({ size: "sm" }), "mt-4 inline-flex")}
            >
              Explorar nodos
            </Link>
          </div>
        ) : (
          <div className="mt-5">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:w-36">
                <div className="flex size-16 items-center justify-center rounded-full bg-[var(--color-moss)] text-[var(--color-paper)] shadow-[0_8px_24px_rgba(15,61,48,0.18)]">
                  <AtSign className="size-7" strokeWidth={1.5} />
                </div>
                <p className="text-center text-sm font-semibold text-[var(--color-moss-deep)]">
                  {displayName ? `@${displayName}` : "Tú"}
                </p>
              </div>

              <div className="hidden h-px flex-1 bg-gradient-to-r from-[var(--color-moss)]/40 to-transparent sm:block" />
              <div className="mx-auto h-8 w-px bg-gradient-to-b from-[var(--color-moss)]/40 to-transparent sm:hidden" />

              <ul className="grid flex-1 gap-3 sm:grid-cols-2">
                {belongings.map((b) => (
                  <li
                    key={b.address}
                    className="rounded-2xl border border-[var(--color-moss)]/15 bg-white/50 px-4 py-3 backdrop-blur-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-lg font-semibold text-[var(--color-moss-deep)]">
                          {b.name}
                        </p>
                        <p className="font-mono text-[10px] text-[var(--color-ink)]/45">
                          {shortAddr(b.address)}
                        </p>
                      </div>
                      <Badge
                        className={
                          b.role === "governance"
                            ? "gap-1 bg-[var(--color-clay)]/30 text-[var(--color-moss-deep)]"
                            : "gap-1"
                        }
                        variant={b.role === "governance" ? "default" : "outline"}
                      >
                        {b.role === "governance" ? (
                          <Crown className="size-3" />
                        ) : (
                          <UserRound className="size-3" />
                        )}
                        {b.role === "governance" ? "Gobiernas" : "Miembro"}
                      </Badge>
                    </div>
                    {b.role === "governance" && (
                      <p className="mt-2 text-xs text-[var(--color-ink)]/60">
                        Tesoro del nodo:{" "}
                        <span className="font-mono font-semibold tabular-nums">
                          {formatPas(b.balanceWei)} PAS
                        </span>
                      </p>
                    )}
                    {b.role === "member" && (
                      <p className="mt-2 text-xs text-[var(--color-ink)]/60">
                        Formas parte de esta cooperativa on-chain.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* Credentials + services strip */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-xl font-semibold text-[var(--color-moss-deep)]">
            Credenciales a tu nombre
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink)]/60">
            Pruebas emitidas donde tú eres el sujeto (vault + anclas).
          </p>
          {creds.length === 0 && anchors.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[var(--color-moss)]/20 px-4 py-6 text-sm text-[var(--color-ink)]/55">
              Aún no hay credenciales.{" "}
              <Link to="/credentials" className="font-medium text-[var(--color-moss)] underline-offset-2 hover:underline">
                Solicita o emite
              </Link>{" "}
              en el DisCO activo.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {creds.slice(0, 6).map((c) => {
                const peek = peekJwtClaims(c.jwt);
                const preview = peek.ok
                  ? Object.entries(peek.claims)
                      .slice(0, 2)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")
                  : null;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-moss)]/12 bg-[var(--color-mist)]/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--color-moss-deep)]">
                        {c.label ?? schemaShort(c.schemaKey)}
                      </p>
                      <p className="truncate text-[11px] text-[var(--color-ink)]/50">
                        {preview || schemaShort(c.schemaKey)}
                      </p>
                    </div>
                    <FileKey2 className="size-4 shrink-0 text-[var(--color-moss)]/50" />
                  </li>
                );
              })}
              {creds.length > 6 && (
                <p className="text-xs text-[var(--color-ink)]/50">
                  +{creds.length - 6} más en el vault
                </p>
              )}
              {anchors.length > 0 && (
                <p className="pt-1 text-xs text-[var(--color-ink)]/50">
                  {anchors.length} ancla{anchors.length === 1 ? "" : "s"} visible
                  {anchors.length === 1 ? "" : "s"} on-chain
                </p>
              )}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenTools?.("vault")}
            >
              Ver vault
            </Button>
            <Link
              to="/credentials"
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Credenciales
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-[var(--color-moss-deep)]">
            Servicios del DID
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink)]/60">
            Endpoints públicos publicados en tu documento (resolve).
          </p>
          {services.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[var(--color-moss)]/20 px-4 py-6 text-sm text-[var(--color-ink)]/55">
              Ningún servicio aún. Puedes publicar un dominio, inbox u otro endpoint
              desde DID.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {services.map((s) => (
                <li
                  key={s.attrKey ?? s.id}
                  className="rounded-xl border border-[var(--color-moss)]/12 bg-[var(--color-mist)]/40 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="size-4 text-[var(--color-moss)]" />
                    <span className="text-sm font-semibold text-[var(--color-moss-deep)]">
                      {s.type}
                      {s.attrKey?.includes(".") ? (
                        <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                          .{s.attrKey.split(".").slice(1).join(".")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-ink)]/50">
                    {typeof s.serviceEndpoint === "string"
                      ? s.serviceEndpoint
                      : JSON.stringify(s.serviceEndpoint)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            onClick={() => onOpenTools?.("did")}
          >
            Gestionar servicios
          </Button>
        </section>
      </div>
    </div>
  );
}

function schemaShort(key: string) {
  const parts = key.split(":");
  return parts.length >= 2 ? parts.slice(1).join(":") : key;
}
