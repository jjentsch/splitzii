import { execute, type Action, type LedgerStore } from "./ledger";
import { errorResponse, json } from "./http";

export async function dispatchRest(request: Request, store: LedgerStore, path: string[]) {
  try {
    const [resource, groupId, collection, entryId] = path;
    const method = request.method;
    const body = ["POST", "PATCH"].includes(method) ? await request.json() : {};
    let action: Action | undefined;
    let args: object = body;
    if (resource === "groups" && path.length === 1) {
      if (method === "GET") action = "list_groups";
      if (method === "POST") action = "create_group";
    } else if (resource === "groups" && path.length === 2 && method === "GET") {
      action = "get_group"; args = { group_id: groupId };
    } else if (resource === "groups" && path.length === 3 && method === "POST") {
      action = collection === "participants" ? "add_participant" : collection === "expenses" ? "add_expense" : collection === "repayments" ? "record_repayment" : undefined;
      args = { ...body, group_id: groupId };
    } else if (resource === "groups" && path.length === 4) {
      if (collection === "expenses" && method === "PATCH") action = "update_expense";
      if (collection === "expenses" && method === "DELETE") action = "delete_expense";
      if (collection === "repayments" && method === "DELETE") action = "delete_repayment";
      args = { ...body, group_id: groupId, ...(collection === "expenses" ? { expense_id: entryId } : { repayment_id: entryId }) };
    }
    if (!action) return Response.json({ error: { code: "NOT_FOUND", message: "Unknown API operation." } }, { status: 404 });
    return json(await execute(store, action, args));
  } catch (error) { return errorResponse(error); }
}

