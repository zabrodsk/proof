import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { api, signOut, type Session } from "./studio-api";
import "./invite-code.css";

export default function InviteCode({
  session,
  onAccepted,
}: {
  session: Session;
  onAccepted: (session: Session) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/invite", { code });
      onAccepted(await api<Session>("/api/session"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="proof-studio ps-signin proof-invite">
      <section className="ps-modal" aria-labelledby="invite-title">
        <a href="/" className="ps-brand">
          proof.
        </a>
        <LockKeyhole
          className="proof-invite-icon"
          size={28}
          aria-hidden="true"
        />
        <h1 id="invite-title">Invite Only</h1>
        <p>Enter your four-digit invite code to open Proof.</p>
        <form onSubmit={redeem}>
          <label className="ps-field-label" htmlFor="invite-code">
            Invite code
          </label>
          <input
            id="invite-code"
            className="ps-field proof-invite-input"
            name="code"
            type="text"
            inputMode="numeric"
            enterKeyHint="go"
            autoComplete="off"
            pattern="[0-9]{4}"
            minLength={4}
            maxLength={4}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/[^0-9]/g, ""));
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "invite-error" : undefined}
            autoFocus
            required
          />
          {error && (
            <p id="invite-error" role="alert">
              {error}
            </p>
          )}
          <button className="ps-primary" disabled={busy || code.length !== 4}>
            {busy ? "Checking code..." : "Open Proof"}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>
        <p className="proof-invite-account">
          Signed in as {session.user?.name}
        </p>
        <button
          className="proof-invite-signout"
          onClick={() => {
            void signOut(session).catch((e) => setError(e.message));
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
