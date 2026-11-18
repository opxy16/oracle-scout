import { Github } from "lucide-react";

const REPO = "https://github.com/opxy16/oracle-scout";

/** Seal mark: a ring of chain links around a scout's crosshair. */
export function SealMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M20 5v8M20 27v8M5 20h8M27 20h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="3" fill="rgb(var(--tag-soft))" />
    </svg>
  );
}

export function SiteHeader({ current }: { current: "home" | "owner" }) {
  const links: [string, string, boolean][] = [
    ["Evidence", "/#evidence", false],
    ["Audit trail", "/#custody", false],
    ["Owner proof", "/owner", current === "owner"],
    ["Connect", "/#connect", false],
  ];
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-5">
      <a href="/" className="flex items-center gap-2.5 text-ink" aria-label="Oracle Scout home">
        <SealMark />
        <span className="display-sm text-lg">Oracle Scout</span>
      </a>
      <nav aria-label="Main" className="-mx-2 flex items-center gap-0.5 text-sm text-ink2 sm:mx-0">
        {links.map(([label, href, active]) => (
          <a
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2 py-1.5 transition-colors hover:bg-rule/50 hover:text-ink sm:px-3 ${label === "Connect" ? "hidden md:block" : ""} ${active ? "bg-rule/60 text-ink" : ""}`}
          >
            {label}
          </a>
        ))}
        <a aria-label="Source code on GitHub" className="ml-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:bg-rule/50 hover:text-ink" href={REPO}>
          <Github className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Source</span>
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter({ source }: { source?: string }) {
  return (
    <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-rule py-6 text-xs text-ink2">
      <p>
        Oracle Scout, built for the Concordium Trusted Agents Hackathon and the Delphi Agent Arena.{source ? ` Ledger read from ${source}.` : ""}
      </p>
      <a className="hover:text-ink" href={REPO}>
        MIT licence, source on GitHub
      </a>
    </footer>
  );
}
