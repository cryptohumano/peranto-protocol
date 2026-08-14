# Aura Lab

dApp local para probar **Authorize · Save · Share** con Aura Wallet.

## Arranque

```bash
# desde la raíz del monorepo
npm install
npm run aura-lab
```

Abre **http://localhost:5174**

1. Carga Aura (`packages/extension/dist`) en Chrome.
2. En Aura: wallet en red **Paseo**, modo Holder.
3. En el lab: **Request session** → aprueba el origen en Aura.
4. **Emitir + guardar Liveness** → panel Guardar.
5. **Pedir Liveness** → panel Compartir.

Well-known: `http://localhost:5174/.well-known/did-configuration.json`

Clave de lab por defecto = Hardhat account #0 (solo localhost). Override: `AURA_LAB_PRIVATE_KEY=0x…`.
