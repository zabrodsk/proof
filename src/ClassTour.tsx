import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { BotAvatar, type BotAvatarState } from "bot-avatars";
import "./class-tour.css";
type Tab = "draft" | "find" | "sources" | "review";
function Pip({ state, onPoke }: { state: BotAvatarState; onPoke: () => void }) {
  return (
    <div className="pip-avatar">
      <div className="pip-render">
        <BotAvatar
          type="clover"
          face="mouth"
          color="#73b49b"
          saturation={1}
          shading="plastic"
          theme="light"
          size={192}
          depth={0.85}
          shadow={0.5}
          highlight={0.9}
          rim={0.65}
          spread={0.9}
          state={state}
          interactive={false}
          jumpEvery={0}
          turn={0}
          jumpHeight={22}
          speed={0.85}
          role="button"
          tabIndex={0}
          aria-label={state === "sleeping" ? "Wake Pip up" : "Give Pip a boop"}
          onClick={onPoke}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        />
      </div>
    </div>
  );
}
const hints: { tab: Tab; target: string; text: string }[] = [
  {
    tab: "draft",
    target: "modes",
    text: "Need sources? Pick Find sources. Already have them? Check with my sources. Or let Proof look for public research.",
  },
  {
    tab: "draft",
    target: "draft",
    text: "Or paste your draft here. Yes, even the slightly cooked version.",
  },
  {
    tab: "find",
    target: "find",
    text: "Got a claim with no receipts? Pick a sentence here and find some sources.",
  },
  {
    tab: "sources",
    target: "sources",
    text: "Paste an article link or upload its PDF here for an MLA citation. Check the printed page numbers before citing.",
  },
  {
    tab: "review",
    target: "review",
    text: "This extra check looks at the class requirements and your page citations. Open the findings and read the evidence.",
  },
  {
    tab: "draft",
    target: "cost",
    text: "That's your estimated AI cost in USD. Hosting isn't part of the tab.",
  },
];
export default function ClassTour({
  userId,
  onTab,
  disabled,
}: {
  userId: string;
  onTab: (tab: Tab) => void;
  disabled: boolean;
  currentTab: Tab;
}) {
  const storageKey = `proof-pip-onboarding-v2:${userId}`;
  const [hidden, setHidden] = useState(true);
  const [sleeping, setSleeping] = useState(false);
  const [speech, setSpeech] = useState(
    "hey, I'm Pip. want a quick look around?",
  );
  const [step, setStep] = useState(-1);
  const body = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGPathElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const point = useRef<string | null>(null);
  const position = useRef({ x: 0, y: 0 });
  const destination = useRef({ x: 0, y: 0 });
  const lastActivity = useRef(Date.now());
  const interacting = useRef(false);
  const boops = useRef(0);
  const guideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stateRef = useRef({ hidden, step });
  stateRef.current = { hidden, step };
  function dismiss() {
    setHidden(true);
    point.current = null;
    try {
      localStorage.setItem(storageKey, "seen");
    } catch {
      /* Optional preference. */
    }
    requestAnimationFrame(() => returnButton.current?.focus());
  }
  function show() {
    setHidden(false);
    setStep(-1);
    setSleeping(false);
    point.current = null;
    lastActivity.current = Date.now();
    setSpeech("hey again. ready for a look around?");
  }
  function guide() {
    if (step === hints.length - 1) {
      dismiss();
      return;
    }
    const next = step + 1;
    const hint = hints[next];
    setStep(next);
    setSpeech(hint.text);
    setSleeping(false);
    onTab(hint.tab);
    clearTimeout(guideTimer.current);
    guideTimer.current = setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-tour="${hint.target}"]`,
      );
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const header =
        document.querySelector(".class-header")?.getBoundingClientRect()
          .height || 80;
      if (rect.top < header + 20 || rect.bottom > innerHeight - 80) {
        window.scrollTo({
          top: Math.max(0, scrollY + rect.top - header - 30),
          behavior: "instant",
        });
      }
      point.current = hint.target;
    }, 0);
  }
  function boop() {
    setSleeping(false);
    lastActivity.current = Date.now();
    if (step >= 0) return;
    const lines = [
      "boop. shall I show you around?",
      "I'm paid in footnotes. ready?",
      "your tiny citation goblin, reporting for duty.",
    ];
    setSpeech(lines[boops.current++ % lines.length]);
  }
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(storageKey) === "seen");
    } catch {
      setHidden(false);
    }
    return () => clearTimeout(guideTimer.current);
  }, [storageKey]);
  useEffect(() => {
    if (disabled) dismiss();
  }, [disabled]);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const initial = {
      x: Math.max(16, innerWidth - 150),
      y: Math.max(150, innerHeight - 160),
    };
    position.current = initial;
    destination.current = { ...initial };
    let frame = 0,
      lastTime = 0;
    function wake() {
      lastActivity.current = Date.now();
      setSleeping(false);
    }
    function keys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!stateRef.current.hidden) dismiss();
        return;
      }
      wake();
    }
    function loop(time: number) {
      const dt = Math.min(64, time - (lastTime || time));
      lastTime = time;
      const now = Date.now();
      if (!document.hidden && !stateRef.current.hidden && body.current) {
        if (now - lastActivity.current > 30000 && stateRef.current.step < 0)
          setSleeping(true);
        const target = point.current
          ? document
              .querySelector(`[data-tour="${point.current}"]`)
              ?.getBoundingClientRect()
          : undefined;
        if (target) {
          destination.current = {
            x:
              target.right + 25 < innerWidth - 120
                ? target.right + 25
                : Math.max(20, target.right - 105),
            y:
              target.bottom + 40 < innerHeight - 125
                ? target.bottom + 40
                : target.top - 120,
          };
        }
        const maxX = Math.max(12, innerWidth - 116),
          maxY = Math.max(12, innerHeight - 116);
        destination.current.x = Math.min(
          maxX,
          Math.max(20, destination.current.x),
        );
        destination.current.y = Math.min(
          maxY,
          Math.max(30, destination.current.y),
        );
        if (reduced.matches && !target)
          destination.current = { x: maxX, y: maxY };
        const ease = reduced.matches ? 1 : 1 - Math.exp(-dt / 220);
        if (target || !interacting.current) {
          position.current.x +=
            (destination.current.x - position.current.x) * ease;
          position.current.y +=
            (destination.current.y - position.current.y) * ease;
        }
        const { x, y } = position.current;
        body.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        body.current.dataset.vertical =
          innerWidth > 650 ? "side" : y < 190 ? "below" : "above";
        const bubbleWidth = Math.min(225, innerWidth - 40);
        const bubbleLeft = Math.max(
          12,
          Math.min(
            innerWidth - bubbleWidth - 12,
            innerWidth > 650
              ? x < innerWidth / 2
                ? x + 110
                : x - bubbleWidth - 18
              : x < innerWidth / 2
                ? x
                : x + 96 - bubbleWidth,
          ),
        );
        body.current.style.setProperty(
          "--pip-speech-left",
          `${bubbleLeft - x}px`,
        );
        if (arrow.current) {
          if (target && target.bottom > 0 && target.top < innerHeight) {
            const ex = Math.max(
              target.left + 8,
              Math.min(target.right - 8, x + 48),
            );
            const ey = y > target.bottom ? target.bottom + 5 : target.top - 5;
            const sx = x + 48,
              sy = y > target.bottom ? y + 12 : y + 80;
            arrow.current.setAttribute(
              "d",
              `M ${sx} ${sy} Q ${sx + 35} ${(sy + ey) / 2} ${ex} ${ey}`,
            );
          } else arrow.current.setAttribute("d", "");
        }
      }
      frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", keys);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", keys);
    };
  }, []);
  return (
    <>
      <button
        ref={returnButton}
        className="pip-return"
        hidden={!hidden}
        onClick={show}
      >
        Replay intro
      </button>
      {!hidden && (
        <>
          <svg className="pip-pointer" aria-hidden="true">
            <defs>
              <marker
                id="pip-arrow-tip"
                viewBox="0 0 12 12"
                refX="10"
                refY="6"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path
                  d="M2 2 10 6 2 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            <path
              ref={arrow}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeLinecap="round"
              markerEnd="url(#pip-arrow-tip)"
            />
          </svg>
          <div
            ref={body}
            className="pip-roamer"
            aria-label="Pip, your onboarding guide"
            onPointerEnter={() => {
              interacting.current = true;
            }}
            onPointerLeave={() => {
              interacting.current = false;
            }}
            onFocusCapture={() => {
              interacting.current = true;
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                interacting.current = false;
            }}
          >
            <div className="pip-speech">
              <p role="status">{speech}</p>
              <div className="pip-replies">
                <button disabled={disabled} onClick={guide}>
                  {step === hints.length - 1
                    ? "got it"
                    : step >= 0
                      ? "what else?"
                      : "show me"}
                  <ArrowUpRight size={13} />
                </button>
                <button aria-label="Finish onboarding" onClick={dismiss}>
                  I'm good
                </button>
                <button aria-label="Send Pip away" onClick={dismiss}>
                  <X size={13} />
                </button>
              </div>
            </div>
            <Pip
              state={sleeping && step < 0 ? "sleeping" : "default"}
              onPoke={boop}
            />
          </div>
        </>
      )}
    </>
  );
}
