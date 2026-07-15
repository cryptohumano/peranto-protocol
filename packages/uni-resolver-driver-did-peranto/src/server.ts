/**
 * DIF Universal Resolver driver for did:peranto
 * GET /1.0/identifiers/{did}
 * @see https://github.com/decentralized-identity/universal-resolver/blob/main/docs/driver-development.md
 */
import http from "node:http";
import {
  PerantoClient,
  isPerantoDid,
  parseDid,
  type DidDocument,
} from "@peranto/sdk";
import { loadDriverConfig } from "./config.js";

const config = loadDriverConfig();
const client = new PerantoClient({
  network: config.network,
  addresses: config.addresses,
  rpcUrl: config.rpcUrl,
});

type ResolutionResult = {
  "@context": string;
  didDocument: DidDocument | null;
  didResolutionMetadata: Record<string, unknown>;
  didDocumentMetadata: Record<string, unknown>;
};

function extractDid(url: string): string | null {
  const marker = "/1.0/identifiers/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  let raw = url.slice(i + marker.length);
  const q = raw.indexOf("?");
  if (q !== -1) raw = raw.slice(0, q);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function resolve(did: string): Promise<{
  status: number;
  body: ResolutionResult;
}> {
  const started = Date.now();

  if (!isPerantoDid(did)) {
    return {
      status: 400,
      body: {
        "@context": "https://w3id.org/did-resolution/v1",
        didDocument: null,
        didResolutionMetadata: {
          error: "invalidDid",
          errorMessage: `Not a valid did:peranto identifier: ${did}`,
          contentType: "application/did+ld+json",
          duration: Date.now() - started,
        },
        didDocumentMetadata: {},
      },
    };
  }

  // Cross-network guard: driver instance is bound to one network config.
  try {
    const { network } = parseDid(did);
    if (network !== config.network) {
      return {
        status: 400,
        body: {
          "@context": "https://w3id.org/did-resolution/v1",
          didDocument: null,
          didResolutionMetadata: {
            error: "invalidDid",
            errorMessage: `This driver instance resolves network "${config.network}" only (got "${network}")`,
            contentType: "application/did+ld+json",
            duration: Date.now() - started,
          },
          didDocumentMetadata: {},
        },
      };
    }
  } catch {
    return {
      status: 400,
      body: {
        "@context": "https://w3id.org/did-resolution/v1",
        didDocument: null,
        didResolutionMetadata: {
          error: "invalidDid",
          contentType: "application/did+ld+json",
          duration: Date.now() - started,
        },
        didDocumentMetadata: {},
      },
    };
  }

  try {
    const didDocument = await client.resolveDid(did);
    const deactivated = Boolean(didDocument.deactivated);
    // DID Core docs often omit deactivated from the document body in resolution results
    const doc = { ...didDocument };
    delete doc.deactivated;

    return {
      status: 200,
      body: {
        "@context": "https://w3id.org/did-resolution/v1",
        didDocument: doc,
        didResolutionMetadata: {
          contentType: "application/did+ld+json",
          pattern: "^did:peranto:.+$",
          driver: "uni-resolver-driver-did-peranto/0.1.0",
          network: config.network,
          duration: Date.now() - started,
        },
        didDocumentMetadata: {
          deactivated,
        },
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: 500,
      body: {
        "@context": "https://w3id.org/did-resolution/v1",
        didDocument: null,
        didResolutionMetadata: {
          error: "internalError",
          errorMessage: msg,
          contentType: "application/did+ld+json",
          duration: Date.now() - started,
        },
        didDocumentMetadata: {},
      },
    };
  }
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/ld+json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      network: config.network,
      rpcUrl: config.rpcUrl,
      didRegistry: config.addresses.DIDRegistry,
    });
    return;
  }

  if (req.method === "GET" && req.url?.includes("/1.0/identifiers/")) {
    const did = extractDid(req.url);
    if (!did) {
      sendJson(res, 400, {
        "@context": "https://w3id.org/did-resolution/v1",
        didDocument: null,
        didResolutionMetadata: { error: "invalidDid" },
        didDocumentMetadata: {},
      });
      return;
    }
    const result = await resolve(did);
    sendJson(res, result.status, result.body);
    return;
  }

  sendJson(res, 404, {
    error: "notFound",
    hint: "GET /1.0/identifiers/{did}  |  GET /health",
  });
});

server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      service: "uni-resolver-driver-did-peranto",
      version: "0.1.0",
      port: config.port,
      network: config.network,
      rpcUrl: config.rpcUrl,
      didRegistry: config.addresses.DIDRegistry,
    })
  );
});
