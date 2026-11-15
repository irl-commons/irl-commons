// Regenerate the deprecated `aliases` in ../data/words.json from term, also_called, search_terms and naming.
// Kept for one release so that sites reading `aliases` keep working; read the new fields instead.
import { readFileSync, writeFileSync } from "node:fs";
import { wordAliases } from "../schema/src/schema.ts";

const file = new URL("../data/words.json", import.meta.url);
const doc = JSON.parse(readFileSync(file, "utf8"));
let changed = 0;
for (const w of doc.words) {
  const want = wordAliases(w);
  if (JSON.stringify(w.aliases) !== JSON.stringify(want)) { w.aliases = want; changed++; }
}
writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(`aliases: ${changed} updated`);
