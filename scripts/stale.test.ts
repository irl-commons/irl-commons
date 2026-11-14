import { expect, test } from "bun:test";
import { due, staleRows } from "./stale.ts";

test("calendar months clamp and day windows cross leap day", () => {
  expect(due("2024-08-31", { months: 6 })).toBe("2025-02-28");
  expect(due("2023-08-31", { months: 6 })).toBe("2024-02-29");
  expect(due("2024-01-01", { days: 90 })).toBe("2024-03-31");
});
test("field deadlines and nested plan dates are independent", () => {
  const data = { words: {words: []}, answers: {answers: []}, guides: {guides: []}, services: {services: [{id: "sample", checked_on: "2026-01-01", status: "beta"}]}, plans: {carriers: [{id: "network", checked_on: "2026-03-01", plans: [{id: "plan", checked_on: "2026-01-01"}]}]}, standards: {standards: []} };
  expect(staleRows(data, "2026-03-31")).toEqual([]);
  expect(staleRows(data, "2026-04-01").map(x => x.split(":")[0])).toEqual(["- services/sample status", "- plans/network/plan prices, caps and fair-use rules"]);
  expect(staleRows(data, "2026-07-01")).toHaveLength(3);
});

test("undated content is unknown freshness, never silently fresh", () => {
  const data = {words: {words: [{id: "sample"}]}, answers: {answers: []}, guides: {guides: []}, services: {services: []}, plans: {carriers: []}, standards: {standards: []}};
  expect(staleRows(data, "2026-11-14")).toEqual(["- words/sample: no recorded source-check date; freshness unknown"]);
});

test("standards go stale after six calendar months", () => {
  const data = {words: {words: []}, answers: {answers: []}, guides: {guides: []}, services: {services: []}, plans: {carriers: []}, standards: {standards: [{id: "sample-format", checked_on: "2026-05-31"}]}};
  expect(staleRows(data, "2026-11-29")).toEqual([]);
  expect(staleRows(data, "2026-11-30")).toEqual(["- standards/sample-format: checked 2026-05-31; stale since 2026-11-30"]);
});
