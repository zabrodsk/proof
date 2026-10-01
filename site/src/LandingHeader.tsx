import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react";

const sections = [
  { id: "how-it-works", label: "How it works" },
  { id: "connect", label: "AI connections" },
  { id: "questions", label: "Questions" },
] as const;

export function Wordmark() {
  return (
    <a href="/" aria-label="Proof home" className="lp-wordmark">
      <img
        className="proof-logo-mark"
        src="/images/proof-logo-drawn-v1.png"
        alt=""
        width="44"
        height="44"
      />
      <span>
        proof<span>.</span>
      </span>
    </a>
  );
}

export default function LandingHeader({ appHref }: { appHref: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>();
  const menuToggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActive(sections.find(({ id }) => visible.has(id))?.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const { id } of sections) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuToggle.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !menuToggle.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("pointerdown", outside);
    };
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 961px)");
    const close = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);

  return (
    <header
      className="lp-bar"
      data-scrolled={scrolled || menuOpen || undefined}
    >
      <div className="lp-bar-inner">
        <div className="lp-bar-brand">
          <Wordmark />
        </div>
        <nav className="lp-bar-links" aria-label="Main navigation">
          {sections.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="lp-bar-actions">
          <a className="lp-bar-login" href={appHref}>
            Log in
            <ArrowRight size={16} aria-hidden="true" />
          </a>
          <button
            className="lp-bar-toggle"
            ref={menuToggle}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav
          ref={menu}
          id="mobile-navigation"
          className="lp-bar-menu"
          aria-label="Mobile navigation"
        >
          {sections.map(({ id, label }) => (
            <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
          <a
            className="lp-bar-menu-login"
            href={appHref}
            onClick={() => setMenuOpen(false)}
          >
            Log in to Proof <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        </nav>
      )}
    </header>
  );
}
