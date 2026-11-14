import { readFileSync } from "node:fs";
import { Day } from "../schema/src/schema.ts";

export const months = { words: 18, answers: 12, guides: 9, services: 6, plans: 6 } as const;
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
export function staleRows(data: Record<string, any>, today: string): string[] {
  Day.parse(today);
  const rows: string[] = [];
  const add = (label: string, entry: any, window: { months: number } | { days: number }) => {
    const deadline = due(entry.checked_on, window);
    if (today >= deadline) rows.push(`- ${label}: checked ${entry.checked_on}; stale since ${deadline}`);
  };
  for (const [dataset, count] of Object.entries(months)) {
    for (const entry of data[dataset][dataset === "plans" ? "carriers" : dataset]) {
      add(`${dataset}/${entry.id}`, entry, { months: count });
      if (dataset === "services" && entry.status !== null) add(`services/${entry.id} status`, entry, { days: 90 });
      for (const plan of entry.plans ?? []) add(`plans/${entry.id}/${plan.id} prices, caps and fair-use rules`, plan, { days: 90 });
    }
  }
  return rows;
}
if (import.meta.main) {
  const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const data = Object.fromEntries(Object.keys(months).map(name => [name, JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"))]));
  console.log(`Checked for staleness on ${today}.\n\n${staleRows(data, today).join("\n") || "No stale entries."}`);
}
