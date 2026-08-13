/** Rules mirrored from NameRegistry._validateAndHash (contracts/NameRegistry.sol). */
export const NAME_LABEL_MIN = 3;
export const NAME_LABEL_MAX = 32;
const LABEL_RE = /^[a-z0-9-]+$/;

/** Strip @, lowercase, trim — what we store before on-chain register. */
export function normalizeNameLabel(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Returns a Spanish error message, or `null` if the label is registerable.
 * Call with an already-normalized label (or pass raw — we normalize again).
 */
export function nameLabelError(raw: string): string | null {
  const label = normalizeNameLabel(raw);
  if (!label) return "Escribe un nombre.";
  if (label.length < NAME_LABEL_MIN) {
    return `Mínimo ${NAME_LABEL_MIN} caracteres.`;
  }
  if (label.length > NAME_LABEL_MAX) {
    return `Máximo ${NAME_LABEL_MAX} caracteres.`;
  }
  if (!LABEL_RE.test(label)) {
    return "Solo minúsculas a-z, dígitos 0-9 y guion (-).";
  }
  if (label.startsWith("-") || label.endsWith("-")) {
    return "No puede empezar ni terminar con guion.";
  }
  return null;
}

export function isValidNameLabel(raw: string): boolean {
  return nameLabelError(raw) === null;
}
