import { useState, type ReactNode } from "react";
import Studio from "./Studio";
import { api, type Session } from "./studio-api";
import { useStudioSession } from "./studio-session";
import "./studio.css";
import "./app-motion.css";
import InviteCode from "./InviteCode";
import { useStudioPreferences } from "./studio-preferences";
export default function StudioSession({ children }: { children?: ReactNode }) {
  const { session, setSession, error, setError } = useStudioSession();
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const {
    preferences,
    updatePreferences,
    error: preferenceError,
  } = useStudioPreferences(session?.user?.id);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [retrieveCitedWorks, setRetrieveCitedWorks] = useState(false);
  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search + window.location.hash,
  );
  if (session?.authenticated) {
    if (session.inviteRequired)
      return <InviteCode session={session} onAccepted={setSession} />;
    if (!preferences.privacyReviewed)
      return (
        <main className="proof-studio ps-signin">
          <section className="ps-modal" aria-labelledby="privacy-welcome-title">
            <a href="/" className="ps-brand">
              proof.
            </a>
            <h1 id="privacy-welcome-title">
              Choose how Proof processes your work
            </h1>
            <p>
              You can change these choices in Settings → Privacy &amp;
              processing.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                updatePreferences({
                  privacyReviewed: true,
                  aiProcessing,
                  retrieveCitedWorks,
                });
              }}
            >
              <label className="ps-privacy-choice">
                <input
                  type="checkbox"
                  checked={aiProcessing}
                  onChange={(event) => setAiProcessing(event.target.checked)}
                />
                <span>
                  <strong>Allow AI processing</strong>
                  <small>
                    Send your text and selected source passages to AI providers
                    to check claims and citations. Checks require this
                    permission.
                  </small>
                </span>
              </label>
              <label className="ps-privacy-choice">
                <input
                  type="checkbox"
                  checked={retrieveCitedWorks}
                  onChange={(event) =>
                    setRetrieveCitedWorks(event.target.checked)
                  }
                />
                <span>
                  <strong>Retrieve cited works</strong>
                  <small>
                    Allow Proof to look up and retrieve works listed in your
                    bibliography. Citation checks will not search for unrelated
                    sources.
                  </small>
                </span>
              </label>
              {preferenceError && <p role="alert">{preferenceError}</p>}
              <p>These choices are saved for this account in this browser.</p>
              <button className="ps-primary" type="submit">
                Save choices and continue
              </button>
            </form>
          </section>
        </main>
      );
    return (
      children || <Studio key={session.user?.id || "local"} session={session} />
    );
  }
  return (
    <main className="proof-studio ps-signin">
      <section className="ps-modal">
        <a href="/" className="ps-brand">
          proof.
        </a>
        <h1>{register ? "Create your account" : "Sign in to Proof"}</h1>
        {error && <p role="alert">{error}</p>}
        {!session ? (
          <p role="status">
            {error ? "Reload to try again." : "Opening your workspace..."}
          </p>
        ) : session.provider === "workos" ? (
          <div className="ps-actions">
            <a className="ps-primary" href={`/auth/login?returnTo=${returnTo}`}>
              Sign in
            </a>
            <a
              className="ps-outline"
              href={`/auth/login?screen=sign-up&returnTo=${returnTo}`}
            >
              Create account
            </a>
          </div>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true);
              setError("");
              try {
                setSession(
                  await api<Session>("/api/session", {
                    name: data.get("name"),
                    password: data.get("password"),
                    register,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="ps-field-label">
              Username
              <input
                className="ps-field"
                name="name"
                autoComplete="username"
                minLength={2}
                maxLength={60}
                required
              />
            </label>
            <label className="ps-field-label">
              Password
              <input
                className="ps-field"
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            <div className="ps-actions">
              <button className="ps-primary" disabled={busy}>
                {busy
                  ? "Please wait..."
                  : register
                    ? "Create account"
                    : "Sign in"}
              </button>
              <button
                className="ps-outline"
                type="button"
                onClick={() => setRegister(!register)}
              >
                {register ? "Sign in instead" : "Create account"}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
