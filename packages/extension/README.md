# Aura Wallet

Extensión Manifest V3 (Chrome / Brave / Edge) para el protocolo **did:peranto**: identidad possession-first, emisión/verificación de EcoTest JWT-VC, attester, nombres y economía DisCO.

## Acciones

| Pestaña | Acciones |
|---------|----------|
| **Inicio** | Crear/importar DID, resolver DID, `stakeAndJoin`, chequear autorización |
| **VCs** | Issue + anchor EcoTest, verificar JWT, vault local, revocar |
| **DisCO** | createNode, tip, contribute, harvest, distribute, scores, addMember |
| **Nombres** | register / resolve |
| **Red** | hardhat ↔ paseo, RPC, importar JSON de `deployments/` |

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
