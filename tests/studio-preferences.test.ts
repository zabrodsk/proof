import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readStudioPreferences,
  writeStudioPreferences,
  studioPreferencesKey,
} from "../src/studio-preferences.js";

test("preferences stay isolated by account and invalid saved values use defaults", () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  try {
    writeStudioPreferences("first-user", {
      sidebarCollapsed: true,
      motion: "reduced",
    });
    assert.deepEqual(readStudioPreferences("first-user"), {
      sidebarCollapsed: true,
      motion: "reduced",
    });
    assert.deepEqual(readStudioPreferences("second-user"), {
      sidebarCollapsed: false,
      motion: "system",
    });
    data.set(
      studioPreferencesKey("second-user"),
      '{"sidebarCollapsed":"true","motion":"invalid"}',
    );
    assert.deepEqual(readStudioPreferences("second-user"), {
      sidebarCollapsed: false,
      motion: "system",
    });
    data.set(studioPreferencesKey("second-user"), "bad json");
    assert.deepEqual(readStudioPreferences("second-user"), {
      sidebarCollapsed: false,
      motion: "system",
    });
  } finally {
    if (storageDescriptor)
      Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (windowDescriptor)
      Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
