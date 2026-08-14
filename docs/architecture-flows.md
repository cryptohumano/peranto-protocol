# Arquitectura y flujos — Peranto (SDK, contratos, Aura)

Diagramas de referencia para construir sobre `@peranto/sdk`, los registries on-chain y la extensión Aura.

Relacionados: [protocolo-peranto.md](./protocolo-peranto.md) · [tokenomics.md](./tokenomics.md) · [compliance-residence-liveness.md](./compliance-residence-liveness.md) · [bounty-compliance-proposal.md](./bounty-compliance-proposal.md) · [well-known-did-configuration.md](./well-known-did-configuration.md)

---

## 1. Capas del sistema

```mermaid
flowchart TB
  subgraph clients [Clientes]
    Aura[Aura_wallet]
    PWA[Portal_PWA]
    CLI[CLI_Node]
    Svc[Attester_service]
  end
  subgraph sdk [SDK_peranto]
    Client[PerantoClient]
    VC[JWT_VC_ES256K]
    Wallet[HD_purpose_keys]
  end
  subgraph chain [On_chain]
    DID[DIDRegistry]
    Schema[SchemaRegistry]
    Att[AttesterRegistry]
    Cred[CredentialStatusRegistry]
    Names[NameRegistry]
    Treas[ProtocolTreasury]
    Factory[DisCOFactory]
    Node[DisCONode]
  end
  Aura --> Client
  PWA --> Client
  CLI --> Client
  Svc --> Client
  Client --> VC
  Client --> Wallet
  Client --> DID
  Client --> Schema
  Client --> Att
  Client --> Cred
  Client --> Names
  Client --> Treas
  Client --> Factory
  Client --> Node
```

---

## 2. Contratos de registro (identidad SSI)

```mermaid
flowchart LR
  Subject[Subject_EOA]
  DID[DIDRegistry]
  Schema[SchemaRegistry]
  Att[AttesterRegistry]
  Cred[CredentialStatusRegistry]
  Names[NameRegistry]

  Subject -->|"implícito: address = DID"| DID
  Subject -->|"setAttribute / delegates"| DID
  Gov[Governance_publisher] -->|"registerSchema"| Schema
  Lab[Attester] -->|"stakeAndJoin / addSchema"| Att
  Gov -->|"authorizeAttester"| Att
  Schema -.->|"schemaExists"| Att
  Lab -->|"anchor credHash"| Cred
  Att -.->|"isAuthorized"| Cred
  Subject -->|"register label"| Names
```

| Contrato | Escrituras clave | Lecturas clave |
|----------|------------------|----------------|
| `DIDRegistry` | `setAttribute`, `addDelegate`, `deactivate` | `identityOwner`, resolve vía storage/logs |
| `SchemaRegistry` | `registerSchema` (publishers) | `schemaExists`, `getSchema` |
| `AttesterRegistry` | `stakeAndJoin`, `addSchema`, `startUnbond`, `withdraw` | `isAuthorized`, `stakeOf`, `minStake` |
| `CredentialStatusRegistry` | `anchor`, `anchorV2`, `revoke`, `isValid` | `status`, `statusV2`, `anchorFee` |
| `ComplianceZkVerifier` | `verifyGate`, `setPolicy`, `setGroth16` | `previewValid`, `minScoreBps`, `allowlistRoot` |
| `NameRegistry` | `register`, `release` | resolve label → address |

---

## 3. Flujo SDK: emitir y anclar una VC

```mermaid
sequenceDiagram
  participant App as App_or_service
  participant SDK as PerantoClient
  participant Att as AttesterRegistry
  participant Cred as CredentialStatusRegistry
  participant Holder as Holder_wallet

  App->>SDK: ensureAttesterForSchema(schemaKey)
  SDK->>Att: isAuthorized / addSchema / stakeAndJoin
  App->>SDK: issueAndAnchorClaims(subject, claims, schemaKey)
  SDK->>SDK: sign JWT ES256K (assertion or controller)
  SDK->>Cred: getAnchorFee(token)
  SDK->>Cred: anchor(credHash, schemaId, subject, fee)
  SDK-->>App: jwt + credHash + anchorTx
  App->>Holder: deliver JWT off-chain
  Note over Cred: on-chain solo hash + Active
```

