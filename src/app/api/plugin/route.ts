import { readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const files = ["plugin.json", "skills/manage-shared-expenses/SKILL.md", "skills/explain-balances/SKILL.md", "skills/check-group-activity/SKILL.md"];
  const archive: Record<string, Uint8Array> = {};
  const contents = await Promise.all(files.map(file => readFile(path.join(process.cwd(), "plugin", file))));
  files.forEach((file, index) => { archive[`splitzii/${file}`] = new Uint8Array(contents[index]); });
  archive["splitzii/mcp.json"] = strToU8(JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { splitzii: { type: "streamable-http", url: `${origin}/mcp`, extensions: { "com.openai": { auth: { type: "oauth", client: { mode: "dcr" } } } } } },
  }, null, 2));
  return new Response(zipSync(archive), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="splitzii-plugin.zip"', "Cache-Control": "no-store" } });
}
