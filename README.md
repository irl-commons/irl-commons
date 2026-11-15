# irl-commons

Small, reusable datasets about IRL streaming (streaming your real life away from the desk, wherever that is), maintained by irl-commons. This is v0: curated by hand, incomplete, and subject to corrections and schema changes. Entries carry source-check dates where a content review is recorded; undated words and answers have unknown freshness. Links and service features can change.

**New here?** [Use the data](docs/getting-started.md) in your own app or site in about ten minutes, then read the [worked examples](docs/examples.md) and the [FAQ](docs/faq.md). What changed is in the [changelog](docs/CHANGELOG.md). Questions and ideas go to [Discussions](https://github.com/irl-commons/irl-commons/discussions). How this fits with the open standards for IRL streaming: [openstreambox.org/open-standards.html](https://openstreambox.org/open-standards.html).

- `data/words.json`: terms, plain explanations, other names (`also_called` for true synonyms, `search_terms` for search only), related words and optional translations. Some words also carry a naming guide for app makers: a recommended label for one context, other names with a status, and dated evidence from the apps' own settings.
- `data/answers.json`: short troubleshooting checks, with related words, services and sources.
- `data/services.json`: apps, receivers, hubs, hardware, production tools and documentation, with official links and review dates.
- `data/guides.json`: links to public tutorials, covered services, chain parts and review dates.
- `data/standards.json`: shared formats and protocols (SRT, SRTLA, WHIP and others), who makes them and which products write or read them, in four groups: shared, app formats, hardware and codecs (codecs and camera interfaces), and the stewards' own projects. Codecs and transports carry sourced comparison facts: licensing, efficiency, hardware support, bonding, latency, loss recovery and platform ingest.
- `data/plans.json`: carrier records and optional data plans. Currently empty: no coverage or plan claims are implied. The name leaves room for plans under each carrier without a separate lookup table.
- `schema/src/schema.ts`: Zod schemas and shared rules; the source of truth.
- `schema/json/`: exported JSON Schema draft 2020-12, plus chain-part and role metadata in `parts.json`.
- `schema/fixtures/`: deliberately invalid, synthetic validation examples.
- `scripts/`: validation, schema export and guide title generation.
- `docs/`: a ten-minute guide, worked examples, an FAQ and the changelog.

Validate with Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun run check
bun run export
git diff --exit-code -- schema/json
```

The check validates all six files, cross-references, generated titles, privacy rules, schema drift and rejection fixtures. Carrier checks also exercise a valid synthetic network and virtual operator, missing hosts, country mismatches and duplicates. Run `bun run titles` after changing the service names or relationships used by guide titles, and `bun run aliases` after changing a word's names.

The package is prepared as `@irl-commons/data`; it has not been published to npm. You can clone this repository and use the JSON files directly. After the first reviewed release, install with `npm install @irl-commons/data`. The exported paths are:

```js
import words from '@irl-commons/data/data/words.json' with { type: 'json' };
import wordsSchema from '@irl-commons/data/schema/json/words.schema.json' with { type: 'json' };
```

`@irl-commons/data/schema` exports the TypeScript Zod definitions for runtimes that support TypeScript. Other languages can use the exported JSON Schemas; additional cross-reference rules are documented in `schema/README.md`.

Data (`data/*.json`) is licensed under CC BY 4.0; see `LICENSE-DATA` for the official text. Credit format:

> Data from IRL Commons contributors — https://github.com/irl-commons/irl-commons — CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: [describe changes, or “none”].

Retain supplied attribution and modification notices, link the source and licence, and identify your changes. Data is supplied without warranties. Links do not license the linked third-party material or imply endorsement. Code in `schema/` and `scripts/`, and the remaining repository material, uses the MIT licence in `LICENSE`.

Propose additions or corrections through issues or pull requests. Include public primary sources, stable ids and review dates. Write descriptions in your own words. Keep entries small and verifiable; leave uncertain claims out. Carrier submissions must support every populated field with official sources. Use ISO 3166-1 alpha-2 country codes, `MNO` or `MVNO`, a null host for an MNO and a same-country MNO id for an MVNO. `sources` backs carrier properties; each plan has its own source and checked date. A null data cap means unlimited, while null throttle and tethering values mean unknown. Data caps use decimal GB and throttles use kbit/s. Roaming routing is `home-routed`, `local-breakout` or `unknown`. Do not infer routing from marketing claims. Run the validation and export commands before submitting.

## Freshness

Services, guides, standards, carriers and nested plans require a `checked_on` ISO date; words
and answers may omit it when no content review is recorded. When present it is:
the day its content was checked against its public primary source. A successful
link request alone is not a content check. Preserve actual dates; never infer one from link health or a bulk import.
See [data provenance](data/README.md) for the recorded 2026-11-14 content review.

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

Undated entries have unknown freshness and must not be presented as fresh.
Consumers compute staleness from `checked_on` and today's UTC date; data stores
only dates, never a stale flag. An entry is stale on its due date. Calendar
months clamp to the final day of the target month. Show stale entries with their
date; hide stale plan prices/caps/fair-use figures and service status while
keeping the carrier/service and source visible. Nested plans use their own date.
Run `bun scripts/stale.ts [YYYY-MM-DD]` for a Markdown report. Weekly automation
checks links and updates one freshness issue; it never edits data.

Release setup and the one-time npm package bootstrap are documented in [NPM-PUBLISHING.md](NPM-PUBLISHING.md).
