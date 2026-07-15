# Borradores para PRs externos (W3C + DIF Universal Resolver)

Completar cuando la imagen `ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0`
esté pública y la spec v0.1 esté en una URL estable
(`https://github.com/cryptohumano/peranto-protocol/blob/minimal/docs/did-peranto-method.md`
o Pages).

---

## A) W3C DID Method Registry

Repo: [w3c/did-extensions](https://github.com/w3c/did-extensions) (sección DID Methods).

### Entrada propuesta

| Method Name | Status | Version | Spec | Contact |
|-------------|--------|---------|------|---------|
| `peranto` | registered | 0.1 | [did:peranto Method Spec v0.1](https://github.com/cryptohumano/peranto-protocol/blob/minimal/docs/did-peranto-method.md) | [@cryptohumano](https://github.com/cryptohumano) |

### Texto PR (inglés)

```
Add did:peranto method registration (v0.1)

Registers the `peranto` DID method used on EVM/PolkaVM networks
(primary public deployment: Polkadot Hub TestNet / Paseo).

- Spec: https://github.com/cryptohumano/peranto-protocol/blob/minimal/docs/did-peranto-method.md
- Reference resolver driver: packages/uni-resolver-driver-did-peranto
- Contact: @cryptohumano
```

---

## B) DIF Universal Resolver

Repo: [decentralized-identity/universal-resolver](https://github.com/decentralized-identity/universal-resolver)  
Requisito: método listado en W3C registry + imagen pública versionada.

### `docker-compose.yml` (servicio)

```yaml
  driver-did-peranto:
    image: ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0
    ports:
      - "8088:8080"
    environment:
      - PERANTO_NETWORK=paseo
      - PERANTO_RPC_URL=https://eth-rpc-testnet.polkadot.io/
```

En el servicio `uni-resolver-web`, añadir env:

```yaml
      - uniresolver_web_driver_url_did_peranto=http://driver-did-peranto:8080/
```

### `application.yml` (driver)

```yaml
  - pattern: '^(did:peranto:.+)$'
    url: '${uniresolver_web_driver_url_did_peranto:http://driver-did-peranto:8080/}'
    testIdentifiers:
      - 'did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF'
```

### README row

| Driver | Version | Spec | Image | Contact |
|--------|---------|------|-------|---------|
| [did-peranto](https://github.com/cryptohumano/peranto-protocol/tree/minimal/packages/uni-resolver-driver-did-peranto) | 0.1.0 | [0.1](https://github.com/cryptohumano/peranto-protocol/blob/minimal/docs/did-peranto-method.md) | `ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0` | @cryptohumano |

### Texto PR

```
Add did:peranto driver (Paseo / Polkadot Hub TestNet)

- Image: ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0
- Spec: did:peranto method v0.1 (W3C registry entry: <link when merged>)
- testIdentifier: did:peranto:paseo:0x354151d1039Ba06862f8a5062b37BCb8b082cEDF
- Contact: @cryptohumano
```

---

## C) Publicar imagen desde este repo

```bash
# Tras merge y Packages write OK:
# Actions → "Publish DID resolver driver image" → Run workflow → tag 0.1.0
#
# O local (requiere docker login ghcr.io):
docker build -f packages/uni-resolver-driver-did-peranto/Dockerfile \
  -t ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0 .
docker push ghcr.io/cryptohumano/uni-resolver-driver-did-peranto:0.1.0
```
