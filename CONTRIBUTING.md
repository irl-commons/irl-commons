# Contributing

Propose an entry, correction or confirmation with a pull request or one of the
[issue forms](https://github.com/irl-commons/irl-commons/issues/new/choose). Give the dataset and permanent id, public HTTPS primary source,
date you read it, and the specific claim or fields it supports. Use your own
words, neutral descriptions and no rankings, paid placement or affiliate links.
Do not copy community posts, private material or credentials.

When a feature is only described behind a login, a steward may record a dated, user-supplied description; no keys, secret URLs or account data.
Use source kind `behind login (supplied by a user)`, the date supplied, and a
neutral paraphrase; link only to the public login page and note that the text
is behind login.

A confirmation must say what you actually checked and whether each claim still
matches. Set `checked_on` to that source-check date, never just the day a link
returned success. Preserve uncertainty; do not invent historical check dates.
For standards, credit the maker, link products through `service_ids`, and add
an app's own format only once a named second product writes or reads it.
For plans, cite the carrier's country-specific page and its cap, price or
fair-use terms. Prices require three stewards first (see GOVERNANCE.md).

Declare employment, payment, ownership and competing-product affiliations.
Makers should use an edit request; an unconnected reviewer verifies the evidence
and merges. Nobody merges their own or a competitor's entry. One independent
steward review is normally required for data; two for rule paths (including
schema, licence and stewards); with exactly two listed stewards, rule paths need
one. A conflicted author needs an independent steward approval, and rule changes
wait seven days for objections. While fewer than two stewards are listed
(bootstrap), those counts and the seven-day window don't apply: still declare any
conflict in the PR, and the governance check shows it without blocking. They
switch on automatically once a second steward is listed in `stewards.json`.
See GOVERNANCE.md for the exact rules.

Run the checks with Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun run check
bun run export
git diff --exit-code -- schema/json
```

The check validates all six files, cross-references, generated titles, privacy rules, schema drift and rejection fixtures. Carrier checks also exercise a valid synthetic network and virtual operator, missing hosts, country mismatches and duplicates. Run `bun run titles` after changing the service names or relationships used by guide titles, and `bun run aliases` after changing a word's names. For intentional schema changes, regenerate
and review the JSON Schema first, then repeat the drift check. Add invalid
fixtures for new constraints. Keep ids stable and all cross-references valid.

## Carriers and plans

Carrier submissions must support every populated field with official sources. Use ISO 3166-1 alpha-2 country codes, `MNO` or `MVNO`, a null host for an MNO and a same-country MNO id for an MVNO. `sources` backs carrier properties; each plan has its own source and checked date. A null data cap means unlimited, while null throttle and tethering values mean unknown. Data caps use decimal GB and throttles use kbit/s. Roaming routing is `home-routed`, `local-breakout` or `unknown`. Do not infer routing from marketing claims.

## Propose a different label

The words in the naming guide recommend a label for one context; they don't
say any other label is wrong. If your product uses another label, or you think
a different one would serve streamers better, open "Fix or update an entry"
(or "Edit request from the maker" if it's your product) with the entry
`words/<id>`. Say what you suggest under "What changed", and use the optional
field for the label your product uses and why. A public page or screenshot that
shows the label is the best source. Write reasons about the word, not about
another product. A steward adds what you show as evidence or as another name.

## No GitHub account?

Write to hello@irlcommons.org, or post on Discord
(https://discord.gg/KChVwU6fjk). Say which entry it is about, what is wrong,
missing or still right, the public page that shows it, and the date you read
that page. A steward files the matching issue form for you and links it in the
reply; the change then follows the same steps as any other.

## How a form becomes a change

There are four issue forms: suggest a new entry, fix or update an entry,
confirm an entry still holds, and an edit request from the maker. Each one asks
for the entry, the source, the date you read it and any conflict of interest.

1. You fill in a form. A steward reads it and checks that the source is public
   and says what the form says.
2. The steward adds the `make-pr` label. The "Form to draft pull request"
   workflow then checks that the person who added the label is a listed steward
   or has write access, reads the form as plain text, writes the entry into the
   right data file with `checked_on` set to the date you read the source, and
   runs `bun run check`.
3. It opens a draft pull request that links the issue and names you as
   co-author. The issue gets a reply with the link. If GitHub doesn't let the
   workflow open the pull request, the reply links the ready branch instead,
   and a steward opens the draft from there. If the form can't be
   written automatically (a change described only in words, or a problem in
   the form), the reply says why, and the label comes off so it can be added
   again after a fix.
4. The steward compares the draft with the source and finishes anything still
   missing on the same branch, for example the fields of a new entry that the
   form doesn't ask for. Marking the pull request ready for review starts the
   `validate` and `governance` checks. Merging follows the rules above and in
   GOVERNANCE.md; the workflow can't bypass them.

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