Métodos SDK: `ensureAttesterForSchema`, `issueAndAnchorClaims`, `verifyCredential`, `revoke`, `getSchema`, `getAnchorFee`.

Constantes: `SCHEMA_KEYS`, `CREDENTIAL_STATUS` en `@peranto/sdk`.

---

## 4. Flujo SDK: verificar (curator / dapp)

```mermaid
sequenceDiagram
  participant Verifier as Verifier
  participant SDK as PerantoClient
  participant Cred as CredentialStatusRegistry
  participant Att as AttesterRegistry

  Verifier->>SDK: verifyCredential(jwt)
  SDK->>SDK: check ES256K + iss/sub
  SDK->>Cred: status(credHash)
  SDK->>Att: isAuthorized(attester, schemaId)
  SDK-->>Verifier: jwtValid + Active + authorized
```

El verifier **no** recibe PDF ni biometría; solo JWT + estado on-chain.

---

## 5. Attesters: join, multi-schema, unbond

```mermaid
stateDiagram-v2
  [*] --> NotAuthorized
  NotAuthorized --> Authorized: stakeAndJoin
  NotAuthorized --> Authorized: authorizeAttester_gov
  Authorized --> Authorized: addSchema_otro_schema
  Authorized --> Unbonding: startUnbond
  Unbonding --> NotAuthorized: isAuthorized_false
  Unbonding --> StakeReleased: withdraw_after_delay
  StakeReleased --> [*]
```

```mermaid
flowchart TB
  subgraph join [Primera_vez]
    A[stakeAndJoin schema A] --> AuthA[authorized A]
  end
  subgraph more [Más_schemas]
    AuthA --> B[addSchema schema B]
    B --> AuthB[authorized A y B]
  end
  subgraph helper [SDK]
    E[ensureAttesterForSchema]
    E -->|ya auth| Skip[noop]
    E -->|stake OK| Add[addSchema]
    E -->|sin stake| Stake[stakeAndJoin]
  end
```

---

## 6. Tesorerías y valor DisCO

```mermaid
flowchart TB
  User[Usuario]
  Node[DisCONode_TreasuryNodo]
  PT[ProtocolTreasury]
  Attester[Attester]
  Cred[CredentialStatusRegistry]
  Names[NameRegistry]

  User -->|"tip value"| Node
  User -->|"contribute 80/20"| Node
  Node -->|"20% contribute"| PT
  Node -->|"harvest canon sustainBps"| PT
  PT -->|"distribute hybrid"| Node
  Attester -->|"anchorFee"| Cred
  Cred -->|"fee →"| PT
  User -->|"nameFee"| Names
  Names -->|"fee →"| PT
```

```mermaid
sequenceDiagram
  participant M as Miembro
  participant N as DisCONode
  participant T as ProtocolTreasury

  M->>N: tip(to, value)
  Note over N: Care++ emisor, Love++ receptor
  M->>N: contribute(value)
  N->>T: 20% protocol
  Note over N: 80% queda en nodo
  M->>N: harvest(periodId)
  N->>T: canon = balance * sustainBps
  M->>T: distribute(periodId)
  T->>N: equalBps + weightBps Care/Love/Anchors
```

Detalle de parámetros: [tokenomics.md](./tokenomics.md).

---

## 7. Aura: acciones del popup vs provider dapp

```mermaid
flowchart LR
  subgraph popup [Popup_Aura]
    UI[Tabs_UI]
    Dispatch[dispatch_ACTION]
    Run[runAction]
  end
  subgraph dapp [Dapp_inpage]
    Inj[window.aura]
    Prov[handleProviderRequest]
  end
  UI --> Dispatch --> Run
  Inj --> Prov
  Prov -->|"eth_* / personal_sign"| EVM[viem_wallet]
  Prov -->|"peranto_getDid"| DID
  Prov -->|"wallet_getCredentials"| Vault[chrome_storage_vault]
  Prov -->|"peranto_action"| Run
  Run --> SDK[PerantoClient]
```

