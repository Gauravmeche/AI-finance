import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLinks } from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-edge bg-surface sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-4 flex items-center gap-6 h-12">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="font-semibold tracking-tight">IPO LOCK-IN</span>
            <span className="text-[10px] text-accent border border-accent/40 rounded px-1 uppercase tracking-widest">India</span>
          </Link>
          <NavLinks isAdmin={session?.role === "ADMIN"} />
          <div className="ml-auto flex items-center gap-3 text-[12px] text-muted shrink-0">
            {session && (
              <>
                <span className="hidden sm:inline">
                  {session.name} · <span className="uppercase text-[10px] tracking-wider">{session.role}</span>
                </span>
                <LogoutButton />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 py-5">{children}</main>

      <footer className="border-t border-edge mt-8">
        <div className="max-w-[1400px] mx-auto px-4 py-4 text-[11px] text-muted leading-relaxed">
          Lock-in dates are compiled from publicly available regulatory filings, exchange disclosures, company
          documents, and other sources. Users should verify material investment decisions against the underlying
          primary documentation. The system does not constitute investment advice.
        </div>
      </footer>
    </div>
  );
}
