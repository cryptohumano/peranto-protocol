# Research: privacidad mínima y operaciones colectivas cooperativas

> Complementa [protocolo-peranto.md](./protocolo-peranto.md) y [tokenomics.md](./tokenomics.md).  
> Estado: consideraciones de diseño (implementer's notes), no whitepaper formal.

## 1. Pregunta de investigación

¿Cómo sostener **operaciones colectivas** (membresía, tips, tesoros, reputación) en un ledger público sin cruzar el umbral de **privacidad mínima permisible** para cooperativas y labs?

Definimos *mínimo permisible* como:

1. **No publicar PII en claro** en storage o eventos on-chain.
2. **El sujeto controla** el contenido de la VC (posesión del JWT).
3. **La cooperación puede ser visible** (quién es miembro, flujo de valor, anclas de existencia) cuando eso es requisito de accountability colectiva.
4. **Revocación** posible sin reescribir el JWT (ancla Active/Revoked).

No exige anonimato, unlinkabilidad fuerte ni confidencialidad de la *participación*.

## 2. Arquitectura adoptada (veredicto)

| Capa | Qué guarda | Privacidad |
|------|------------|------------|
| JWT-VC (vault / Aura) | Claims completos | Privado del holder; presentación selectiva |
| `CredentialStatusRegistry` | `credHash`, schemaId, subject, attester, status | Público: existencia y vínculo schema↔persona↔emisor, **no** el contenido |
| `SchemaRegistry` | id, hash del *schema*, URI | Público el tipo, no datos de usuario |
| `DisCONode` | miembros, tips, scores, saldo | Público por diseño DisCO (accountability) |
| `NameRegistry` | alias → address | Público si registras nombre |
| Solicitudes de VC | IndexedDB / off-chain | Privado hasta compartir |

**Veredicto:** correcta para el mínimo permisible en MVP SSI + economía cooperativa. El contenido sensible no va a la chain; la participación sí puede verse.

## 3. Lo que se filtra (y por qué se acepta)

- Address/DID, `@nombre`, `isMember`, montos de tip/contribute.
- Evento `CredentialAnchored`: “esta address tiene *alguna* credencial de schema X emitida por attester Y”.
- Servicios DID publicados (`did/svc/*`).

Esto es **privacidad de contenido**, no de metadatos de participación. En cooperativas suele ser deseable que la membresía y el flujo commons sean auditables.

## 4. Condiciones operativas

1. UI y SDK **no** deben invitar a meter PII en `setAttribute` ni en labels de nodos.
2. Verificadores deben preferir ancla + presentación mínima frente a pedir el JWT completo.
3. Colas de solicitud (request→issue) viven off-chain; on-chain solo el resultado anclado.
4. Documentar a miembros: tips y listas de miembros son visibles en exploradores.

## 5. Operaciones colectivas vs privacidad

| Operación | On-chain | VC / off-chain |
|-----------|----------|----------------|
| Unirse a un nodo | `addMember` (gobernanza) | Solicitud + VC `Member` opcional |
| Tip / contribute | PAS + Love/Care | TipReceipt / Care opcional |
| Emitir resultado lab | Ancla `EcoTestResult` | JWT con sample/result (PII técnica fuera de chain) |
| Cerrar nodo | `dissolve` | Revocar anclas Member si procede |
| Catálogo “qué puedo reclamar” | schemas públicos + config DisCO | Claims solo tras emisión |

## 6. Fuera de alcance (no es fallo del MVP)

- Ocultar que alguien pertenece a un nodo (haría falta ZK / commitments).
- Cifrado de claims on-chain (ciphertext + claves del subject): otro diseño.
- Mempool público de requests con PII.

## 7. Caso de uso explotable con VC (recomendado)

**EcosystemLab cooperativa + membresía + resultados de eco-testing**

1. Usuario descubre el nodo **EcosystemLab**, pide unirse (gobernanza / attester).
2. Attester emite VC **`Member`** (identity cooperativa) y ancla hash.
3. Lab/attester emite VC **`EcoTestResult`** por muestra (livelihood / evidencia portable).
4. Holder presenta Member o EcoTest a terceros (otra DisCO, municipio, ficha de proyecto) sin reenviar bases de datos centralizadas.
5. Si dejan la cooperativa o hay error, **revoke** on-chain invalida el ancla sin borrar el JWT local (deja de pasar verificación estricta).

Otros schemas del mismo patrón: `CommonsWork`, `CareContribution`, `TipReceipt` — evidencia portable ligada a un DisCO concreto, contenido off-chain, accountability on-chain.
