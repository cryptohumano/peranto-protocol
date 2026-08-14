/**
 * Canonical schema keys and claim shapes for Peranto VCs.
 * On-chain registration uses keccak256(schemaKey) as schemaId.
 */

export const SCHEMA_KEYS = {
  EcoTestResult: "peranto:EcoTestResult:v1",
  TipReceipt: "peranto:TipReceipt:v1",
  Member: "peranto:Member:v1",
  CommonsWork: "peranto:CommonsWork:v1",
  CareContribution: "peranto:CareContribution:v1",
  LivenessCheck: "peranto:LivenessCheck:v1",
  ProofOfResidence: "peranto:ProofOfResidence:v1",
  /** Off-chain catalog id for DomainLinkageCredential tooling (see docs/well-known-did-configuration.md). */
  DomainLinkage: "peranto:DomainLinkage:v1",
} as const;

export type SchemaKey = (typeof SCHEMA_KEYS)[keyof typeof SCHEMA_KEYS];

export type LivenessCheckClaims = {
  provider: string;
  score: number | string;
  checkedAt: string;
  expiresAt: string;
  subjectDid?: string;
  sessionId?: string;
};

export type ProofOfResidenceDocType =
  | "utility"
  | "lease"
  | "tax_notice"
  | "bank_statement"
  | "other";

export type ProofOfResidenceClaims = {
  country: string;
  docType: ProofOfResidenceDocType | string;
  issuedWithinDays: number | string;
  checkedAt: string;
  expiresAt: string;
  provider: string;
  region?: string;
  subjectDid?: string;
};

/** Claims for DIF DomainLinkageCredential (well-known did-configuration). */
export type DomainLinkageClaims = {
  origin: string;
};

/** CredentialStatus enum on CredentialStatusRegistry */
export const CREDENTIAL_STATUS = {
  None: 0,
  Active: 1,
  Revoked: 2,
} as const;

export type CredentialStatusCode =
  (typeof CREDENTIAL_STATUS)[keyof typeof CREDENTIAL_STATUS];
