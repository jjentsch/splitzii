import { LedgerError } from "./ledger";

export function databaseError(error: { code?: string; message: string }): never {
  if (error.code === "28000") throw new LedgerError("UNAUTHENTICATED", "Sign in with Google to connect your agent.", 401);
  if (error.code === "40001") throw new LedgerError("VERSION_CONFLICT", "The group changed. Please try again.", 409);
  if (error.code === "42501") throw new LedgerError("FORBIDDEN", "You do not have access to this ledger.", 403);
  if (error.code === "P0002") throw new LedgerError("NOT_FOUND", "Group not found.", 404);
  if (error.code === "22023" || error.code === "23505") throw new LedgerError("INVALID_INPUT", error.code === "23505" ? "That person is already in this group or friend list." : error.message, 400);
  console.error("Supabase operation failed", { code: error.code });
  throw new LedgerError("STORAGE_ERROR", "Could not save or load the ledger. Please try again.", 503);
}

