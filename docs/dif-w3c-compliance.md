# Camino a compliance W3C + DIF (did:peranto)

Spec del método: [did-peranto-method.md](./did-peranto-method.md) **v0.1**.  
Driver: `packages/uni-resolver-driver-did-peranto`.  
Borradores de PR externos: [external-prs-draft.md](./external-prs-draft.md).

## Qué ya cubre la spec v0.1

- Sintaxis ABNF + redes canónicas  
- Document mínimo + enrichment on-chain  
- Create / Resolve / Update / Deactivate  
- Addresses de referencia en Paseo  

Eso es **compliance de método DID Core** a nivel especificación + implementación de referencia (SDK).

## Pasos externos (aún pendientes de PR)

### 1. Registrar el método en W3C

1. Abrir PR en [w3c/did-extensions](https://github.com/w3c/did-extensions) (DID Methods / registries).
2. Entrada mínima: método `peranto`, link a esta spec v0.1 (URL estable del repo o GH Pages), contacto.
3. Esperar merge del WG (proceso comunitario; no es una auditoría).

### 2. Publicar el driver Docker

```bash
# desde la raíz del monorepo
docker build -f packages/uni-resolver-driver-did-peranto/Dockerfile \
  -t ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0 .
docker push ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0
```

Probar local:

```bash
npm run driver:dev
# o
docker run --rm -p 8080:8080 \
  -e PERANTO_RPC_URL=https://eth-rpc-testnet.polkadot.io/ \
  ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0

curl -sS "http://127.0.0.1:8080/1.0/identifiers/did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF" \
  -H 'Accept: application/ld+json' | jq .
```

### 3. PR al Universal Resolver (DIF)

Tras tener **spec en el registry W3C** + **imagen pública versionada**:

Editar en [decentralized-identity/universal-resolver](https://github.com/decentralized-identity/universal-resolver):

- `docker-compose.yml` — servicio del driver  
- `uni-resolver-web/.../application.yml` — `pattern`, `url`, `testIdentifiers`  
- `README.md` — fila del driver  

Guía: [Driver Development](https://github.com/decentralized-identity/universal-resolver/blob/main/docs/driver-development.md).

**testIdentifiers sugeridos (Paseo):**

```
did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF
```

(Añadir un DID `deactivated` cuando exista uno estable en testnet.)

### Pattern sugerido para application.yml

```yaml
- pattern: '^(did:peranto:.+)$'
  url: '${uniresolver_web_driver_url_did_peranto:http://driver-did-peranto:8080/}'
  testIdentifiers:
    - 'did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF'
```

## Orden

```
Spec v0.1 (hecho) → Driver (hecho en repo) → Push imagen
    → PR W3C registry → PR uni-resolver → aparece en dev.uniresolver.io
```

## Rendimiento / infra (evaluación)

Notas sobre resolve por logs, RPC dedicado y posible storage on-chain: [perf-rpc-did-resolve.md](./perf-rpc-did-resolve.md).
