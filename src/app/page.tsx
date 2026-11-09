import { cookies } from "next/headers";
import LedgerApp from "@/components/ledger-app";

export default async function Home() {
  // A hint only: /api/session still verifies (and refreshes) the session.
  const signedIn = (await cookies()).getAll().some(cookie => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name) && cookie.value);
  return <LedgerApp signedIn={Boolean(signedIn)} />;
}
