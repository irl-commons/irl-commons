# Contributing

## What a change needs

- **A public source:** the maker's own page, the standard, or the platform's help. Discord invites must be published on the maker’s own site or README, with a source and checked date. No unofficial invites, community posts or private material.
- **The date you read it.** It becomes the entry's `checked_on`. A link that loads is not a check.
- **Your own words:** neutral, with no rankings, paid placement or affiliate links.
- **Any connection** to the product or a competitor: work, payment or ownership. That's fine; it only means an independent steward reviews it.

## How to send it

- **Issue form:** [pick a form](https://github.com/irl-commons/irl-commons/issues/new/choose). A steward turns it into a pull request with you as co-author.
- **Pull request:** edit the data files and run the [checks](#checks) below.
- **No GitHub account?** Write to hello@irlcommons.org or post on [Discord](https://discord.gg/KChVwU6fjk). Say which entry it is about, what is wrong, missing or still right, the public page that shows it, and when you read it. A steward files the form for you.

## Special cases

- **Confirming an entry:** say what you checked and whether each claim still matches.
- **Behind a login:** when a feature is only described behind a login, a steward may record a dated description supplied by a user. Use source kind `behind login (supplied by a user)`, the date supplied and a neutral paraphrase. Link only the public login page. No keys, secret URLs or account data.
- **Standards:** credit the maker and link products through `service_ids`. An app's own format goes in only once a named second product writes or reads it.
- **Plans:** cite the carrier's page for that country, with its cap, price or fair-use terms. Prices need three stewards first (see [GOVERNANCE.md](GOVERNANCE.md)).

## Propose a different label

A label in the naming guide is a recommendation for one context, not the only right name. To suggest another, use "Fix or update an entry" (or the maker form for your own product) with the entry `words/<id>`, and fill in the label field. A public page or screenshot that shows the label is the best source. Write about the word, not about another product.

## Carriers and plans: field rules

Carrier submissions must support every populated field with official sources. Use ISO 3166-1 alpha-2 country codes, `MNO` or `MVNO`, a null host for an MNO and a same-country MNO id for an MVNO. `sources` backs carrier properties; each plan has its own source and checked date. A null data cap means unlimited, while null throttle and tethering values mean unknown. Data caps use decimal GB and throttles use kbit/s. Roaming routing is `home-routed`, `local-breakout` or `unknown`. Do not infer routing from marketing claims.

## Review

Nobody approves or merges their own or a competitor's entry. Data changes need one independent steward approval. Rule changes (schema, licences, stewards, docs, workflows and scripts; the full list is in [GOVERNANCE.md](GOVERNANCE.md)) need two approvals and wait seven days for objections. With exactly two stewards listed, they need one. A conflicted author always needs an independent approval.

Right now one steward is listed, so the counts and the seven-day wait are off (bootstrap). Conflicts are still declared in the pull request, and the governance check shows them. Everything switches on once a second steward is listed in `stewards.json`.

## Checks

Use the Bun version in [`package.json`](package.json) (`packageManager`); CI reads it too.
Run the checks:

```sh
bun install --frozen-lockfile
bun run check
bun run export
git diff --exit-code -- schema/json
```

`bun run check` validates the six files, cross-references, generated titles, privacy rules, schema drift and the invalid fixtures. Run `bun run titles` after changing service names used in guide titles, and `bun run aliases` after changing a word's names. For a schema change, run `bun run export`, review the JSON Schema and add invalid fixtures for the new rule. Ids never change.

## How a form becomes a change

1. You fill in a form. A steward checks the source.
2. The steward adds the `make-pr` label (only stewards and people with write access can). The bot writes the change into the data file and runs the checks.
3. The bot opens a draft pull request with you as co-author and replies on the issue with the link. If it can't write the change, the reply says why.
4. The steward finishes anything missing and marks the pull request ready for review. The review rules above apply.

### Links that fill in a form

A link can open a form with some fields already filled in, for example a
"Confirm this entry" link next to each entry on a site:

```
https://github.com/irl-commons/irl-commons/issues/new?template=confirm-entry.yml&title=Confirm%3A%20services%2Fmoblin&entry=services%2Fmoblin&source=https%3A%2F%2Fgithub.com%2Feerimoq%2Fmoblin
```

`template` is the form file: `new-entry.yml`, `edit-entry.yml`,
`confirm-entry.yml` or `maker-edit-request.yml`. Every other parameter is a
field id; URL-encode each value. These fields can be filled: `entry` (written
as dataset/id, so the dataset needs no separate choice), `name`, `link`,
`source`, and the text boxes `description`, `checked` and `changes`. The
dropdowns (dataset and conflict of interest) can't be filled by a link, and
`read_on` is left for the person who reads the source. If they leave it empty,
the bot uses the day the issue was opened.

## Releases

Release setup and the one-time npm package bootstrap are documented in [NPM-PUBLISHING.md](NPM-PUBLISHING.md).
