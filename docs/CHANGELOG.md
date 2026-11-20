# Changelog

Changes that matter to people who use the data: new files, new fields,
changed rules. Fixes to single entries aren't listed here. The Git history
has them, with their sources.

The data is v0. Fields can still change before the first npm release. Ids
never change.

## Unreleased

- `services.json`: two optional fields. `port_of` marks a port or fork of a
  listed product, with `state` `follows` or `diverged`; the original's entry
  doesn't list its ports, so read them from this field. `wrappers` lists
  Docker images, install scripts and packages that only install the product,
  each with its own maker, page and `checked_on`.

## 0.3.0 — 16 November 2026

- `plans.json`: plans v2, a breaking change. Every plan term is a fact with
  its own `value`, `source` and `checked_on`, so each one goes stale on its
  own. Upload and download ceilings and post-allowance speeds are separate
  fields. Phone sharing (`hotspot`), using the SIM in a router or modem and
  continuous video uploading are three separate rules. A null value means
  the source did not establish it; an unlimited allowance is the explicit
  value `"unlimited"`. `throttle_after_cap_kbps`, `tethering_allowed`, the
  plan-level `source_url` and `checked_on`, and the `unknown` roaming value
  are gone. The file has its first two examples, without prices. See
  [plans v2](plans-v2.md) for the migration.
- `words.json`: a new word, SIM.
- `services.json`: official support channels with channel kind, source and
  check date. Previously listed links keep migration provenance where they
  have not been rechecked.

## Earlier changes

- `services.json`: a third tag, `scene-control`: the product switches the
  scenes in OBS or a hub from outside it, by remote, chat commands or on its
  own. The "Fix or update an entry" form has a tick box for it.
- `words.json`: three new words, hub, source and ingest. "Ingest" is no longer
  a search term of "Ingest and output", which links to the new word instead.
- `services.json`: `tags` now takes two values, each at most once.
  `camera-in`: the product takes the picture from a standalone camera, such
  as a DSLR, mirrorless or action camera, over HDMI, USB or the network.
  `multi-camera`: it shows several cameras in one scene at once. Any other
  tag fails validation. The "Fix or update an entry" form has a tick box for
  each.
- `words.json`: a naming guide for app makers. An optional `naming` block
  recommends a label for one context, lists other names as also used,
  narrower, technical or ambiguous, and keeps dated evidence from the apps' own
  settings. Six words start as drafts: bonding, relay, SRT latency, bitrate,
  BRB and drop protection. Reviewed blocks need evidence from two makers and a
  second steward.
- `words.json`: `aliases` is split into `also_called` (true synonyms, fine to
  show as "Also called") and `search_terms` (plurals, units, spellings and
  syntax, for search only); other names of words in the naming guide sit in
  `naming.alternatives`. `aliases` is deprecated and generated from these for
  one release (`bun run aliases`); read the new fields instead.
- The edit and maker forms have an optional field for the label a product
  uses, and why. See "Propose a different label" in CONTRIBUTING.
- `services.json`: two new fields on every entry. `class` puts each product
  in one overview a streamer would look for: phone apps, helper apps,
  connections, bonding (receivers, relays and bonding services), hardware,
  parts, stores, cloud production, production on your own computer, building
  blocks (protocols, libraries, general media servers) and docs. `hosting` is
  `self` or `service` for things with a server side, and null otherwise; bonding
  and cloud entries always set it.
- The initiative that started this repository is now called IRL Commons.
  `standards.json` names it as the maker of stream-status and stream-session,
  which moved to [irl-commons/stream-status](https://github.com/irl-commons/stream-status)
  and [irl-commons/stream-session](https://github.com/irl-commons/stream-session).
  The credit line is now "Data from IRL Commons contributors". The steward
  affiliation id `openstreambox` is now `irl-commons`; the rules are the same.
- The sites that use the data are howtoirl.org (glossary, link list, guides)
  and irlcommons.org (standards). Contact: hello@irlcommons.org.
- Contributing: issue forms for a new entry, an edit, a confirmation and a
  maker's edit request. A steward can turn a filled-in form into a draft pull
  request with the `make-pr` label. People without a GitHub account can write
  to hello@openstreambox.org or post on Discord. See
  [CONTRIBUTING.md](../CONTRIBUTING.md#how-a-form-becomes-a-change).
- Docs for people who use the data: [Use the data](getting-started.md),
  [worked examples](examples.md) and an [FAQ](faq.md).
- `standards.json`: stream-status and stream-session name the OpenStreamBox
  Initiative as their maker, and the irl-commons entry has a plain
  description. The credit line says "initial data by the OpenStreamBox
  Initiative". Descriptions are "written for this list" instead of "our own
  words".

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

## Naming evidence and other names

Evidence now references catalogue services and records the label seen and whether
it directly supports the meaning or provides context only. Review counts distinct
owning makers through the services catalogue. Ambiguous and narrower names can
point to another word with `see`; synonyms and technical names cannot reuse its
recommended label. Corrected synonym placement and regenerated compatibility aliases.
Recommended labels are unchanged.
