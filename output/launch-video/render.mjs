import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "./tools/node_modules/playwright-core/index.mjs";
import ffmpeg from "./tools/node_modules/ffmpeg-static/index.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const stillsOnly = process.argv.includes("--stills");

const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto("file://" + path.join(dir, "scene.html"));
  const duration = await page.evaluate(async () => { await window.ready; return window.DURATION; });

  const frame = async (t) => {
    await page.evaluate((t) => window.seek(t), t);
    return page.screenshot({ type: "jpeg", quality: 95 });
  };

  const stillsDir = path.join(dir, "stills");
  fs.mkdirSync(stillsDir, { recursive: true });
  const stills = [1.8, 4.6, 8.4, 11.8, 14.6, 16.6, 18.6, 21.5];
  for (const [i, t] of stills.entries()) {
    fs.writeFileSync(path.join(stillsDir, `${String(i + 1).padStart(2, "0")}-${t}s.jpg`), await frame(t));
  }
  if (stillsOnly) {
    console.log("Stills written to", stillsDir);
  } else {
    const out = path.join(dir, "proof-launch.mp4");
    const encoder = spawn(ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-f", "image2pipe", "-framerate", String(FPS), "-vcodec", "mjpeg", "-i", "pipe:0",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", out,
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const total = Math.round(duration * FPS);
    for (let i = 0; i < total; i++) {
      if (!encoder.stdin.write(await frame(i / FPS))) await once(encoder.stdin, "drain");
      if (i % FPS === 0) console.log(`frame ${i}/${total}`);
    }
    encoder.stdin.end();
    const [code] = await once(encoder, "exit");
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    console.log("Wrote", out);
  }
} finally {
  await browser.close();
}
