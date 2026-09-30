import { useEffect, useState } from "react";
import { api, type Session } from "./studio-api";

// Every app entry point uses the same refresh and expired-session behavior.
export function useStudioSession() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void api<Session>("/api/session")
        .then((value) => {
          if (!disposed) {
            setSession(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return { session, setSession, error, setError };
}
