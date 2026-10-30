import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Splitzii — shared costs, simply", description: "Your personal shared-expense ledger. Keep track of who owes what, with your agent or on the web." };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
