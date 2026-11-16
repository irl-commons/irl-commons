# Schemas

Run validation from the repository root using the commands in the main README. Zod in `src/schema.ts` is authoritative; `json/*.schema.json` is generated. `json/parts.json` supplies chain tasks and roles for other validators. `fixtures/*.json` must be rejected.

Beyond schema validation, `scripts/check.ts` checks unique ids and existing word, answer and service references. Answers keep product names out of checks and link products instead. Service roles must fit their kind; class `docs` is for community entries only, bonding and cloud entries set `hosting`, and cloud entries are never `self`; products have chain parts, while documentation entries cover products. Guides name covered publishers, share a product or chain part with linked answers, and carry a generated display title. Carrier ids and plan ids within a carrier are unique. Country codes must be assigned ISO alpha-2 codes. An MNO has no host; an MVNO references an MNO in the same country. The carrier dataset may be empty. Standards reference existing services by `service_ids` (no duplicates), and `other_users` may not name a catalogued product. An entry may lack a `url` or sources only when its openness is `not-public`. An app format needs a named second product, and a shared or hardware-and-codecs item in use needs two named products. A standard that is also a glossary word must share its id and set `word` instead of a description; a standard whose id, name or short name matches a word's id, term or alias without that link fails as a duplicate. Codec and transport facts need the matching kind, a null top-level `licence`, at least one source and a `checked_on` each; a video codec has hardware facts and an audio codec has none; efficiency compares only with other codec entries of the same media. The exported JSON Schema carries these single-entry rules too, except that `word` equals `id`, which only zod and the check enforce. Words: `also_called` and `search_terms` don't repeat each other or the term; with a `naming` block, every `also_called` name is the label or an `also-used` alternative and the other way round. Within a naming block, an alternative needs `why` unless it is `also-used`. `seen_in` contains service ids with direct evidence for that exact observed `label` (case-insensitive), and never appears on ambiguous items. Evidence requires `service`, the observed `label`, and `support: direct | context-only`. Context-only evidence explains related usage or uncertainty and never counts toward review. The existing service `maker` is its owning maker or organisation: Moblin/Moblink share eerimoq and BELABOX/BELABOX Cloud share BELABOX. Reviewed requires direct evidence from two distinct owning makers and two different listed stewards; draft lists no reviewers. Recommended labels stay unique. Technical alternatives may never equal another word's recommended label. An Also-used alternative (and its `also_called` name) may do so only with a resolving `see` and `seen_in` backed by direct evidence for that product's exact label. Ambiguous and Narrower may do so only with `see` resolving to that word's id; any supplied `see` must resolve to the word normally named by the alternative. The check also requires generated compatibility `aliases`, dates not in the future and existing evidence services. JSON Schema carries the single-entry rules it can express; Zod and the cross-file check enforce the rest. Synthetic runtime cases exercise these relationships without asserting real-world facts.

The privacy scan checks repository files and every dataset string. Standard metadata URLs in generated schemas and the unmodified official licence text are permitted; insecure source URLs are rejected in datasets. Do not add private references to fixtures.

## Freshness

Services, guides, standards, carriers and nested plans require `checked_on`; words and
answers may omit it for an unrecorded content check (unknown freshness). When
present, `checked_on` is an ISO date:
the day its content was checked against its public primary source. A successful
link request alone is not a content check. Preserve actual dates; never infer one from link health or a bulk import.
Undated words and answers have unknown freshness and must not be shown as fresh.
See data/README.md for recorded source-check provenance.

| Dataset or field | Stale after |
| --- | --- |
| Words | 18 calendar months |
| Answers | 12 calendar months |
| Guides | 9 calendar months |
| Services | 6 calendar months |
| Standards | 6 calendar months |
| Standards comparison facts (each by its own `checked_on`) | 6 calendar months |
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
