import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Copy, MoreHorizontal } from "lucide-react";
import type { ActivityTx, ActivityTxType } from "@peranto/sdk";
import { ACTIVITY_TX_LABELS } from "@peranto/sdk";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, shortAddr } from "@/lib/utils";
import { formatPas } from "@/lib/format";

const TYPE_TONE: Partial<Record<ActivityTxType, string>> = {
  "name.register": "bg-[var(--color-moss)]/12 text-[var(--color-moss-deep)]",
  "name.release": "bg-muted text-muted-foreground",
  "vc.anchor": "bg-[var(--color-clay)]/25 text-[var(--color-moss-deep)]",
  "vc.revoke": "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  "disco.create": "bg-[var(--color-moss)]/15 text-[var(--color-moss-deep)]",
  "disco.tip": "bg-[var(--color-mist)] text-[var(--color-moss-deep)]",
  "disco.contribute": "bg-[var(--color-mist)] text-[var(--color-moss-deep)]",
  "disco.member.join": "bg-[var(--color-moss)]/10 text-[var(--color-moss)]",
  "disco.member.leave": "bg-muted text-muted-foreground",
  "disco.dissolve": "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  "disco.harvest": "bg-[var(--color-clay)]/20 text-[var(--color-moss-deep)]",
};

const ROLE_HINT: Record<string, string> = {
  from: "enviaste",
  to: "recibiste",
  subject: "sujeto",
  attester: "attester",
  owner: "dueño",
  creator: "creador",
  governance: "gobernanza",
};

export const activityColumns: ColumnDef<ActivityTx>[] = [
  {
    accessorKey: "type",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Tipo
        <ArrowUpDown className="size-3.5 opacity-60" />
      </Button>
    ),
    cell: ({ row }) => {
      const type = row.original.type;
      return (
        <Badge
          className={cn(
            "font-medium",
            TYPE_TONE[type] ?? "bg-muted text-muted-foreground"
          )}
          variant="outline"
        >
          {ACTIVITY_TX_LABELS[type] ?? type}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      if (!value || value === "all") return true;
      return row.getValue(id) === value;
    },
  },
  {
    accessorKey: "detail",
    header: "Detalle",
    cell: ({ row }) => {
      const { detail, role, node } = row.original;
      return (
        <div className="min-w-[10rem] max-w-[16rem]">
          <p className="truncate text-sm font-medium text-[var(--color-moss-deep)]">
            {detail || "—"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {role ? ROLE_HINT[role] ?? role : ""}
            {node ? ` · ${shortAddr(node)}` : ""}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "valueWei",
    header: () => <div className="text-right">Valor</div>,
    cell: ({ row }) => {
      const v = row.original.valueWei;
      if (v === undefined) {
        return <div className="text-right text-muted-foreground">—</div>;
      }
      return (
        <div className="text-right font-mono text-sm tabular-nums">
          {formatPas(v)} PAS
        </div>
      );
    },
  },
  {
    accessorKey: "counterpart",
    header: "Contraparte",
    cell: ({ row }) => {
      const c = row.original.counterpart;
      return (
        <span className="font-mono text-xs text-muted-foreground">
          {c ? shortAddr(c) : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "blockNumber",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Bloque
        <ArrowUpDown className="size-3.5 opacity-60" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.blockNumber.toString()}
      </span>
    ),
  },
  {
    accessorKey: "txHash",
    header: "Tx",
    cell: ({ row }) => (
      <span className="font-mono text-[11px] text-muted-foreground">
        {shortAddr(row.original.txHash, 5)}
      </span>
    ),
  },
  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const tx = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "size-8"
            )}
          >
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => void navigator.clipboard.writeText(tx.txHash)}
            >
              <Copy className="size-3.5" />
              Copiar hash
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void navigator.clipboard.writeText(tx.id)}
            >
              Copiar id fila
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              Tipo: {tx.type}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
