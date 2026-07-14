export const didRegistryAbi = [
  {
    type: "function",
    name: "identityOwner",
    stateMutability: "view",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "deactivated",
    stateMutability: "view",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "changed",
    stateMutability: "view",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setAttribute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "identity", type: "address" },
      { name: "name", type: "bytes32" },
      { name: "value", type: "bytes" },
      { name: "validity", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "deactivate",
    stateMutability: "nonpayable",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [],
  },
] as const;

export const schemaRegistryAbi = [
  {
    type: "function",
    name: "registerSchema",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemaId", type: "bytes32" },
      { name: "schemaHash", type: "bytes32" },
      { name: "uri", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getSchema",
    stateMutability: "view",
    inputs: [{ name: "schemaId", type: "bytes32" }],
    outputs: [
      { name: "schemaHash", type: "bytes32" },
      { name: "uri", type: "string" },
      { name: "publisher", type: "address" },
      { name: "registeredAt", type: "uint64" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "schemaExists",
    stateMutability: "view",
    inputs: [{ name: "schemaId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const attesterRegistryAbi = [
  {
    type: "function",
    name: "stakeAndJoin",
    stateMutability: "payable",
    inputs: [{ name: "schemaId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "addSchema",
    stateMutability: "nonpayable",
    inputs: [{ name: "schemaId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizeAttester",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attester", type: "address" },
      { name: "schemaId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isAuthorized",
    stateMutability: "view",
    inputs: [
      { name: "attester", type: "address" },
      { name: "schemaId", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const credentialStatusAbi = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "payable",
    inputs: [
      { name: "credHash", type: "bytes32" },
      { name: "schemaId", type: "bytes32" },
      { name: "subject", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [
      { name: "credHash", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [{ name: "credHash", type: "bytes32" }],
    outputs: [
      { name: "st", type: "uint8" },
      { name: "attester", type: "address" },
      { name: "schemaId", type: "bytes32" },
      { name: "subject", type: "address" },
      { name: "anchoredAt", type: "uint64" },
      { name: "revokeReason", type: "string" },
    ],
  },
  {
    type: "function",
    name: "anchorFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const nameRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "registrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setPrimary",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [],
  },
] as const;
