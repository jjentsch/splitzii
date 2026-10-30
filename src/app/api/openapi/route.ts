import { z } from "zod";
import { schemas } from "@/lib/ledger";

import { operations } from "@/lib/rest";

export function GET(request: Request) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, method, action] of operations) {
    const schema = z.toJSONSchema(schemas[action], { io: "input" });
    delete schema.$schema;
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map(match => ({ name: match[1], in: "path", required: true, schema: { type: "string", format: "uuid" } }));
    for (const parameter of parameters) { if (schema.properties) delete schema.properties[parameter.name]; }
    if (schema.required) schema.required = schema.required.filter((name: string) => !parameters.some(p => p.name === name));
    if (method === "get") {
      for (const [name, property] of Object.entries(schema.properties || {})) parameters.push({ name, in: "query", required: schema.required?.includes(name) || false, schema: property } as typeof parameters[number]);
    }
    paths[path] ||= {};
    paths[path][method] = {
      operationId: action, parameters, security: [{ oauth: ["email"] }],
      ...(["post", "patch"].includes(method) ? { requestBody: { required: true, content: { "application/json": { schema } } } } : {}),
      responses: { "200": { description: "JSON { data: result }. Group responses contain participants, expenses, shares, repayments, balances, and suggested_repayments. Positive balances mean owed money; negative balances mean owes money." }, "400": { description: "Invalid input: { error: { code, message } }" }, "401": { description: "Google sign-in required" }, "404": { description: "Group or entry not found" }, "409": { description: "Request or version conflict" } },
    };
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return Response.json({ openapi: "3.1.0", info: { title: "Splitzii ledger API", version: "0.3.0", description: "Personal ledger only. No money movement. Equal splits, one currency with integer cents. Create operations require a UUID request_id; reuse it for retries. Groups are shared with explicitly linked members. Friends remain private." }, servers: [{ url: `${origin}/api/v1` }], paths, components: { securitySchemes: { oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/oauth/authorize`, tokenUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/oauth/token`, scopes: { email: "Sign in and connect your ledger" } } } } } } }, { headers: { "Cache-Control": "no-store" } });
}
