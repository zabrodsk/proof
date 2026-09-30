# README visuals

## Cover

[`hero.png`](hero.png) was generated with the built-in image generation tool. It is an editorial illustration of traceable evidence, not an application screenshot. The selected output is stored here unchanged.

### Final generation prompt

```text
Use case: stylized-concept
Asset type: wide hero cover for the GitHub README of Proof, an evidence-checking writing app.
Primary request: a beautifully art-directed, sophisticated technical editorial cover. Show an exploded isometric stack of off-white research manuscript pages and translucent forest-green glass panels, with one highlighted sentence connected by extremely fine mint circuit traces to a small exact source passage card. A restrained physical visualization of traceable evidence, precise typography, cinematic material detail, subtle printed registration marks, beautiful negative space.
Composition: very wide landscape, approximately 3:1. Left 42 percent is typography on dark near-black forest green; right 58 percent is the sculptural paper and green glass illustration. Generous edge margins. Minimal and intentional, not a dashboard mockup.
Text verbatim, left aligned: large elegant cream serif "Proof" and below it small clean sans serif "Trace the claim. Read the evidence." No other readable text. Page contents use subtle nonsemantic gray rules.
Color palette: deep forest #102B22, sage #D9E8D8, warm paper #F6F5EF, tiny pale lime accents. Soft studio lighting, warm paper grain, precise shadows, emerald glass refraction.
Constraints: no sparkle stars, no star icons, no robots, no mascots, no purple gradients, no glow overload, no badges, no third-party logos, no generator or editor branding, no watermark. Keep the typography exact and legible. This is an editorial illustration, not a screenshot of the application.
```

## Architecture

[`architecture.excalidraw`](architecture.excalidraw) is the editable source. [`architecture.svg`](architecture.svg) is the README export, rendered with the official `@excalidraw/excalidraw` package, version 0.18.1. Both use the same scene.

Download the scene and open it in [Excalidraw](https://excalidraw.com). The diagram summarizes the persistent backend. Its shared database and private source store serve both the API and worker.

To update the visual, edit the scene, export an SVG with its background and embedded fonts, and commit both files. Keep the SVG free of scripts and external image dependencies.

The README uses GitHub-native links, anchors, and expandable sections. It requires no JavaScript or third-party widgets.
