import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./palette.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/400-italic.css";
import Landing from "./Landing";
const Workspace = lazy(() => import("./Workspace"));
const Classroom = lazy(() => import("./Classroom"));
const Studio = lazy(() => import("./StudioSession"));
const path = window.location.pathname;
const inWorkspace = /^\/app(?:\/|$)/.test(path);
if (inWorkspace) document.title = "Proof · My work";
const workspace = path.startsWith("/app/evidence") ? (
  <Workspace />
) : path.startsWith("/app/class") ? (
  <Classroom />
) : (
  <Studio />
);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {inWorkspace ? (
      <Suspense
        fallback={
          <div role="status" style={{ padding: 32 }}>
            Opening Proof...
          </div>
        }
      >
        {workspace}
      </Suspense>
    ) : (
      <Landing />
    )}
  </React.StrictMode>,
);
