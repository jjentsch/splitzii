import { ZodError } from "zod";
import { LedgerError } from "./ledger";

export const noStore = { "Cache-Control": "no-store" };
export function json(data: unknown, status = 200) {
  return Response.json({ data }, { status, headers: noStore });
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: { code: "INVALID_INPUT", message: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") } }, { status: 400, headers: noStore });
  if (error instanceof LedgerError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: noStore });
  if (error instanceof SyntaxError) return Response.json({ error: { code: "INVALID_INPUT", message: "Send a valid JSON body." } }, { status: 400, headers: noStore });
  console.error("Splitzii request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, { status: 500, headers: noStore });
}
