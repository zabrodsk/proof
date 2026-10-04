import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  LogOut,
  PanelLeft,
  Plug,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { signOut, type Session } from "./studio-api";
import { appRoutes } from "./app-navigation";
import { useStudioPreferences } from "./studio-preferences";
import "./studio-settings.css";

export default function StudioSettings({
  session,
  persistent,
  onBack,
}: {
  session: Session;
  persistent: boolean;
  onBack: () => void;
}) {
  const {
    preferences,
    updatePreferences,
    error: preferenceError,
  } = useStudioPreferences(session.user?.id);
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  useEffect(() => {
    if (window.location.hash === "#privacy")
      document.getElementById("privacy")?.scrollIntoView({ block: "start" });
  }, []);
  const accountName = session.user?.name || "Local workspace";
  const nameParts = accountName.trim().split(/\s+/);
  const initials =
    nameParts.length > 1
      ? nameParts
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
      : accountName.slice(0, 2);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setAccountError("");
    try {
      await signOut(session);
    } catch (error) {
      setAccountError(
        (error as Error).message || "Could not sign out. Try again.",
      );
      setSigningOut(false);
    }
  }

  return (
    <div className="ps-settings">
      <a
        className="ps-settings-back"
        href={appRoutes.home}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          onBack();
        }}
      >
        <ArrowLeft size={16} /> My work
      </a>
      <div className="ps-settings-heading">
        <h1>Settings</h1>
      </div>

      <section
        className="ps-settings-card"
        aria-labelledby="studio-account-heading"
      >
        <div className="ps-settings-card-heading">
          <UserRound size={20} />
          <h2 id="studio-account-heading">Account</h2>
        </div>
        <div className="ps-settings-account">
          <span className="ps-settings-avatar" aria-hidden="true">
            {initials.toUpperCase()}
          </span>
          <div>
            <strong>{accountName}</strong>
            <span>
              {session.provider === "workos"
                ? "Signed in with WorkOS"
                : session.user
                  ? "Signed in with a Proof account"
                  : "Local workspace"}
            </span>
          </div>
        </div>
        <dl className="ps-settings-account-details">
          <div>
            <dt>Documents</dt>
            <dd>
              <Check size={15} />
              {persistent ? "Saved to your account" : "Saved in this browser"}
            </dd>
          </div>
          <div>
            <dt>Preferences</dt>
            <dd>Saved in this browser</dd>
          </div>
        </dl>
        {accountError && (
          <p className="ps-settings-error" role="alert">
            {accountError}
          </p>
        )}
        {(session.hosted || session.user) && (
          <div className="ps-settings-account-actions">
            <button
              className="ps-outline"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              <LogOut size={16} />
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        )}
      </section>

      <section
        className="ps-settings-card"
        aria-labelledby="studio-preferences-heading"
      >
        <div className="ps-settings-card-heading">
          <PanelLeft size={20} />
          <h2 id="studio-preferences-heading">Preferences</h2>
        </div>
        <div className="ps-settings-preference">
          <label htmlFor="studio-sidebar-preference">
            <strong>Sidebar</strong>
            <span>Choose how the navigation opens.</span>
          </label>
          <select
            id="studio-sidebar-preference"
            value={preferences.sidebarCollapsed ? "compact" : "expanded"}
            onChange={(event) => {
              setSaved(
                updatePreferences({
                  sidebarCollapsed: event.target.value === "compact",
                }),
              );
            }}
          >
            <option value="expanded">Expanded</option>
            <option value="compact">Compact</option>
          </select>
        </div>
        <div className="ps-settings-preference">
          <label htmlFor="studio-motion-preference">
            <strong>Page transitions</strong>
            <span>Your device's reduced motion setting always applies.</span>
          </label>
          <select
            id="studio-motion-preference"
            value={preferences.motion}
            onChange={(event) => {
              setSaved(
                updatePreferences({
                  motion:
                    event.target.value === "reduced" ? "reduced" : "system",
                }),
              );
            }}
          >
            <option value="system">Follow device setting</option>
            <option value="reduced">Reduce motion</option>
          </select>
        </div>
        <div className="ps-settings-save-status" aria-live="polite">
          {preferenceError ? (
            <p className="ps-settings-error" role="alert">
              {preferenceError}
            </p>
          ) : saved ? (
            <p>
              <Check size={15} /> Saved in this browser.
            </p>
          ) : (
            <p>Changes save automatically for this account in this browser.</p>
          )}
        </div>
      </section>

      <section
        className="ps-settings-card"
        id="privacy"
        aria-labelledby="studio-privacy-heading"
      >
        <div className="ps-settings-card-heading">
          <ShieldCheck size={20} />
          <h2 id="studio-privacy-heading">Privacy &amp; processing</h2>
        </div>
        <label className="ps-privacy-choice">
          <input
            type="checkbox"
            checked={preferences.aiProcessing}
            onChange={(event) =>
              setSaved(
                updatePreferences({
                  privacyReviewed: true,
                  aiProcessing: event.target.checked,
                }),
              )
            }
          />
          <span>
            <strong>Allow AI processing</strong>
            <small>
              Send your text and selected source passages to AI providers to
              check claims and citations. Turning this off prevents new checks.
            </small>
          </span>
        </label>
        <label className="ps-privacy-choice">
          <input
            type="checkbox"
            checked={preferences.retrieveCitedWorks}
            onChange={(event) =>
              setSaved(
                updatePreferences({
                  privacyReviewed: true,
                  retrieveCitedWorks: event.target.checked,
                }),
              )
            }
          />
          <span>
            <strong>Retrieve cited works</strong>
            <small>
              Allow Proof to look up and retrieve bibliography works by default.
              Override this for a check under More options.
            </small>
          </span>
        </label>
        <p className="ps-analysis-intro">
          Changes save for this account in this browser. Turning off permissions
          does not cancel a check already running.
        </p>
      </section>

      <section
        className="ps-settings-card ps-settings-connect"
        aria-labelledby="studio-connections-heading"
      >
        <div className="ps-settings-card-heading">
          <Plug size={20} />
          <h2 id="studio-connections-heading">Connected apps</h2>
        </div>
        <a href={appRoutes.connections}>
          <span>
            <strong>Connect ChatGPT or Claude</strong>
            <span>Run Proof checks from your chat.</span>
          </span>
          <ArrowUpRight size={20} />
        </a>
      </section>
    </div>
  );
}
