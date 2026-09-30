import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./tools/node_modules/playwright-core/index.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(dir, "shots");
const base = process.env.PROOF_URL || "http://localhost:4317";
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));

  const settle = async () => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
  };

  await page.goto(base + "/", { waitUntil: "networkidle" });
  await settle();
  // Walk the page so lazy images and reveal-on-scroll content render before the full capture.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await settle();
  await page.screenshot({ path: path.join(shots, "landing-hero.png") });
  await page.screenshot({ path: path.join(shots, "landing-full.png"), fullPage: true });
  for (const [name, selector] of [
    ["landing-schools", ".lp-schools"],
    ["landing-used", ".lp-used-for"],
    ["landing-compare", ".lp-compare"],
    ["landing-process", ".lp-how-panel"],
  ]) {
    await page.locator(selector).first().screenshot({ path: path.join(shots, `${name}.png`) });
  }

  const studio = [
    ["studio-home", "/app"],
    ["studio-work", "/app/works/social-media"],
    ["studio-analysis", "/app/works/social-media/analysis"],
    ["studio-citations", "/app/works/social-media/citations"],
  ];
  for (const [name, route] of studio) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await settle();
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
  }
  console.log("Captured", fs.readdirSync(shots).join(", "));
} finally {
  await browser.close();
}
