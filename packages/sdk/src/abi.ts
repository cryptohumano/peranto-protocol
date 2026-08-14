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
    name: "DELEGATE_SVC",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "DELEGATE_SIG_AUTH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "DELEGATE_VERI_KEY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "isServiceAttributeName",
    stateMutability: "pure",
    inputs: [{ name: "name", type: "bytes32" }],
    outputs: [{ type: "bool" }],
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
    name: "getAttribute",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "address" },
      { name: "name", type: "bytes32" },
    ],
    outputs: [
      { name: "value", type: "bytes" },
      { name: "validTo", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "attributeCount",
    stateMutability: "view",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "attributeNameAt",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "activeAttributeCount",
    stateMutability: "view",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "changeOwner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "identity", type: "address" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addDelegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "identity", type: "address" },
      { name: "delegateType", type: "bytes32" },
      { name: "delegate", type: "address" },
      { name: "validity", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeDelegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "identity", type: "address" },
      { name: "delegateType", type: "bytes32" },
      { name: "delegate", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "validDelegate",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "address" },
      { name: "delegateType", type: "bytes32" },
      { name: "delegate", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "delegates",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "address" },
      { name: "delegateType", type: "bytes32" },
      { name: "delegate", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "delegateCount",
    stateMutability: "view",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "delegateAt",
    stateMutability: "view",
    inputs: [
      { name: "identity", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      { name: "delegateType", type: "bytes32" },
      { name: "delegate", type: "address" },
      { name: "validTo", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "deactivate",
    stateMutability: "nonpayable",
    inputs: [{ name: "identity", type: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "DIDOwnerChanged",
    inputs: [
      { name: "identity", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: false },
      { name: "previousChange", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DIDDelegateChanged",
    inputs: [
      { name: "identity", type: "address", indexed: true },
      { name: "delegateType", type: "bytes32", indexed: false },
      { name: "delegate", type: "address", indexed: false },
      { name: "validTo", type: "uint256", indexed: false },
      { name: "previousChange", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DIDAttributeChanged",
    inputs: [
      { name: "identity", type: "address", indexed: true },
      { name: "name", type: "bytes32", indexed: false },
      { name: "value", type: "bytes", indexed: false },
      { name: "validTo", type: "uint256", indexed: false },
      { name: "previousChange", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DIDDeactivated",
    inputs: [
      { name: "identity", type: "address", indexed: true },
      { name: "previousChange", type: "uint256", indexed: false },
    ],
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
  {
    type: "function",
    name: "governance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "publishers",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setGovernance",
    stateMutability: "nonpayable",
    inputs: [{ name: "next", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setPublisher",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publisher", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const attesterRegistryAbi = [
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
    name: "revokeAttester",
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
    name: "authorized",
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
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stakeOf",
    stateMutability: "view",
    inputs: [
      { name: "attester", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondReleaseAt",
    stateMutability: "view",
    inputs: [{ name: "attester", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "governance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "schemaRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tokenRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "setTokenRegistry",
    stateMutability: "nonpayable",
    inputs: [{ name: "next", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setGovernance",
    stateMutability: "nonpayable",
    inputs: [{ name: "next", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setUnbondDelay",
    stateMutability: "nonpayable",
    inputs: [{ name: "next", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "slash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attester", type: "address" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stakeAndJoin",
    stateMutability: "payable",
    inputs: [
      { name: "schemaId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "startUnbond",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
] as const;

export const credentialStatusAbi = [
  {
    type: "event",
    name: "CredentialAnchored",
    inputs: [
      { name: "credHash", type: "bytes32", indexed: true },
      { name: "schemaId", type: "bytes32", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "subject", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CredentialAnchoredV2",
    inputs: [
      { name: "credHash", type: "bytes32", indexed: true },
      { name: "schemaId", type: "bytes32", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "subject", type: "address", indexed: false },
      { name: "validUntil", type: "uint64", indexed: false },
      { name: "claimsCommitment", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CredentialRevoked",
    inputs: [
      { name: "credHash", type: "bytes32", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "function",
    name: "anchor",
    stateMutability: "payable",
    inputs: [
      { name: "credHash", type: "bytes32" },
      { name: "schemaId", type: "bytes32" },
      { name: "subject", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "anchorV2",
    stateMutability: "payable",
    inputs: [
      { name: "credHash", type: "bytes32" },
      { name: "schemaId", type: "bytes32" },
      { name: "subject", type: "address" },
      { name: "validUntil", type: "uint64" },
      { name: "claimsCommitment", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "anchorFee",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isValid",
    stateMutability: "view",
    inputs: [{ name: "credHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
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
    name: "statusV2",
    stateMutability: "view",
    inputs: [{ name: "credHash", type: "bytes32" }],
    outputs: [
      { name: "st", type: "uint8" },
      { name: "attester", type: "address" },
      { name: "schemaId", type: "bytes32" },
      { name: "subject", type: "address" },
      { name: "anchoredAt", type: "uint64" },
      { name: "validUntil", type: "uint64" },
      { name: "claimsCommitment", type: "bytes32" },
      { name: "revokeReason", type: "string" },
    ],
  },
] as const;

export const nameRegistryAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "labelHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "label",
        "type": "string",
        "indexed": false
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true
      }
    ],
    "name": "NameRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "labelHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true
      }
    ],
    "name": "NameReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "labelHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "from",
        "type": "address",
        "indexed": true
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true
      }
    ],
    "name": "NameTransferred",
    "type": "event"
  },
  {
    "type": "function",
    "name": "primaryLabelOf",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bytes32"
      }
    ]
  },
  {
    "type": "function",
    "name": "register",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "label",
        "type": "string"
      },
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "registrationFee",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "release",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "label",
        "type": "string"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "resolve",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "label",
        "type": "string"
      }
    ],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "setPrimary",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "label",
        "type": "string"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "transfer",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "label",
        "type": "string"
      },
      {
        "name": "to",
        "type": "address"
      }
    ],
    "outputs": []
  }
] as const;

export const protocolTreasuryAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "Deposited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "periodId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "total",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "nodeCount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "Distributed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "node",
        "type": "address",
        "indexed": true
      }
    ],
    "name": "NodeRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false
      }
    ],
    "name": "TokenAllowed",
    "type": "event"
  },
  {
    "type": "function",
    "name": "allowedToken",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "distribute",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "periodId",
        "type": "uint256"
      },
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "distributed",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      },
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "equalBps",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "getAllowedTokens",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "out",
        "type": "address[]"
      }
    ]
  },
  {
    "type": "function",
    "name": "getNodes",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "address[]"
      }
    ]
  },
  {
    "type": "function",
    "name": "governance",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "isNode",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "isTokenAllowed",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "nativeAllowed",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "nodeCount",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "removeNode",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "node",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "selfUnregister",
    "stateMutability": "nonpayable",
    "inputs": [],
    "outputs": []
  },
  {
    "type": "function",
    "name": "setTokenAllowed",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "allowed",
        "type": "bool"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "weightBps",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  }
] as const;

export const disCOFactoryAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "node",
        "type": "address",
        "indexed": true
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false
      }
    ],
    "name": "NodeCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "node",
        "type": "address",
        "indexed": true
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "reserveFloor",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "NodeSeeded",
    "type": "event"
  },
  {
    "type": "function",
    "name": "allNodes",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "createNode",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "name_",
        "type": "string"
      }
    ],
    "outputs": [
      {
        "name": "node",
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "createNodeWithConfig",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "name_",
        "type": "string"
      },
      {
        "name": "reserveFloor_",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "node",
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "createNodeWithTokenSeed",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "name_",
        "type": "string"
      },
      {
        "name": "reserveFloor_",
        "type": "uint256"
      },
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "node",
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "defaultReserveFloor",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "nodeByCreator",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "nodeCount",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "periodBlocks",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  }
] as const;

export const disCONodeAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "toNode",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "toProtocol",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "ActivityFee",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "actor",
        "type": "address",
        "indexed": true
      },
      {
        "name": "credHash",
        "type": "bytes32",
        "indexed": true
      }
    ],
    "name": "AnchorRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "residualTo",
        "type": "address",
        "indexed": true
      },
      {
        "name": "nativeAmount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "Dissolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "otherNode",
        "type": "address",
        "indexed": true
      },
      {
        "name": "periodId",
        "type": "uint256",
        "indexed": true
      }
    ],
    "name": "FederationLinked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "periodId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "sustainBps",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "Harvested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true
      },
      {
        "name": "joined",
        "type": "bool",
        "indexed": false
      }
    ],
    "name": "MemberUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "name": "Tipped",
    "type": "event"
  },
  {
    "type": "function",
    "name": "addFederationLink",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "otherNode",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "addMember",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "carePoints",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "contribute",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "createdPeriod",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "currentPeriod",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "dissolve",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "residualTo",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "dissolved",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "governance",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "harvest",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "periodId",
        "type": "uint256"
      },
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "isMember",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "livelihoodPoints",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "lovePoints",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "memberCount",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "members",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "address[]"
      }
    ]
  },
  {
    "type": "function",
    "name": "name",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "string"
      }
    ]
  },
  {
    "type": "function",
    "name": "periodBlocks",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "periodStats",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "love",
        "type": "uint256"
      },
      {
        "name": "care",
        "type": "uint256"
      },
      {
        "name": "anchors",
        "type": "uint256"
      },
      {
        "name": "federationLinks",
        "type": "uint256"
      },
      {
        "name": "harvested",
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "recordAnchor",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "credHash",
        "type": "bytes32"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "removeMember",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "reserveFloor",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "seedToken",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "setReserveFloor",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "next",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "setReserveFloor",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "next",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "sustainBpsFor",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "periodId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "tip",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "to",
        "type": "address"
      },
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "tokenHarvested",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      },
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "withdraw",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "to",
        "type": "address"
      },
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": []
  }
] as const;

/** Minimal ERC-20 for approve / balance / metadata */
export const erc20PaymentAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** Native payment token sentinel (PAS/ETH). */
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as const;
