# uni-resolver-driver-did-peranto

Driver HTTP compatible con el [DIF Universal Resolver](https://github.com/decentralized-identity/universal-resolver) para **`did:peranto`**.

Spec: [docs/did-peranto-method.md](../../docs/did-peranto-method.md) · Checklist: [docs/dif-w3c-compliance.md](../../docs/dif-w3c-compliance.md)

## API

| Método | Path | Descripción |
|--------|------|-------------|
| `GET` | `/1.0/identifiers/{did}` | DID Resolution Result (`application/ld+json`) |
| `GET` | `/health` | Red, RPC, address de `DIDRegistry` |

El DID puede ir URL-encoded (`did%3Aperanto%3Apaseo%3A0x…`).

## Local (sin Docker)

```bash
# raíz del monorepo
npm install
npm run build -w @peranto/sdk
npm run driver:dev
```

```bash
curl -sS 'http://127.0.0.1:8080/1.0/identifiers/did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF' \
  -H 'Accept: application/ld+json'
```

## Docker

Desde la **raíz** del monorepo:

```bash
docker build -f packages/uni-resolver-driver-did-peranto/Dockerfile \
  -t ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0 .

docker run --rm -p 8080:8080 \
  -e PERANTO_RPC_URL=https://eth-rpc-testnet.polkadot.io/ \
  ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0
```

## Variables de entorno

| Variable | Default | Uso |
|----------|---------|-----|
| `PORT` | `8080` | Listen |
| `PERANTO_NETWORK` | `paseo` | Red del driver (debe coincidir con el DID) |
| `PERANTO_RPC_URL` | Paseo public RPC | Endpoint eth_call / logs |
| `PERANTO_DEPLOYMENT_PATH` | `deployments/paseo.json` en la imagen | Addresses |
| `PERANTO_DID_REGISTRY` | (desde JSON) | Override opcional |

## Contribución a DIF

1. Spec registrada en W3C DID Method Registry.  
2. Imagen pública **versionada** (no `:latest`).  
3. PR a `decentralized-identity/universal-resolver` — ver [dif-w3c-compliance.md](../../docs/dif-w3c-compliance.md).

Pattern sugerido: `^(did:peranto:.+)$`  
testIdentifier: `did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF`

## License

MIT
