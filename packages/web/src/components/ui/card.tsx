import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-moss)]/15 bg-[var(--color-paper)]/80 p-5 shadow-[0_12px_40px_-24px_rgba(20,34,28,0.35)] backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-xl font-semibold tracking-tight", className)} {...props} />;
}

export function CardDesc({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-[var(--color-ink)]/70", className)} {...props} />;
}
