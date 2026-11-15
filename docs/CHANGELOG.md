# Changelog

Changes that matter to people who use the data: new files, new fields,
changed rules. Fixes to single entries aren't listed here. The Git history
has them, with their sources.

The data is v0. Fields can still change before the first npm release. Ids
never change.

## Unreleased

- Docs for people who use the data: [Use the data](getting-started.md),
  [worked examples](examples.md) and an [FAQ](faq.md).

## 15 November 2026

- `standards.json`: stream-session is published, with its repository,
  licence and a plain description
  ([#5](https://github.com/irl-commons/irl-commons/pull/5)).
- `standards.json`: a `hardware-codecs` group (H.264, HEVC, AV1, AAC, Opus,
  UVC, HDMI, SDI), NDI in the shared group, and comparison facts for codecs
  and transports, each with sources and its own `checked_on`. A standard that
  is also a glossary word now shares the word's id and points to it with
  `word` instead of repeating the definition
  ([#3](https://github.com/irl-commons/irl-commons/pull/3)).
- Freshness: one required `checked_on` date for services, guides,
  standards, carriers and plans, a stale period per file, and
  `scripts/stale.ts` for a report
  ([#1](https://github.com/irl-commons/irl-commons/pull/1)).
- `standards.json`: the first list of shared formats and protocols, with
  their makers credited ([#1](https://github.com/irl-commons/irl-commons/pull/1)).
- Draft governance and contribution rules, with the bootstrap clause while
  there is one steward ([#1](https://github.com/irl-commons/irl-commons/pull/1)).
- Release setup for the npm package (not published yet)
  ([#4](https://github.com/irl-commons/irl-commons/pull/4),
  [#6](https://github.com/irl-commons/irl-commons/pull/6)).

## 14 November 2026

- First data: `words.json`, `answers.json`, `services.json`, `guides.json`
  and an empty `plans.json`, with zod schemas, exported JSON Schemas and
  checks.
