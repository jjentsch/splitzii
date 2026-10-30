import { serveMcp } from "@/lib/mcp-http";
import { errorResponse } from "@/lib/http";
import { requestStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response("Origin not allowed", { status: 403 });
  try {
    const store = await requestStore(request, true);
    return await serveMcp(request, store);
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: Request) {
  try {
    await requestStore(request, true);
    return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export function DELETE() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
