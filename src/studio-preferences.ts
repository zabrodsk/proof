import { useCallback, useEffect, useState } from "react";

export interface StudioPreferences {
  sidebarCollapsed: boolean;
  motion: "system" | "reduced";
}

export const defaultStudioPreferences: Readonly<StudioPreferences> = {
  sidebarCollapsed: false,
  motion: "system",
};

const changeEvent = "proof:studio-preferences-changed";

export function studioPreferencesKey(userId?: string) {
  return `proof.preferences.v1:${userId || "local"}`;
}

function normalizePreferences(value: unknown): StudioPreferences {
  if (!value || typeof value !== "object")
    return { ...defaultStudioPreferences };
  const saved = value as Partial<StudioPreferences>;
  return {
    sidebarCollapsed: saved.sidebarCollapsed === true,
    motion: saved.motion === "reduced" ? "reduced" : "system",
  };
}

export function readStudioPreferences(userId?: string): StudioPreferences {
  try {
    return normalizePreferences(
      JSON.parse(localStorage.getItem(studioPreferencesKey(userId)) || "{}"),
    );
  } catch {
    return { ...defaultStudioPreferences };
  }
}

export function writeStudioPreferences(
  userId: string | undefined,
  changes: Partial<StudioPreferences>,
): StudioPreferences {
  const preferences = normalizePreferences({
    ...readStudioPreferences(userId),
    ...changes,
  });
  const key = studioPreferencesKey(userId);
  localStorage.setItem(key, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: { key } }));
  return preferences;
}

// Keep settings, the sidebar, and other tabs on the same per-account preferences.
export function useStudioPreferences(userId?: string) {
  const [preferences, setPreferences] = useState(() =>
    readStudioPreferences(userId),
  );
  const [error, setError] = useState("");

  useEffect(() => {
    setPreferences(readStudioPreferences(userId));
    setError("");
    const key = studioPreferencesKey(userId);
    const syncLocal = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key)
        setPreferences(readStudioPreferences(userId));
    };
    const syncTab = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setPreferences(readStudioPreferences(userId));
    };
    window.addEventListener(changeEvent, syncLocal);
    window.addEventListener("storage", syncTab);
    return () => {
      window.removeEventListener(changeEvent, syncLocal);
      window.removeEventListener("storage", syncTab);
    };
  }, [userId]);

  const updatePreferences = useCallback(
    (changes: Partial<StudioPreferences>) => {
      try {
        const next = writeStudioPreferences(userId, changes);
        setPreferences(next);
        setError("");
        return true;
      } catch {
        setError(
          "Your browser could not save this preference. Allow site storage and try again.",
        );
        return false;
      }
    },
    [userId],
  );

  return { preferences, updatePreferences, error };
}
