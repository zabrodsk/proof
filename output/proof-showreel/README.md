# Proof: Says who?

A 15-second motion reel for Proof, authored at 1920 × 1080 and 60 fps. The palette and type come from the product. The score is original procedural synthesis at 128 BPM, with stereo percussion, bass, transition effects, and a closing chord.

Open `preview.html` for the interactive canvas preview with sound and seeking. Play `proof-showreel.mp4` for the final H.264/AAC export.

## Edit and render

`scene.js` contains the animation, perspective paper mesh, typography, and timeline. `score.py` creates the stereo soundtrack. `render.mjs` packages the fonts into the HTML preview and renders 900 frames through headless Chrome, with two temporal samples per frame for motion blur. FFmpeg encodes the result.

Install Playwright locally for rendering:

```sh
npm install --no-save --package-lock=false playwright
python3 output/proof-showreel/score.py
node output/proof-showreel/render.mjs
```

For frame review only, add `--stills` to the second command. The renderer uses the local Playwright package, installed Chrome, FFmpeg, and the repository's DM Sans and Newsreader font packages. Update the Chrome and FFmpeg executable paths in `render.mjs` for your operating system.

The source-comparison scene is explicitly labeled as an illustrative example. It is a conceptual product animation, not a recording of a live audit. No research findings or performance claims are implied.