| Superficie | Ejemplos | Quién firma |
|------------|----------|-------------|
| Popup `ACTION` | `attester.join`, `vc.issue`, `disco.tip` | Identidad Aura en storage |
| EIP-1193 | `eth_sendTransaction`, `personal_sign` | Misma PK EVM |
| Peranto | `peranto_getDid`, `peranto_action`, `wallet_getCredentials` | Popup / SW |

### 7.1 Domain linkage (obligatorio para APIs sensibles)

Antes de `wallet_getCredentials`, `peranto_saveCredential` / `peranto_requestCredential` o `peranto_action` privilegiado, Aura **MUST** verificar el Well-Known DID Configuration del origen de la página (perfil Sporran/KILT adaptado a `did:peranto`). Spec: [well-known-did-configuration.md](./well-known-did-configuration.md).

### Holder Save / Share (Sporran-like)

```mermaid
sequenceDiagram
  participant D as dApp
  participant A as Aura
  participant H as Holder

  D->>A: peranto_saveCredential(jwt)
  A->>A: domain linkage + verify JWT
  A->>H: panel Guardar
  H-->>A: aprobar / rechazar
  A-->>D: StoredCredential | error

  D->>A: peranto_requestCredential(schemas, challenge)
  A->>H: panel Compartir (candidatos)
  H-->>A: elige VC
  A-->>D: Presentation + proof(challenge)
```


```mermaid
sequenceDiagram
  participant Page as Dapp_HTTPS
  participant Aura as Aura
  participant WK as well_known
  participant Reg as DIDRegistry

  Page->>Aura: wallet_getCredentials_or_peranto_action
  Aura->>WK: GET /.well-known/did-configuration.json
  Aura->>Reg: resolveDid issuer
  Aura->>Aura: verify DomainLinkageCredential
  alt origin_matches_and_sig_ok
    Aura-->>Page: allow
  else fail
    Aura-->>Page: deny
  end
```

On-chain: servicio `LinkedDomains` en el DID del servicio (hint). Off-chain: DomainLinkageCredential firmado por ese DID.

**Aura (implementado):** el content script obtiene el well-known same-origin; el provider exige `verifyDomainLinkage` antes de APIs sensibles; cache ~1h en “Sitios de confianza” (Red).

---

## 8. Compliance gate (producto encima del protocolo)

```mermaid
flowchart TB
  Applicant[Applicant_Aura]
  Didit[Didit_Sessions]
  AttSvc[Attester_service_SDK]
  Chain[CredentialStatusRegistry]
  Curator[Curator_verify]

  Applicant -->|"DID + start KYC"| Didit
  Didit -->|"webhook decision"| AttSvc
  AttSvc -->|"LivenessCheck VC"| Applicant
  AttSvc -->|"ProofOfResidence VC"| Applicant
  AttSvc -->|"anchor hashes"| Chain
  Applicant -->|"present JWTs"| Curator
  Curator -->|"verifyCredential"| Chain
```

Ver [compliance-residence-liveness.md](./compliance-residence-liveness.md). El attester de producción es **servicio Node + SDK**, no la extensión Aura del usuario.

---

## 9. Mapa rápido SDK → contrato

| `PerantoClient` | Contrato |
|-----------------|----------|
| `resolveDid`, delegates, services | `DIDRegistry` |
| `registerSchema`, `getSchema`, `setSchemaPublisher` | `SchemaRegistry` |
| `stakeAndJoin`, `addSchema`, `ensureAttesterForSchema`, `authorizeAttester`, `revokeAttester`, `startUnbond`, `withdrawAttesterStake` | `AttesterRegistry` |
| `issueAndAnchorClaims`, `verifyCredential`, `revoke`, `getAnchorFee`, `getCredentialStatus`, `isCredentialValid`, `getCredentialStatusV2` | `CredentialStatusRegistry` |
| `proveComplianceGateAlgebraic`, `verifyComplianceGatePublic`, `computeClaimsCommitment` | compliance / ZK (see `@peranto/zk-compliance`) |
| `registerName`, `resolveName` | `NameRegistry` |
| `createNode`, `tip`, `contribute`, `harvest`, `distribute`, scores | `DisCOFactory` / `DisCONode` / `ProtocolTreasury` |
