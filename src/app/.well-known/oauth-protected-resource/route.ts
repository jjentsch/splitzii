import { protectedResourceMetadata } from "@/lib/oauth";

export function GET() {
  return Response.json(protectedResourceMetadata(), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
