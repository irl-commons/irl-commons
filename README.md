# irl-commons

Small, reusable datasets about streaming live from outside (IRL streaming), maintained by irl-commons. This is v0: curated by hand, incomplete, and subject to corrections and schema changes. Every entry carries a source-check date; the initial bulk check was in November 2026. Links and service features can change.

- `data/words.json`: terms, plain explanations, aliases, related words and optional translations.
- `data/answers.json`: short troubleshooting checks, with related words, services and sources.
- `data/services.json`: apps, receivers, hubs, hardware, production tools and documentation, with official links and review dates.
- `data/guides.json`: links to public tutorials, covered services, chain parts and review dates.
- `data/plans.json`: carrier records and optional data plans. Currently empty: no coverage or plan claims are implied. The name leaves room for plans under each carrier without a separate lookup table.
- `schema/src/schema.ts`: Zod schemas and shared rules; the source of truth.
- `schema/json/`: exported JSON Schema draft 2020-12, plus chain-part and role metadata in `parts.json`.
- `schema/fixtures/`: deliberately invalid, synthetic validation examples.
- `scripts/`: validation, schema export and guide title generation.

Validate with Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun run check
bun run export
git diff --exit-code -- schema/json
```

The check validates all five files, cross-references, generated titles, privacy rules, schema drift and rejection fixtures. Carrier checks also exercise a valid synthetic network and virtual operator, missing hosts, country mismatches and duplicates. Run `bun run titles` after changing the service names or relationships used by guide titles.

The package is prepared as `@irl-commons/data`; it has not been published to npm. You can clone this repository and use the JSON files directly. After the first reviewed release, install with `npm install @irl-commons/data`. The exported paths are:

```js
import words from '@irl-commons/data/data/words.json' with { type: 'json' };
import wordsSchema from '@irl-commons/data/schema/json/words.schema.json' with { type: 'json' };
```

`@irl-commons/data/schema` exports the TypeScript Zod definitions for runtimes that support TypeScript. Other languages can use the exported JSON Schemas; additional cross-reference rules are documented in `schema/README.md`.

Data (`data/*.json`) is licensed under CC BY 4.0; see `LICENSE-DATA` for the official text. Credit format:

> Data from irl-commons contributors (initial data by openstreambox) — https://github.com/irl-commons/irl-commons — CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: [describe changes, or “none”].

Retain supplied attribution and modification notices, link the source and licence, and identify your changes. Data is supplied without warranties. Links do not license the linked third-party material or imply endorsement. Code in `schema/` and `scripts/`, and the remaining repository material, uses the MIT licence in `LICENSE`.

Propose additions or corrections through issues or pull requests. Include public primary sources, stable ids and review dates. Write descriptions in your own words. Keep entries small and verifiable; leave uncertain claims out. Carrier submissions must support every populated field with official sources. Use ISO 3166-1 alpha-2 country codes, `MNO` or `MVNO`, a null host for an MNO and a same-country MNO id for an MVNO. `sources` backs carrier properties; each plan has its own source and checked date. A null data cap means unlimited, while null throttle and tethering values mean unknown. Data caps use decimal GB and throttles use kbit/s. Roaming routing is `home-routed`, `local-breakout` or `unknown`. Do not infer routing from marketing claims. Run the validation and export commands before submitting.

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

Release setup and the one-time npm package bootstrap are documented in [NPM-PUBLISHING.md](NPM-PUBLISHING.md).
