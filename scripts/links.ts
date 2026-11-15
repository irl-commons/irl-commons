import { readFileSync } from "node:fs";
const urls = new Set<string>();
function walk(value: unknown) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https:\/\/[^\s<>"\)]+/g)) urls.add(match[0]);
  } else if (Array.isArray(value)) value.forEach(walk);
  else if (value && typeof value === "object") Object.values(value).forEach(walk);
}
for (const name of ["words", "answers", "services", "guides", "plans", "standards"])
  walk(JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8")));
let failed = false;
for (const url of [...urls].sort()) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "irl-commons-link-check" } });
    await response.body?.cancel();
    if (!response.ok) { console.error(`${response.status}: ${url}${[403, 429].includes(response.status) ? " (needs human review; may block automation)" : ""}`); failed = true; }
  } catch { console.error(`Request failed: ${url}`); failed = true; }
}
console.log(`Checked ${urls.size} external links; link health does not confirm content.`);
if (failed) process.exit(1);
