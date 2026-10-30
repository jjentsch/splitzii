import { LedgerError } from "./ledger";

// Supabase owns client registration, PKCE, grants, and token refresh.
export function appOrigin() {
  return new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
}

export function oauthIssuer() {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
}

export function protectedResourceMetadata() {
  return {
    resource: `${appOrigin()}/mcp`,
    authorization_servers: [oauthIssuer()],
    bearer_methods_supported: ["header"],
    scopes_supported: ["email"],
    resource_name: "Splitzii ledger",
  };
}

export function oauthChallenge() {
  return `Bearer resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource/mcp"`;
}

export function authorizationId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new LedgerError("INVALID_INPUT", "Open this connection again from your agent.", 400);
  return value;
}

// Only the consent screen is a supported post-Google destination.
export function consentReturnPath(value: string | null | undefined) {
  if (!value) return "/";
  try {
    const url = new URL(value, "https://splitzii.invalid");
    if (url.origin !== "https://splitzii.invalid" || url.pathname !== "/oauth/consent") return "/";
    return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId(url.searchParams.get("authorization_id")))}`;
  } catch { return "/"; }
}

export function validAgentClaims(claims: Record<string, unknown>) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return claims.iss === oauthIssuer() && audiences.includes("authenticated") &&
    typeof claims.sub === "string" && Boolean(claims.sub) &&
    typeof claims.client_id === "string" && Boolean(claims.client_id);
}
