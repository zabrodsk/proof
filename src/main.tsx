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
const IntegrationWorkspace = lazy(() => import("./IntegrationWorkspace"));
const inWorkspace = /^\/app(?:\/|$)/.test(window.location.pathname);
if (inWorkspace) document.title = "Proof · Check your evidence";
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
        {/^\/app\/(checks|integrations)(?:\/|$)/.test(
          window.location.pathname,
        ) ? (
          <IntegrationWorkspace />
        ) : window.location.pathname.startsWith("/app/evidence") ? (
          <Workspace />
        ) : (
          <Classroom />
        )}
      </Suspense>
    ) : (
      <Landing />
    )}
  </React.StrictMode>,
);
