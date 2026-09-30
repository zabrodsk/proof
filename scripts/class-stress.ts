import { writeFile } from "node:fs/promises";
import { reviewClass, allSentences } from "../server/classroom.js";
import { withUsage } from "../server/usage.js";
import { apiKey } from "../server/judge.js";
if (process.env.PROOF_STRESS_LIVE !== "true")
  throw new Error("Set PROOF_STRESS_LIVE=true to run paid provider checks.");
if (!apiKey()) throw new Error("Jev is not configured.");
const templates = [
  "Students should explain how the available evidence relates to their research question while also considering the limitations of each study.",
  "A useful research question identifies a population and an outcome so that the reader can understand the scope of the argument.",
  "Different studies may investigate different settings, and those differences should be considered before their findings are combined into a general conclusion.",
  "The writer should distinguish a reported association from a causal explanation and describe uncertainty when the evidence does not resolve that distinction.",
  "A source may provide relevant background without establishing the specific conclusion that the writer wants to draw from the reported results.",
];
function document(target: number) {
  const parts: string[] = [];
  let words = 0;
  let i = 0;
  while (words < target) {
    const s = templates[i++ % templates.length];
    parts.push(s);
    words += s.split(/\s+/).length;
  }
  parts[0] = "This sentences have a grammatical mistake.";
  parts[parts.length - 1] = "These result is not grammatically correct.";
  return parts.join("\n\n");
}
const results: any[] = [];
async function run(label: string, words: number) {
  const text = document(words);
  const start = Date.now();
  let last = 0;
  const { result, usage } = await withUsage(() =>
    reviewClass(text, [], "draft", () => {
      if (Date.now() - last > 15000) {
        console.log(
          `${label}: running ${Math.round((Date.now() - start) / 1000)}s`,
        );
        last = Date.now();
      }
    }),
  );
  const record = {
    label,
    words: (text.match(/\S+/g) || []).length,
    characters: text.length,
    sentences: allSentences(text).length,
    completed: result.coverage.completed,
    seconds: (Date.now() - start) / 1000,
    usage,
    firstLanguage: result.sentences[0]?.language,
    lastLanguage: result.sentences.at(-1)?.language,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
  results.push(record);
  console.log(JSON.stringify(record));
  if (record.completed !== record.sentences) process.exitCode = 1;
  return record;
}
await run("600-word baseline", 600);
await run("5,000-word long draft", 5000);
await run("10,000-word long draft", 10000);
await Promise.all(
  Array.from({ length: 5 }, (_, i) => run(`Concurrent reader ${i + 1}`, 600)),
);
await writeFile(
  "/tmp/proof-class-stress-results.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      results,
      totalEstimatedJevUsd: results.reduce(
        (n, r) => n + r.usage.estimatedUsd,
        0,
      ),
    },
    null,
    2,
  ),
);
