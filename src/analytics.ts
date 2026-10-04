import {
  analyticsEvents,
  analyticsProperties,
  type AnalyticsEvent,
} from "../shared/analytics";
import type { PostHog } from "posthog-js/dist/module.no-external";

let client: PostHog | undefined;
let initialization: Promise<void> | undefined;
let loading = false;
const pending: {
  event: AnalyticsEvent;
  properties: Record<string, unknown>;
}[] = [];

export function track(
  event: AnalyticsEvent,
  properties: Record<string, unknown> = {},
) {
  try {
    if (!client) {
      if (loading && pending.length < 20)
        pending.push({ event, properties: analyticsProperties(properties) });
      return;
    }
    client.capture(
      event,
      analyticsProperties({ ...properties, path: window.location.pathname }),
    );
  } catch {}
}

export function startAnalytics(): Promise<void> {
  if (initialization) return initialization;
  loading = true;
  initialization = initialize()
    .catch(() => {})
    .finally(() => {
      loading = false;
      pending.length = 0;
    });
  return initialization;
}

async function initialize() {
  if (navigator.doNotTrack === "1") return;
  const response = await fetch("/api/analytics/config", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return;
  const config = await response.json();
  if (
    config.enabled !== true ||
    !/^phc_[a-zA-Z0-9_-]+$/.test(config.token) ||
    !["https://eu.i.posthog.com", "https://us.i.posthog.com"].includes(
      config.host,
    )
  )
    return;
  const { default: posthog } =
    await import("posthog-js/dist/module.no-external");
  posthog.init(config.token, {
    api_host: config.host,
    persistence: "memory",
    disable_persistence: true,
    person_profiles: "never",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    capture_dead_clicks: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    advanced_disable_feature_flags: true,
    ip: false,
    respect_dnt: true,
    before_send: (event) => {
      if (!event || !analyticsEvents.includes(event.event as AnalyticsEvent))
        return null;
      event.properties = analyticsProperties(event.properties);
      return event;
    },
  });
  client = posthog;
  let lastPath = "";
  const pageview = () => {
    const path = window.location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    track("$pageview");
  };
  pageview();
  for (const item of pending) track(item.event, item.properties);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      original.apply(this, args);
      pageview();
    };
  }
  window.addEventListener("popstate", pageview);
}
