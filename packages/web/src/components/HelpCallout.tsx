import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact inline hint under a field or operation. */
export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("mt-1 text-[11px] leading-snug text-[var(--color-ink)]/55", className)}>
      {children}
    </p>
  );
}

/** Section explainer with icon. */
export function HelpCallout({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "rounded-2xl border border-[var(--color-moss)]/15 bg-[var(--color-mist)]/35 px-4 py-3",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-[var(--color-moss)]" strokeWidth={1.75} />
        <div>
          <p className="text-sm font-semibold text-[var(--color-moss-deep)]">{title}</p>
          <div className="mt-1 space-y-1.5 text-xs leading-relaxed text-[var(--color-ink)]/70">
            {children}
          </div>
        </div>
      </div>
    </aside>
  );
}
