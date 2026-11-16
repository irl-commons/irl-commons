import { expect, test } from "bun:test";
import { Link, SupportLink } from "../schema/src/schema.ts";
import { semantic } from "./check.ts";
import services from "../data/services.json";
import words from "../data/words.json";
import answers from "../data/answers.json";
import guides from "../data/guides.json";
import plans from "../data/plans.json";
import standards from "../data/standards.json";

const legacy = {label: "Help", url: "https://example.org/help"};
const channel = {...legacy, kind: "discord", url: "https://discord.gg/example", source: "https://example.org/", checked_on: "2026-11-16"};
test("legacy links remain valid for one release; official typed Discord needs provenance", () => {
  expect(SupportLink.safeParse(legacy).success).toBe(true);
  expect(SupportLink.safeParse(channel).success).toBe(true);
  for (const field of ["source", "checked_on", "kind"]) {
    const incomplete: any = {...channel}; delete incomplete[field];
    expect(SupportLink.safeParse(incomplete).success).toBe(false);
  }
  expect(Link.safeParse(channel).success).toBe(false);
  expect(Link.safeParse({label: "Invite", url: channel.url}).success).toBe(false);
});
test("support verification dates cannot be in the future", () => {
  const data = structuredClone({services, words, answers, guides, plans, standards});
  data.services.services[0].support[0].checked_on = "2999-01-01";
  expect(semantic(data).some(s => s.includes("support checked_on is in the future"))).toBe(true);
});
