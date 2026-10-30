import { z } from "zod";
import { schemas, type Action } from "@/lib/ledger";

export function GET(request: Request) {
  const paths: Record<string, Record<string, unknown>> = {};
  const operations: [string, string, Action][] = [
    ["/groups", "get", "list_groups"], ["/groups", "post", "create_group"],
    ["/groups/{group_id}", "get", "get_group"],
    ["/groups/{group_id}/participants", "post", "add_participant"],
    ["/groups/{group_id}/expenses", "post", "add_expense"],
    ["/groups/{group_id}/expenses/{expense_id}", "patch", "update_expense"],
    ["/groups/{group_id}/expenses/{expense_id}", "delete", "delete_expense"],
    ["/groups/{group_id}/repayments", "post", "record_repayment"],
    ["/groups/{group_id}/repayments/{repayment_id}", "delete", "delete_repayment"],
  ];
  for (const [path, method, action] of operations) {
    const schema = z.toJSONSchema(schemas[action], { io: "input" });
    delete schema.$schema;
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map(match => ({ name: match[1], in: "path", required: true, schema: { type: "string", format: "uuid" } }));
    for (const parameter of parameters) { if (schema.properties) delete schema.properties[parameter.name]; }
    if (schema.required) schema.required = schema.required.filter((name: string) => !parameters.some(p => p.name === name));
    paths[path] ||= {};
    paths[path][method] = {
      operationId: action, parameters, security: [{ oauth: ["email"] }],
      ...(["post", "patch"].includes(method) ? { requestBody: { required: true, content: { "application/json": { schema } } } } : {}),
      responses: { "200": { description: "JSON { data: result }. Group responses contain participants, expenses, shares, repayments, balances, and suggested_repayments. Positive balances mean owed money; negative balances mean owes money." }, "400": { description: "Invalid input: { error: { code, message } }" }, "401": { description: "Google sign-in required" }, "404": { description: "Group or entry not found" }, "409": { description: "Request or version conflict" } },
    };
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return Response.json({ openapi: "3.1.0", info: { title: "Splitzii ledger API", version: "0.2.0", description: "Personal ledger only. No money movement. Equal splits, one currency with integer cents. Create operations require a UUID request_id; reuse it for retries. All records are private to the authenticated owner." }, servers: [{ url: `${origin}/api/v1` }], paths, components: { securitySchemes: { oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/oauth/authorize`, tokenUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/oauth/token`, scopes: { email: "Sign in and connect your private ledger" } } } } } } }, { headers: { "Cache-Control": "no-store" } });
}
