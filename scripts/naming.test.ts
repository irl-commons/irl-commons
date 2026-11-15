import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { files } from "../schema/src/schema.ts";
import { semantic } from "./check.ts";
const data = Object.fromEntries(Object.keys(files).map(k => [k, JSON.parse(readFileSync(new URL(`../data/${k}.json`, import.meta.url), "utf8"))]));
const candidate = () => structuredClone(data);
test("only directly supported alternative labels may name a service", () => {
  const d = candidate(); const n = d.words.words.find((w: any) => w.id === "relay").naming;
  n.alternatives[0].seen_in = ["moblin"];
  expect(files.words.safeParse(d.words).success).toBe(false);
  n.evidence.push({...n.evidence[0], service: "moblin", label: n.alternatives[0].term, support: "context-only"});
  expect(files.words.safeParse(d.words).success).toBe(false);
  n.evidence.at(-1).support = "direct";
  expect(files.words.safeParse(d.words).success).toBe(true);
});
test("reviewed counts owning makers, not services or context", () => {
  for (const pair of [["moblin", "moblink"], ["belabox", "belabox-cloud"]]) {
    const d = candidate(); const n = d.words.words.find((w: any) => w.naming).naming;
    n.status = "reviewed"; n.reviewed_by = ["pjeweb", "sample-steward"];
    n.evidence = pair.map(service => ({...n.evidence[0], service, support: "direct"}));
    expect(semantic(d).some(p => p.includes("two distinct owning makers"))).toBe(true);
    n.evidence[1].service = "ceralive";
    expect(semantic(d).some(p => p.includes("two distinct owning makers"))).toBe(false);
    n.evidence[1].support = "context-only";
    expect(semantic(d).some(p => p.includes("two distinct owning makers"))).toBe(true);
    n.evidence[1].service = "missing-service";
    expect(semantic(d).some(p => p.includes("does not exist"))).toBe(true);
  }
});
test("collision fixtures reject missing and wrong see, also-used, technical and synonyms", () => {
  const d = candidate(); const w = d.words.words.find((w: any) => w.id === "srt-latency");
  const target = d.words.words.find((w: any) => w.id === "bitrate");
  const a = {term: target.naming.label, status: "ambiguous", why: "A synthetic ambiguity.", see: target.id};
  w.naming.alternatives.push(a);
  expect(files.words.safeParse(d.words).success).toBe(true);
  for (const status of ["ambiguous", "narrower"]) {
    a.status = status;
    expect(files.words.safeParse(d.words).success).toBe(true);
    a.see = "relay"; expect(files.words.safeParse(d.words).success).toBe(false);
    delete (a as any).see; expect(files.words.safeParse(d.words).success).toBe(false);
    a.see = target.id;
  }
  for (const status of ["also-used", "technical"]) {
    a.status = status; expect(files.words.safeParse(d.words).success).toBe(false);
  }
  w.naming.alternatives.pop();
  const unnamed = d.words.words.find((w: any) => !w.naming);
  unnamed.also_called.push(target.naming.label);
  expect(files.words.safeParse(d.words).success).toBe(false);
});

test("a legitimate ambiguity fixture resolves to another recommended label", () => {
 const fixture = JSON.parse(readFileSync(new URL("./fixtures/naming/ambiguity.json", import.meta.url), "utf8"));
 expect(files.words.safeParse(fixture).success).toBe(true);
});
