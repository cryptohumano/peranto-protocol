/**
 * Portable Peranto credential file (JSON) for backup / import outside Aura.
 * The authoritative credential remains the JWT; this wraps metadata for humans & tools.
 */
import { keccak256, toBytes, type Hex } from "viem";
import { peekJwtClaims, verifyEcoTestJwt } from "./vc";

export const PERANTO_CREDENTIAL_FORMAT = "peranto-credential" as const;
export const PERANTO_CREDENTIAL_VERSION = 1 as const;

export type PerantoCredentialFile = {
  format: typeof PERANTO_CREDENTIAL_FORMAT;
  version: typeof PERANTO_CREDENTIAL_VERSION;
  schemaKey: string;
  credHash: Hex;
  issuerDid: string;
  subjectDid: string;
  label: string;
  exportedAt: string;
  /** Compact JWT-VC (ES256K). This is what verification uses. */
  jwt: string;
};

export function buildCredentialFile(input: {
  jwt: string;
  label?: string;
  schemaKey?: string;
  credHash?: Hex;
  issuerDid?: string;
  subjectDid?: string;
}): PerantoCredentialFile {
  const jwt = input.jwt.trim();
  const peek = peekJwtClaims(jwt);
  const schemaKey =
    input.schemaKey ||
    peek.schemaKey ||
    peek.types?.find((t) => t.startsWith("peranto:")) ||
    "peranto:Unknown:v1";
  return {
    format: PERANTO_CREDENTIAL_FORMAT,
    version: PERANTO_CREDENTIAL_VERSION,
    schemaKey,
    credHash: input.credHash ?? (keccak256(toBytes(jwt)) as Hex),
    issuerDid: input.issuerDid || peek.issuerDid || "",
    subjectDid: input.subjectDid || peek.subjectDid || "",
    label:
      input.label ||
      schemaKey.replace(/^peranto:/, "").replace(/:v\d+$/, "") ||
      "Credential",
    exportedAt: new Date().toISOString(),
    jwt,
  };
}

/** Prefer async hash from verify when possible. */
export async function buildCredentialFileVerified(input: {
  jwt: string;
  label?: string;
  schemaKey?: string;
}): Promise<PerantoCredentialFile> {
  const verified = await verifyEcoTestJwt(input.jwt);
  if (!verified.valid) {
    // Still export metadata from peek for backup; mark via label note
    const base = buildCredentialFile(input);
    return base;
  }
  return buildCredentialFile({
    jwt: input.jwt,
    label: input.label,
    schemaKey: input.schemaKey,
    credHash: verified.credHash,
    issuerDid: verified.issuerDid,
    subjectDid: verified.subjectDid,
  });
}

export function credentialFileToJson(file: PerantoCredentialFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Accepts:
 * - PerantoCredentialFile JSON
 * - raw JWT string
 * - JSON with a top-level `jwt` field
 */
export function parseCredentialImport(raw: string): {
  jwt: string;
  label?: string;
  schemaKey?: string;
} {
  const text = raw.trim();
  if (!text) throw new Error("Vacío");

  if (text.startsWith("eyJ") && text.split(".").length >= 3) {
    return { jwt: text };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("No es JWT ni JSON válido");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON inválido");
  }
  const obj = parsed as Record<string, unknown>;
  const jwt = String(obj.jwt ?? "").trim();
  if (!jwt) throw new Error("JSON sin campo jwt");

  return {
    jwt,
    label: obj.label !== undefined ? String(obj.label) : undefined,
    schemaKey: obj.schemaKey !== undefined ? String(obj.schemaKey) : undefined,
  };
}

export function downloadCredentialJson(
  file: PerantoCredentialFile,
  filename?: string
): void {
  const name =
    filename ||
    `${file.label.replace(/[^\w.-]+/g, "-").toLowerCase() || "credential"}.peranto.json`;
  const blob = new Blob([credentialFileToJson(file)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
