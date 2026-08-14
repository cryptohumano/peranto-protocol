# Aura Wallet

Extensión Manifest V3 (Chrome / Brave / Edge) para el protocolo **did:peranto**: identidad possession-first, emisión/verificación de EcoTest JWT-VC, attester, nombres y economía DisCO.

## Acciones

| Modo | Pestañas |
|------|----------|
| **Holder** (default) | Inicio, Credenciales, Ajustes — vault, importar JWT, autorizar dapps |
| **Lab** | + Firmar, Emitir, DisCO, Nombres, Attester |

### Autorizar dapp (estilo Sporran)

1. La dapp publica `/.well-known/did-configuration.json`.
2. Al pedir vault / acción sensible, Aura verifica DomainLinkage.
3. Si el crypto es OK pero aún no aprobaste el origen, aparece el panel **Autorizar dapp** (badge en el icono).
4. Aprobar → la dapp puede reintentar. Rechazar → se olvida el origen.

Generar well-known: `npm run cli -- did-config create --origin https://… --private-key 0x…`

### Save + Share (holder)

Tras autorizar el origen, la dapp puede:

```js
// Guardar VC
await aura.request({
  method: "peranto_saveCredential",
  params: [{ jwt, label: "Liveness" }],
});

// Presentación completa (JWT + challenge)
const full = await aura.request({
  method: "peranto_requestCredential",
  params: [{
    schemaKeys: ["peranto:LivenessCheck:v1"],
    challenge: crypto.randomUUID(),
  }],
});

// Solo claims (sin JWT) — p.ej. país para un gate
const claims = await aura.request({
  method: "peranto_requestCredential",
  params: [{
    schemaKeys: ["peranto:ProofOfResidence:v1"],
    mode: "claims",
    disclose: ["country"],
    challenge: crypto.randomUUID(),
  }],
});
// claims.disclosedClaims.country + claims.proof
```

Verificar con `@peranto/sdk` → `verifyPresentation(presentation, { expectedChallenge })`.
Aliases: `wallet_saveCredential`, `wallet_requestCredential`. Timeout ~110s.

## Firmas multi-cadena

Aura deriva de un **mnemonic BIP39**:

| Esquema | Uso |
|---------|-----|
| **secp256k1** | `did:peranto`, JWT-VC ES256K, txs EVM y **PVM** vía eth-rpc (`personal_sign` EIP-191) |
| **sr25519** | Extrinsics / payloads Substrate nativos |
| **ed25519** | Cadenas Substrate con ed25519 |

También expone `evmMappedAccountId32` (H160 + padding `0xee`) para cuentas eth-mapped en Hub/revive.

SDK: `createMultiKeyIdentity`, `signPayload`, `signSubstrateExtrinsicPayload`, `verifyPayload`.

## Desarrollo

```bash
# desde la raíz del monorepo
npm install
npm run extension:build
```

La extensión compilada queda en `packages/extension/dist`.

### Cargar en Chrome (esta máquina)

1. Arranca nodo + deploy local si vas a usar Hardhat:
   ```bash
   npx hardhat node
   # otra terminal
   npm run deploy:local
   ```
2. Abre `chrome://extensions` → Modo desarrollador → **Cargar extensión sin empaquetar**.
3. Selecciona la carpeta **`packages/extension/dist`** (debe verse `manifest.json` *dentro* de esa carpeta, no un nivel arriba).
4. En **Red**, pega el contenido de `deployments/31337.json` (las direcciones por defecto pueden desfasarse si redespliegas).
5. Crea un DID → **Attester → stakeAndJoin** → emite un EcoTest.

### Instalar en otra PC (Windows / macOS)

Desde la raíz del repo:

```bash
npm run extension:pack
# → releases/aura-wallet.zip
```

1. Copia `releases/aura-wallet.zip` a la otra PC.
2. Extrae el zip a una carpeta, p. ej. `C:\aura-wallet` o `~\aura-wallet`.
3. Abre esa carpeta y **confirma que existe `manifest.json` en la raíz** (junto a `assets/`, `src/`, etc.).
   - Si ves `aura-wallet/dist/manifest.json`, estás un nivel arriba: selecciona la carpeta `dist`, no el padre.
4. Chrome → `chrome://extensions` → Modo desarrollador → **Cargar extensión sin empaquetar** → elige la carpeta que **contiene** `manifest.json`.

Error típico *"Falta el archivo de manifiesto"*: se eligió `packages/extension` (código fuente) o la carpeta padre del zip, no el build.

### Modo watch

```bash
npm run extension:dev
```

## Notas

- Las claves viven en `chrome.storage.local` (demo; no es una wallet de producción con hardware/HSM).
- Paseo: tras `npm run deploy:paseo`, importa el JSON de deployment y selecciona red `paseo`.
- El service worker ejecuta las txs vía `@peranto/sdk` + viem (misma superficie que el CLI).
- **Domain linkage:** las dapps que pidan vault / acciones privilegiadas **deben** publicar `/.well-known/did-configuration.json`. Aura verifica DomainLinkageCredential (fail closed) antes de `wallet_getCredentials`, `peranto_action` sensibles y `peranto_requestSession`. Spec: [`docs/well-known-did-configuration.md`](../../docs/well-known-did-configuration.md). Generar el JSON: `npm run cli -- did-config create --origin https://tu-dapp --private-key 0x…`.