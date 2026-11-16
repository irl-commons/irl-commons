import { expect, test } from "bun:test";
import { Plan } from "../schema/src/schema.ts";
import plans from "../data/plans.json";
import { staleRows } from "./stale.ts";

const sample = () => structuredClone(plans.carriers[0].plans[0]);
test("split directions and independent use rules survive validation", () => {
  const plan = sample();
  plan.hotspot.value = "allowed";
  plan.router_or_modem.value = "banned";
  plan.continuous_video.value = "limited";
  const parsed = Plan.parse(plan);
  expect(parsed.throttle_down_kbps.value).toBe(64);
  expect(parsed.throttle_up_kbps.value).toBe(16);
  expect(parsed.hotspot.value).toBe("allowed");
  expect(parsed.router_or_modem.value).toBe("banned");
  expect(parsed.continuous_video.value).toBe("limited");
});
test("unknown and explicitly unlimited are distinct; both need provenance", () => {
  const plan = sample();
  plan.data_cap_gb.value = null;
  expect(Plan.parse(plan).data_cap_gb.value).toBeNull();
  plan.data_cap_gb.value = "unlimited";
  expect(Plan.parse(plan).data_cap_gb.value).toBe("unlimited");
  plan.data_cap_gb.value = null;
  delete plan.data_cap_gb.source;
  expect(Plan.safeParse(plan).success).toBe(false);
});
test("rechecking a carrier or one fact cannot refresh a stale upload limit", () => {
  const plan = sample();
  for (const fact of Object.values(plan))
    if (typeof fact === "object") fact.checked_on = "2026-11-16";
  plan.max_up_mbps.checked_on = "2026-01-01";
  const data = {words: {words: []}, answers: {answers: []}, guides: {guides: []},
    services: {services: []}, standards: {standards: []},
    plans: {carriers: [{id: "sample-network", checked_on: "2026-11-16", plans: [plan]}]}};
  expect(staleRows(data, "2026-11-16")).toEqual([
    "- plans/sample-network/magentamobil-l max_up_mbps: checked 2026-01-01; stale since 2026-04-01",
  ]);
});
