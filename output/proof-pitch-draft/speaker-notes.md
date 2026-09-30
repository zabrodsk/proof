# Proof pitch speaker notes

## 1. Cover

Template slide 1, cover. Suggested timing: 15 seconds.
Proof helps students and professionals check the evidence behind AI-assisted research. Our focus is whether the academic source supports the sentence, with passages users can inspect. This is the first pitch draft, not a claim of exhaustive verification or commercial traction.

## 2. Opening scenario

Template slide 2, opening story or example. Suggested timing: 30 seconds.
Imagine asking an AI assistant to explain a study. The answer is fluent and includes a citation, so it looks usable. A student might put it into an essay; an analyst might use it in a client report. But the original passage says 18% faster on a measured task, not twice the productivity. This is a fictional illustration, not my personal experience or an actual study. It introduces the gap between a convincing answer and evidence that supports it.

## 3. Problem and audience

Template slide 3, problem statement. Suggested timing: 30 seconds.
AI-assisted research can contain invented sources, inaccurate reference details, or unsupported interpretations of real papers. Search-enabled tools already find academic work, so the claim is not that AI cannot search. The problem is that discovery, full-text access, and interpretation can fail. Our proposed users include students, researchers, consultants, and analysts whose writing depends on academic evidence. These are target segments, not validated paying customers.
Source: OpenAI deep-research launch documentation describes browsing alongside hallucination and inference limitations. https://openai.com/index/introducing-deep-research/

## 4. Research evidence

Template slide 4, statistics and research. Suggested timing: 35 seconds.
A June 2025 experiment prompted GPT-4o to generate six literature reviews on mental-health topics. The authors verified 176 references. They reported 35 fabricated references and 64 real references with bibliographic errors. The remaining 77 were accurate. We calculate 99 divided by 176, or 56.3%, and round it to 56% on the slide. These are citation errors, not a measured rate of unsupported semantic claims. This is a small, model-specific experiment under straightforward prompting, not a benchmark of all current AI tools. The study validates a failure mode; it does not establish demand or Proof's accuracy.
Source: Linardon et al., JMIR Mental Health, 2025, DOI 10.2196/80371. https://mental.jmir.org/2025/1/e80371

## 5. Question

Template slide 5, turn the problem into a question. Suggested timing: 10 seconds.
How can we check AI-assisted research before we rely on it? The question moves us from the risk to a concrete review workflow. Pause briefly, then reveal the product.

## 6. Solution · Demo follows

Template slide 6, showcase the solution. Suggested timing: 25 seconds, followed by a 60-second live demo.
Proof accepts a draft, helps find or add academic papers, and brings evidence alongside findings. Show that users can inspect the original passage and that incomplete evidence stays unverified. The screenshot is an existing local interface reference. The review card below it is illustrative, not a screenshot of a completed audit.
LIVE DEMO, as requested by the template after slide 6:
1. Open the current Proof app and show Check writing, Find sources, and My sources.
2. Use a prepared, publicly accessible research article and a draft with one faithful claim plus one planted overstatement. Do not use private student or client material.
3. Run a check, open a finding, and read the passage with the audience. Show the source-access label and an unverified case when available.
4. Explain that the user decides what to change. Do not promise a correct live result until the demo has been rehearsed.
Current implementation includes source identity and policy checks with limited journal coverage. Full-text retrieval, extraction, and AI judgments can still fail.
Implementation references: README.md, src/Classroom.tsx, server/discovery.ts, server/scholarly.ts, server/judge.ts. Local demo: http://127.0.0.1:4317/app

## 7. Tech stack

Template slide 7, tech stack. Suggested timing: 35 seconds.
The browser uses React, TypeScript, and Vite. The Node.js and Express server parses uploaded documents and runs review jobs. OpenAlex supplies discovery candidates, Crossref resolves article identity and metadata, DOAJ helps confirm journal peer-review policy, and Europe PMC supplies available full-text evidence. Jev through TypeSafe answers typed questions about claims and evidence. Code checks the responses and preserves uncertainty when retrieval, extraction, or judgments fail. Current public-source checks deliberately exclude articles outside the verifiable policy and full-text set. A failed lookup does not prove a source is fabricated. No provider credentials or private inputs are included in the deck.
Implementation references: package.json, server/discovery.ts, server/sources.ts, server/scholarly.ts, server/judge.ts, server/evidence.ts, src/class-store.ts.

## 8. Design system

Template slide 8, design system and closing. Suggested timing: 25 seconds.
Proof's current visual system uses Newsreader headings, DM Sans body text, forest green, sage, and paper backgrounds. Evidence passages and uncertainty labels are part of the review experience. Close with the product promise: check the research before you rely on it. Invite students and professional research teams to test the workflow. No customer count, revenue, accuracy guarantee, or paid-pilot claim has been supplied or added.
Design references: src/palette.css, src/landing.css, src/styles.css, public/design-system/app-reference.jpg.