# Contributing

Propose an entry, correction or confirmation with a pull request or the matching
issue template. Give the dataset and permanent id, public HTTPS primary source,
date you read it, and the specific claim or fields it supports. Use your own
words, neutral descriptions and no rankings, paid placement or affiliate links.
Do not copy community posts, private material or credentials.

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

Run `bun install --frozen-lockfile`, `bun run check`, `bun run export` and
`git diff --exit-code -- schema/json`. For intentional schema changes, regenerate
and review the JSON Schema first, then repeat the drift check. Add invalid
fixtures for new constraints. Keep ids stable and all cross-references valid.
