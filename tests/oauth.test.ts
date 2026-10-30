import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { protectedResourceMetadata, oauthChallenge, consentReturnPath } from "../src/lib/oauth";
import { requestStore } from "../src/lib/store";
import { serveMcp } from "../src/lib/mcp-http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("OAuth discovery, Google continuation, and signed agent access reach the ledger", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "ES256", use: "sig" };
  let rpcAuthorization = "";
  const provider = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/auth/v1/.well-known/jwks.json") response.end(JSON.stringify({ keys: [key] }));
    else if (request.url === "/rest/v1/rpc/splitzii_read") {
      rpcAuthorization = request.headers.authorization || "";
      response.end("[]");
    } else { response.statusCode = 404; response.end("{}"); }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address() as { port: number };
  process.env.NEXT_PUBLIC_APP_URL = "https://splitzii.example";
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_local_fixture";
  const issuer = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "ES256", typ: "JWT", kid: key.kid })}.${encode({ iss: issuer, sub: "11111111-1111-4111-8111-111111111111", aud: "authenticated", client_id: crypto.randomUUID(), role: "authenticated", iat: now, exp: now + 300, scope: "email" })}`;
  const jwt = `${body}.${sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  const client = new Client({ name: "muse-oauth-happy-path", version: "1.0.0" });
  try {
    const metadata = protectedResourceMetadata();
    assert.equal(metadata.resource, "https://splitzii.example/mcp");
    assert.deepEqual(metadata.authorization_servers, [issuer]);
    assert.match(oauthChallenge(), /resource_metadata="https:\/\/splitzii.example\/\.well-known\/oauth-protected-resource\/mcp"/);
    const next = `/oauth/consent?authorization_id=${crypto.randomUUID()}`;
    assert.equal(consentReturnPath(next), next); // Survives the Google sign-in cookie round trip.
    await client.connect(new StreamableHTTPClientTransport(new URL(metadata.resource), {
      requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
      fetch: async (url, init) => {
        const request = new Request(url, init);
        return serveMcp(request, await requestStore(request, true));
      },
    }));
    assert.equal((await client.listTools()).tools.length, 9);
    const groups = await client.callTool({ name: "list_groups", arguments: {} });
    assert.deepEqual(groups.structuredContent, { data: [] });
    assert.equal(rpcAuthorization, `Bearer ${jwt}`);
  } finally {
    await client.close();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});
