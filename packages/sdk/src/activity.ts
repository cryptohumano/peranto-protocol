import type { Address, Hex } from "viem";

/** Canonical activity types for the user transaction table. */
export type ActivityTxType =
  | "name.register"
  | "name.release"
  | "vc.anchor"
  | "vc.revoke"
  | "disco.create"
  | "disco.tip"
  | "disco.contribute"
  | "disco.member.join"
  | "disco.member.leave"
  | "disco.dissolve"
  | "disco.harvest";

export const ACTIVITY_TX_LABELS: Record<ActivityTxType, string> = {
  "name.register": "Nombre registrado",
  "name.release": "Nombre liberado",
  "vc.anchor": "Credencial anclada",
  "vc.revoke": "Credencial revocada",
  "disco.create": "Nodo creado",
  "disco.tip": "Tip",
  "disco.contribute": "Contribute",
  "disco.member.join": "Alta de miembro",
  "disco.member.leave": "Baja de miembro",
  "disco.dissolve": "Nodo disuelto",
  "disco.harvest": "Harvest",
};

export type ActivityTx = {
  id: string;
  type: ActivityTxType;
  label: string;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  /** Counterparty address when relevant (tip to/from, member, etc.). */
  counterpart?: Address;
  /** PAS amount when the event carries value. */
  valueWei?: bigint;
  /** Human detail (label name, node name, reason, short hash). */
  detail?: string;
  node?: Address;
  role?: "from" | "to" | "subject" | "attester" | "owner" | "creator" | "governance";
};

export function activityTypeOptions(): Array<{ value: ActivityTxType; label: string }> {
  return (Object.keys(ACTIVITY_TX_LABELS) as ActivityTxType[]).map((value) => ({
    value,
    label: ACTIVITY_TX_LABELS[value],
  }));
}
