import type { Address } from "viem";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { loadPaseoDeployment, type DeploymentJson } from "./deployment";

export type PaymentTokenMeta = {
  address: Address;
  symbol: string;
  decimals: number;
  native: boolean;
};

export const NATIVE_PAYMENT: PaymentTokenMeta = {
  address: zeroAddress,
  symbol: "PAS",
  decimals: 18,
  native: true,
};

export function paymentTokensFromDeployment(
  d: DeploymentJson
): PaymentTokenMeta[] {
  if (d.paymentTokens?.length) {
    return d.paymentTokens.map((t) => ({
      address: t.address as Address,
      symbol: t.symbol,
      decimals: t.decimals,
      native: t.native || t.address === zeroAddress,
    }));
  }
  return [NATIVE_PAYMENT];
}

export async function loadPaymentTokens(): Promise<PaymentTokenMeta[]> {
  const d = await loadPaseoDeployment();
  return paymentTokensFromDeployment(d);
}

export function parsePaymentAmount(
  amount: string,
  token: PaymentTokenMeta
): bigint {
  const t = amount.trim();
  if (!t) throw new Error("Monto vacío");
  if (t.includes(".")) return parseUnits(t, token.decimals);
  // bare integer: treat as whole units if small, else raw wei-like
  return parseUnits(t, token.decimals);
}

export function formatPaymentAmount(
  amount: bigint,
  token: PaymentTokenMeta,
  maxFrac = 4
): string {
  const s = formatUnits(amount, token.decimals);
  const [i, f = ""] = s.split(".");
  if (!f || maxFrac === 0) return i;
  return `${i}.${f.slice(0, maxFrac).replace(/0+$/, "")}`.replace(/\.$/, "");
}

export function isNativeToken(token: Address | string): boolean {
  return token.toLowerCase() === zeroAddress;
}
