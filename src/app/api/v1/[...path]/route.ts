import { dispatchRest } from "@/lib/rest";
import { requestStore } from "@/lib/store";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try { return await dispatchRest(request, await requestStore(request), (await context.params).path); }
  catch (error) { return errorResponse(error); }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
