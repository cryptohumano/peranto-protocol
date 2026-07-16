import { ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { iconForPublicLink } from "@/lib/link-icons";
import type { AddressBookLink } from "@/lib/address-book";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  handle?: string | null;
  shareUrl?: string;
  links: AddressBookLink[];
  /** Shown after saving from linktr33 */
  savedHint?: boolean;
};

/**
 * Sheet to pick a contact channel (Telegram, Mail, …) and open the native app / site.
 */
export function ContactLinksSheet({
  open,
  onOpenChange,
  label,
  handle,
  shareUrl,
  links,
  savedHint,
}: Props) {
  const who = handle
    ? handle.startsWith("@")
      ? handle
      : `@${handle}`
    : label;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Contactar con {who}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-8">
          {savedHint && (
            <p className="mb-4 rounded-xl border border-[var(--color-moss)]/25 bg-[var(--color-moss)]/8 px-3 py-2.5 text-sm text-[var(--color-moss-deep)]">
              Guardado en tu libreta. Elige un canal para abrirlo en tu app habitual
              (Telegram, correo, navegador…).
            </p>
          )}
          {!savedHint && (
            <p className="mb-4 text-sm text-muted-foreground">
              Canales publicados en su linktr33 — toca para abrir fuera de Peranto.
            </p>
          )}

          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin links de contacto guardados. Abre su página pública si tienes el
              enlace.
            </p>
          ) : (
            <ul className="space-y-2">
              {links.map((l) => {
                const Icon = iconForPublicLink({
                  attrKey: l.attrKey ?? l.type,
                  type: l.type,
                  label: l.label,
                  href: l.href,
                });
                return (
                  <li key={`${l.type}-${l.label}-${l.href}`}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-xl border border-[var(--color-moss)]/15",
                        "bg-[var(--color-mist)]/30 px-4 py-3.5 text-sm font-semibold",
                        "transition hover:border-[var(--color-moss)]/35 hover:bg-[var(--color-moss)]/8"
                      )}
                      onClick={() => onOpenChange(false)}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.06]">
                        <Icon className="size-4 opacity-80" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left">
                        {l.label}
                      </span>
                      <ExternalLink className="size-3.5 shrink-0 opacity-35 group-hover:opacity-70" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          {shareUrl && (
            <div className="mt-5 border-t border-[var(--color-moss)]/10 pt-4">
              <p className="text-xs text-muted-foreground">
                Página completa linktr33
              </p>
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "mt-2 w-full",
                })}
              >
                <ExternalLink className="size-3.5" />
                Ver {who}
              </a>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
