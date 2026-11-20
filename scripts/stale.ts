import { readFileSync } from "node:fs";
import { Day, planFacts } from "../schema/src/schema.ts";

export const months = { words: 18, answers: 12, guides: 9, services: 6, plans: 6, standards: 6 } as const;
export function due(checked: string, window: { months: number } | { days: number }): string {
  Day.parse(checked);
  const date = new Date(checked);
  if ("days" in window) date.setUTCDate(date.getUTCDate() + window.days);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + window.months);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  }
  return date.toISOString().slice(0, 10);
}
/** The dated comparison facts on a standard (codec and transport fields), as [path, fact] pairs. */
export function comparisonFacts(entry: any): [string, any][] {
  const out: [string, any][] = [];
  for (const group of ["codec", "transport"]) {
    const facts = entry[group];
    if (!facts) continue;
    for (const [field, value] of Object.entries<any>(facts)) {
      if (!value || typeof value !== "object") continue;
      if ("checked_on" in value) out.push([`${group}.${field}`, value]);
      else for (const [key, inner] of Object.entries<any>(value)) if (inner?.checked_on) out.push([`${group}.${field}.${key}`, inner]);
    }
  }
  return out;
}
export function staleRows(data: Record<string, any>, today: string): string[] {
  Day.parse(today);
  const rows: string[] = [];
  const add = (label: string, entry: any, window: { months: number } | { days: number }) => {
    if (!entry.checked_on) { rows.push(`- ${label}: no recorded source-check date; freshness unknown`); return; }
    const deadline = due(entry.checked_on, window);
    if (today >= deadline) rows.push(`- ${label}: checked ${entry.checked_on}; stale since ${deadline}`);
  };
  for (const [dataset, count] of Object.entries(months)) {
    for (const entry of data[dataset][dataset === "plans" ? "carriers" : dataset]) {
      add(`${dataset}/${entry.id}`, entry, { months: count });
      if (dataset === "standards") for (const [where, fact] of comparisonFacts(entry)) add(`standards/${entry.id} ${where}`, fact, { months: count });
      if (dataset === "services" && entry.status !== null) add(`services/${entry.id} status`, entry, { days: 90 });
      if (dataset === "services") for (const w of entry.wrappers ?? []) add(`services/${entry.id} wrapper ${w.url}`, w, { months: count });
      for (const plan of entry.plans ?? [])
        for (const [field, fact] of planFacts(plan)) add(`plans/${entry.id}/${plan.id} ${field}`, fact, { days: 90 });
    }
  }
  return rows;
}
if (import.meta.main) {
  const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const data = Object.fromEntries(Object.keys(months).map(name => [name, JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"))]));
  console.log(`Checked for staleness on ${today}.\n\n${staleRows(data, today).join("\n") || "No stale entries."}`);
}
