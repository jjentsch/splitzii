import { execute, type Action, type LedgerStore } from "./ledger";
import { errorResponse, json } from "./http";

// One route map also drives OpenAPI, so each tool has a discoverable HTTP route.
export const operations: [string, string, Action][] = [
  ["/me", "get", "get_current_user"], ["/users/resolve", "get", "resolve_user"],
  ["/friends", "get", "list_friends"], ["/friends", "post", "add_friend"],
  ["/friends/{friend_id}", "delete", "remove_friend"],
  ["/activity", "get", "get_activity"], ["/expenses", "get", "list_expenses"],
  ["/groups/resolve", "get", "resolve_group"],
  ["/groups", "get", "list_groups"], ["/groups", "post", "create_group"],
  ["/groups/{group_id}", "get", "get_group"],
  ["/groups/{group_id}/participants/resolve", "get", "resolve_participant"],
  ["/groups/{group_id}/participants", "post", "add_participant"],
  ["/groups/{group_id}/participants/{participant_id}", "patch", "link_participant"],
  ["/groups/{group_id}/expenses", "post", "add_expense"],
  ["/groups/{group_id}/expenses/{expense_id}", "get", "get_expense"],
  ["/groups/{group_id}/expenses/{expense_id}", "patch", "update_expense"],
  ["/groups/{group_id}/expenses/{expense_id}", "delete", "delete_expense"],
  ["/groups/{group_id}/expenses/{expense_id}/restore", "post", "restore_expense"],
  ["/groups/{group_id}/repayments", "post", "record_repayment"],
  ["/groups/{group_id}/repayments/{repayment_id}", "delete", "delete_repayment"],
];

export async function dispatchRest(request: Request, store: LedgerStore, path: string[]) {
  try {
    for (const [pattern, method, action] of operations) {
      if (request.method.toLowerCase() !== method) continue;
      const segments = pattern.slice(1).split("/");
      if (segments.length !== path.length) continue;
      const parameters: Record<string, string> = {};
      if (!segments.every((segment, i) => {
        const match = /^\{(\w+)\}$/.exec(segment);
        if (match) { parameters[match[1]] = path[i]; return true; }
        return segment === path[i];
      })) continue;
      const body = ["post", "patch"].includes(method) ? await request.text() : "";
      const query: Record<string, unknown> = Object.fromEntries(new URL(request.url).searchParams);
      if (typeof query.participant === "string" && query.participant.startsWith("{")) query.participant = JSON.parse(query.participant);
      return json(await execute(store, action, { ...query, ...(body ? JSON.parse(body) : {}), ...parameters }));
    }
    return Response.json({ error: { code: "NOT_FOUND", message: "Unknown API operation." } }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
