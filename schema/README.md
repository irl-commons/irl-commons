# Schemas

Run validation from the repository root using the commands in the main README. Zod in `src/schema.ts` is authoritative; `json/*.schema.json` is generated. `json/parts.json` supplies chain tasks and roles for other validators. `fixtures/*.json` must be rejected.

Beyond schema validation, `scripts/check.ts` checks unique ids and existing word, answer and service references. Answers keep product names out of checks and link products instead. Service roles must fit their kind; products have chain parts, while documentation entries cover products. Guides name covered publishers, share a product or chain part with linked answers, and carry a generated display title. Carrier ids and plan ids within a carrier are unique. Country codes must be assigned ISO alpha-2 codes. An MNO has no host; an MVNO references an MNO in the same country. The carrier dataset may be empty. Synthetic runtime cases exercise these relationships without asserting real-world facts.

The privacy scan checks repository files and every dataset string. Standard metadata URLs in generated schemas and the unmodified official licence text are permitted; insecure source URLs are rejected in datasets. Do not add private references to fixtures.

## Freshness

Every entry (including carriers and nested plans) has one `checked_on` ISO date:
the day its content was checked against its public primary source. A successful
link request alone is not a content check. Preserve actual dates; the initial
bulk check is 2026-11-14 where no earlier check is recorded in history.

| Dataset or field | Stale after |
| --- | --- |
| Words | 18 calendar months |
| Answers | 12 calendar months |
| Guides | 9 calendar months |
| Services | 6 calendar months |
| Carrier records | 6 calendar months |
| Plan prices, caps and fair-use rules; service `status` | 90 days |

Consumers compute staleness from `checked_on` and today's UTC date; data stores
only dates, never a stale flag. An entry is stale on its due date. Calendar
months clamp to the final day of the target month. Show stale entries with their
date; hide stale plan prices/caps/fair-use figures and service status while
keeping the carrier/service and source visible. Nested plans use their own date.
Run `bun scripts/stale.ts [YYYY-MM-DD]` for a Markdown report. Weekly automation
checks links and updates one freshness issue; it never edits data.

Schema `$id` values use the public `irl-commons/irl-commons` repository. The npm package is `@irl-commons/data`.
