import { formatEther } from "viem";

/** Format PAS for UI (avoid scientific notation for tiny amounts). */
export function formatPas(wei: bigint, digits = 4): string {
  const n = Number(formatEther(wei));
  if (wei === 0n) return "0";
  if (n > 0 && n < 10 ** -digits) return formatEther(wei);
  return n.toLocaleString("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
