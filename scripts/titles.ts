// Regenerate title_display in ../data/guides.json from covers, publisher and part.
import { readFileSync, writeFileSync } from "node:fs";
import { guideTitle } from "../schema/src/schema.ts";

const path = (p: string) => new URL(p, import.meta.url);
const services = JSON.parse(readFileSync(path("../data/services.json"), "utf8")).services;
const names = new Map<string, string>(services.map((s: any) => [s.id, s.name]));
const file = path("../data/guides.json");
const doc = JSON.parse(readFileSync(file, "utf8"));
let changed = 0;
for (const g of doc.guides) {
  const t = guideTitle(g, (id) => names.get(id) ?? id);
  if (g.title_display !== t) { g.title_display = t; changed++; }
}
writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(`title_display: ${changed} updated`);
