import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  IdCard,
  Users,
  BadgeCheck,
  Wallet,
  Dumbbell,
  PartyPopper,
  Briefcase,
  FlaskConical,
  Fingerprint,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function Collapsible({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-moss)]/15 bg-[var(--color-mist)]/25">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-moss)]/12 text-[var(--color-moss-deep)]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-semibold text-[var(--color-moss-deep)]">
            {title}
          </span>
          {subtitle && (
            <span className="mt-0.5 block text-sm text-[var(--color-ink)]/60">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-[var(--color-moss)] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-[var(--color-moss)]/10 px-4 py-4 text-sm leading-relaxed text-[var(--color-ink)]/80">
          {children}
        </div>
      )}
    </section>
  );
}

function AnalogyCard({
  icon,
  title,
  real,
  peranto,
}: {
  icon: ReactNode;
  title: string;
  real: string;
  peranto: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-moss)]/12 bg-[var(--color-paper)]/80 p-4">
      <div className="flex items-center gap-2 text-[var(--color-moss-deep)]">
        {icon}
        <h3 className="font-display text-base font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-xs uppercase tracking-wide text-[var(--color-clay)]">
        En la vida real
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink)]/75">{real}</p>
      <p className="mt-3 text-xs uppercase tracking-wide text-[var(--color-moss)]">
        En Peranto
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink)]/75">{peranto}</p>
    </div>
  );
}

export function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <Badge variant="secondary" className="mb-2">
          Guía visual
        </Badge>
        <h1 className="font-display text-3xl font-bold text-[var(--color-moss-deep)]">
          ¿Qué es todo esto?
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink)]/70">
          DisCOs, DIDs y credenciales verificables con analogías del mundo
          físico: INE, cartera, membresías, empleado.
        </p>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <AnalogyCard
          icon={<IdCard className="size-4" />}
          title="INE / pasaporte"
          real="Un documento emitido por una autoridad que prueba quién eres. Tú lo guardas; un tercero lo verifica."
          peranto="Tu DID + una VC Member: el DisCO te atesta y tú presentas el JWT cuando hace falta."
        />
        <AnalogyCard
          icon={<Wallet className="size-4" />}
          title="Cartera / vault"
          real="Guardas tarjetas, IDs y pases. No están públicos en la calle; los sacas al pagar o identificarte."
          peranto="El vault (Aura o portal) guarda JWT. On-chain solo hay un ancla (hash), no tus datos."
        />
        <AnalogyCard
          icon={<Dumbbell className="size-4" />}
          title="Membresía de gimnasio"
          real="El gimnasio te da un pase. Sin él no entras. Si dejas de pagar, revocan el acceso."
          peranto="Schema Member + ancla Active/Revoked. El attester emite; revoke invalida el ancla."
        />
        <AnalogyCard
          icon={<PartyPopper className="size-4" />}
          title="Credencial de partido / club"
          real="Prueba afiliación a un colectivo. Sirve para votar, acceder o representar al grupo."
          peranto="Membresía DisCO + tip/care on-chain. La VC es evidencia portable hacia otros nodos."
        />
        <AnalogyCard
          icon={<Briefcase className="size-4" />}
          title="Credencial de empleado"
          real="RH emite un gafete con rol y fechas. Otros departamentos confían en RH, no rehacen el expediente."
          peranto="Attester autorizado (stakeAndJoin) firma. Un verificador mira ancla + JWT mínimo."
        />
        <AnalogyCard
          icon={<FlaskConical className="size-4" />}
          title="Resultado de laboratorio"
          real="El lab firma un informe. Tú lo llevas al médico o al municipio sin reenviar la base de datos del lab."
          peranto="VC EcoTestResult: claims en JWT; on-chain solo el hash. Evidencia livelihood portable."
        />
      </div>

      <div className="space-y-3">
        <Collapsible
          title="DisCO — cooperativa en red"
          subtitle="Como tu cooperativa o lab, pero con tesoro y membresía en ledger"
          icon={<Users className="size-4" />}
          defaultOpen
        >
          <p>
            Una <strong>DisCO</strong> (Distributed Cooperative) es un nodo:
            miembros, tips, contribute, gobernanza y un catálogo de credenciales
            que ese colectivo puede emitir (Member, EcoTest, Care…).
          </p>
          <p>
            En el portal eliges un <strong>DisCO activo</strong>: tip, solicitudes
            y emisiones se entienden en ese contexto — como elegir el gimnasio o
            el lab al que estás pidiendo la credencial.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[var(--color-ink)]/70">
            <li>Público: quién es miembro, flujos de valor (accountability).</li>
            <li>Privado: detalle personal vive en la VC / vault, no en el contrato.</li>
          </ul>
        </Collapsible>

        <Collapsible
          title="DID — tu identificador"
          subtitle="Como el número de INE, pero controlado por tu llave"
          icon={<Fingerprint className="size-4" />}
        >
          <p>
            Un <strong>DID</strong> (<code className="text-[10px]">did:peranto:…</code>)
            es tu identificador descentralizado. La address de firma lo controla;
            el @nombre es un alias opcional (como un apodo registrado).
          </p>
          <p>
            Puedes publicar <strong>servicios</strong> (sitio, inbox) en el
            documento DID — equivalentes a “dónde contactarme”, no a tus datos
            sensibles.
          </p>
        </Collapsible>

        <Collapsible
          title="Credencial verificable (VC)"
          subtitle="El documento firmado: de membresía a resultado de lab"
          icon={<BadgeCheck className="size-4" />}
        >
          <p>
            Una <strong>VC</strong> es un JWT firmado por un attester según un{" "}
            <strong>schema</strong> (plantilla de campos y tipos). Tú eres el{" "}
            <em>subject</em>; el attester es el emisor (como INE o RH).
          </p>
          <div className="rounded-xl bg-[var(--color-moss)]/8 px-3 py-3 text-xs">
            <p className="font-semibold text-[var(--color-moss-deep)]">
              Tres piezas
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>
                <strong>Schema</strong> — la plantilla (campos + tipos) en el
                registry.
              </li>
              <li>
                <strong>JWT</strong> — los valores (tu nombre, resultado…), en tu
                vault.
              </li>
              <li>
                <strong>Ancla</strong> — hash on-chain Active/Revoked, sin PII.
              </li>
            </ol>
          </div>
          <p>
            Por eso al <strong>emitir Member</strong> (u otro schema ya
            registrado) no puedes cambiar la lista de campos: están fijados en el
            registry. Solo rellenas valores. Al <strong>crear un schema nuevo</strong>{" "}
            sí eliges nombres y tipos (string, integer, boolean, date-time…).
          </p>
        </Collapsible>
      </div>
    </div>
  );
}
