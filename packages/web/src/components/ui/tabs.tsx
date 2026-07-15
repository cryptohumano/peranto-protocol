import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn("inline-flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-mist)]/70 p-1", className)}
    {...props}
  />
);
export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold text-[var(--color-ink)]/60 data-[state=active]:bg-[var(--color-paper)] data-[state=active]:text-[var(--color-moss-deep)]",
      className
    )}
    {...props}
  />
);
export const TabsContent = TabsPrimitive.Content;
