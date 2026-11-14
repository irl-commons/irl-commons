# Applying the main ruleset

`main.json` is a GitHub repository-ruleset API request body. It is active when
applied, has no bypass actors, and sets the native numeric review count to zero.
The required `governance` check reads the committed steward policy to enforce
0/1/2 reviews automatically. Do not apply this file before reviewing and merging
the installation PR: main must contain the trusted evaluator and reporting
workflow, and both required check names must have run. Fill the CODEOWNERS team
with a real team before relying on owner review; placeholders grant no access.

From the repository root, an authorized administrator applies it once with:

```sh
gh api --method POST repos/irl-commons/irl-commons/rulesets --input .github/rulesets/main.json
```

For an existing ruleset, read its id with `gh api
repos/irl-commons/irl-commons/rulesets`, review it, then use `--method PUT` at
`repos/irl-commons/irl-commons/rulesets/RULESET_ID` with the same input. Do not
create duplicates. Read back the saved ruleset and confirm no bypass actors,
main targeting, both check names and all review flags. The weekly drift job
compares the live named ruleset with the committed configuration and updates one
issue on differences. It never applies settings.

GitHub API reference: https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset

## Steward policy

In `stewards.json`, replace null `github` values with actual consenting stewards'
handles. Keep one seat per company. `affiliations` contains service ids, including
any maker or competitor the person works for, owns or is paid by. Empty pending
seats are not counted. Ordinary data requires zero approvals with fewer than two
named stewards and one thereafter. Rule paths need two once at least three
stewards are named; with two, they require one plus the seven-day window.

The optional `entries` mapping uses `dataset/id` keys and values shaped like
`{"maker":"sample-service","competitors":["sample-rival"]}` (synthetic example).
For services, same-maker service ids are derived from the service's maker text;
for answers and guides, linked services/covers are also conflict subjects. Do not
infer direct competition from a broad category: record it explicitly after review.
Only edited rows are evaluated, including previous ownership on deletion/change.

The evaluator always reads policy from main, so a PR changing this file must
satisfy the previous policy. `governance` is a separately reported check on the
current PR head. Review, push, readiness and label events re-evaluate it; the daily
run handles elapsed time. API errors fail the evaluator and the reporting job attempts to mark affected
PRs failed; a GitHub outage or interrupted report can still leave a previous check
unchanged until the next successful run. Last-push approval is additionally enforced by GitHub.
