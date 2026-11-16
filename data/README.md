# Data files

Six files. Each has a short `about` and one list. The JSON Schemas in [`../schema/json/`](../schema/json/) describe every field.

## Primary data

- `words.json`: IRL streaming terms, explained in simple language, with other names, related words and a source. Some words also have a naming guide for app makers: a recommended label for one screen or setting, other names with a status, and dated evidence from apps' own settings. The guide is advice, not the only right name.
- `answers.json`: quick checks for common problems, along the chain a stream takes: camera and mic, sender, connections, receiver, OBS, platform. Each answer says which part most likely broke and gives up to three checks. Checks name no products; products are linked instead.
- `plans.json`: mobile carriers and their data plans. Dated examples backed by the carriers’ own pages, without prices or rankings.

## Directories

- `services.json`: apps, relays and receivers, hosted services, hardware, production tools and docs. One entry per product, with the maker's own page and official support channels.
- `guides.json`: links to public tutorials, with the products they cover and the part of the chain they help with.
- `standards.json`: formats and protocols that IRL streaming products share, such as SRT, SRTLA, codecs and camera interfaces. Each entry credits its maker, says how open it is and names the products that use it. Codecs and transports carry comparison facts, each with its own sources and date. Items made by stewards of this repository are listed apart. Being listed doesn't mean IRL Commons makes, runs or endorses it.

## Rules for every file

Descriptions are written for this list. Sources are public pages: the makers' own pages, standards and platform help. No chat invites, private links or community posts. Ids never change.

All JSON data here is CC BY 4.0; see `../LICENSE-DATA` and the credit line in [Getting started](../docs/getting-started.md#3-give-credit). Retain supplied attribution and modification notices, link the source and licence, and identify your changes. Data is supplied without warranties. Links do not license the linked third-party material or imply endorsement.

## Freshness

Entries have a `checked_on` date: the day someone compared the entry with its public source. A link that loads is not a check, and dates are never guessed. Words and answers may leave the date out. Their freshness is then unknown, and they must not be shown as fresh.

| Dataset or field | Stale after |
| --- | --- |
| Words | 18 calendar months |
| Answers | 12 calendar months |
| Guides | 9 calendar months |
| Services | 6 calendar months |
| Standards | 6 calendar months |
| Standards comparison facts (each by its own `checked_on`) | 6 calendar months |
| Carrier records | 6 calendar months |
| Each plan fact; service `status` | 90 days |

Work out staleness from `checked_on` and today's UTC date; the data stores only dates. An entry is stale on its due date. Months end at the last day of the month: 2026-08-31 plus 6 months is 2027-02-28. Show stale entries with their date. Hide stale plan facts and service status, but keep the carrier or service and its source visible. Each plan fact uses its own date; a recheck of one fact does not refresh the others. `bun scripts/stale.ts [YYYY-MM-DD]` prints a report. A weekly job checks the links and updates one freshness issue; it never edits data. Past source-check rounds are logged in the [Source checks](https://github.com/irl-commons/irl-commons/discussions/47) discussion.

## Support links

Service `support` links keep `label` and `url` and add `kind`: `discord`,
`forum`, `help`, `docs`, `contact` or `github` (issue trackers). Typed links
require a channel-level `checked_on` and `source`, the maker's public page or
README that publishes the channel. Existing destinations can cite themselves;
the migration preserves their recorded check dates. Discord invites must come
from the maker, never from an invite directory or a guessed address. A maker's
stable Discord redirect is also a `discord` channel.

For one release, legacy `label`/`url` pairs without the new fields remain valid.
Consumers should use `kind` when present and fall back to the label for legacy
links. The shipped catalogue is fully typed. Adding a channel does not claim
that every other field in the service was rechecked.
