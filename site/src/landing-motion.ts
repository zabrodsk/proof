import { useEffect, useRef } from "react";

const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

export function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = root.current;
    if (!page || !page.animate) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const running = new Set<Animation>();
    const disclosures = new Map<
      HTMLDetailsElement,
      { animation: Animation; open: boolean; overflow: string }
    >();
    let observer: IntersectionObserver | undefined;
    const track = (animation: Animation) => {
      running.add(animation);
      animation.addEventListener("finish", () => running.delete(animation), {
        once: true,
      });
      animation.addEventListener("cancel", () => running.delete(animation), {
        once: true,
      });
      return animation;
    };
    const reveal = () => {
      observer?.disconnect();
      if (preference.matches || !("IntersectionObserver" in window)) return;
      const selector =
        ".lp-intro-copy > *, .lp-intro-art, .lp-used-heading, .lp-used-row > li, .lp-compare-intro, .lp-compare-card, .lp-how-intro, .lp-process-steps > li, .lp-process-finish, .lp-connect-copy, .lp-connect-platform, .lp-faq-intro, .lp-faq-list > details, .lp-final-content, .lp-footer";
      observer = new IntersectionObserver(
        (entries) => {
          if (preference.matches) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const element = entry.target as HTMLElement;
            observer?.unobserve(element);
            const siblings = [
              ...(element.parentElement?.children || []),
            ].filter((child) => child.matches(selector));
            const delay = Math.min(siblings.indexOf(element), 3) * 45;
            track(
              element.animate(
                [
                  { opacity: 0, translate: "0 10px" },
                  { opacity: 1, translate: "0 0" },
                ],
                { duration: 500, delay, easing: ease },
              ),
            );
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -20px 0px" },
      );
      page
        .querySelectorAll(selector)
        .forEach((element) => observer?.observe(element));
    };
    const click = (event: MouseEvent) => {
      if (preference.matches || !(event.target instanceof Element)) return;
      if (event.target.closest("a, button, input")) return;
      const summary = event.target.closest("summary");
      const details = summary?.parentElement;
      if (!(details instanceof HTMLDetailsElement) || !page.contains(details))
        return;
      event.preventDefault();
      const previous = disclosures.get(details);
      const open = !(previous?.open ?? details.open);
      const start = details.getBoundingClientRect().height;
      previous?.animation.cancel();
      details.open = open;
      const end = details.getBoundingClientRect().height;
      // Keep the content present while closing, so the text clips with the row.
      if (!open) details.open = true;
      const overflow = previous?.overflow ?? details.style.overflow;
      details.style.overflow = "hidden";
      const animation = track(
        details.animate([{ height: `${start}px` }, { height: `${end}px` }], {
          duration: 260,
          easing: ease,
        }),
      );
      disclosures.set(details, { animation, open, overflow });
      const cleanup = () => {
        if (disclosures.get(details)?.animation !== animation) return;
        details.style.overflow = overflow;
        disclosures.delete(details);
      };
      animation.onfinish = () => {
        if (disclosures.get(details)?.animation !== animation) return;
        details.open = open;
        cleanup();
      };
      animation.oncancel = cleanup;
    };
    const change = () => {
      for (const [details, state] of disclosures) details.open = state.open;
      for (const animation of running) animation.cancel();
      reveal();
    };
    reveal();
    page.addEventListener("click", click);
    preference.addEventListener("change", change);
    return () => {
      observer?.disconnect();
      for (const [details, state] of disclosures) details.open = state.open;
      for (const animation of running) animation.cancel();
      page.removeEventListener("click", click);
      preference.removeEventListener("change", change);
    };
  }, []);
  return root;
}
