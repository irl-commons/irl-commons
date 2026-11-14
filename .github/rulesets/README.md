# Installing protections

These files are API request bodies, not live settings. No workflow applies them.
Review and merge the installation first so main contains the trusted evaluator
and both required checks have run. Consentingly list the first steward and their
affiliations before relying on bootstrap; null seats grant no review authority.

An org owner installs bootstrap from the repository root:

```sh
gh api --method POST repos/irl-commons/irl-commons/rulesets --input .github/rulesets/main.json
```

Inspect existing rulesets first; use PUT for an existing id instead of creating
duplicates. Bootstrap has no bypass, no native approvals, no code-owner or
last-push requirement, and pins `validate` and `governance` to Actions app 15368.
PRs, resolved threads, stale-review dismissal, no deletion and no force-push remain.
The check enforces conflicts even at N=0 and seven days on rule paths.

## Adding the second steward

One reviewed rule-path PR adds the consenting steward in `stewards.json`, sets
CODEOWNERS to `* @irl-commons/stewards` (a real team with write access), copies
`main.steady.json` over `main.json`, and updates the bootstrap status in
GOVERNANCE.md. Wait seven days; the new steward should approve. Main's previous
policy evaluates that addition, so a PR cannot appoint its own reviewers.

After it lands, the check automatically requires one independent approval. It
also reads `GET /repos/irl-commons/irl-commons/rules/branches/main` and fails
closed until live native protection requires at least one approval, code-owner
review and last-push approval. An org owner performs this manual switch:

```sh
gh api repos/irl-commons/irl-commons/rulesets --jq '.[] | select(.name=="main governance") | .id'
gh api --method PUT repos/irl-commons/irl-commons/rulesets/RULESET_ID --input .github/rulesets/main.json
gh api repos/irl-commons/irl-commons/rulesets/RULESET_ID
```

Replace RULESET_ID with the returned id. Read back every flag, no bypass, and
Actions app ids. Confirm the read-only workflow token can see effective branch
rules and `bypass_actors`; missing fields must be treated as drift. Run the drift
workflow manually after installation and switching. It reports, never repairs.

## Release tags

Install both files separately, after review:

```sh
gh api --method POST repos/irl-commons/irl-commons/rulesets --input .github/rulesets/release-tags.json
gh api --method POST repos/irl-commons/irl-commons/rulesets --input .github/rulesets/release-tags-immutable.json
```

Only the repository admin role (id 5) bypasses tag creation restrictions for
`v*`. A separate ruleset forbids update/deletion with no bypass, including for
admins. Keeping these separate prevents a creation exception from also granting
permission to move or delete a release tag. Read both back after applying.

## Conflicts and cadence

`affiliations` contains service ids for makers and direct competitors a steward
works for, owns or is paid by. `entries` maps `dataset/id` to, for example,
`{"maker":"sample-service","competitors":["sample-rival"]}`. Competitors are
explicit, never inferred from a broad category. Edited rows include old and new
ownership. Services with the same maker share conflict subjects; answers and
guides use linked services/covers too.

Review events trigger a read-only no-op workflow; a default-branch `workflow_run`
evaluates all open PRs, including forks, without trusting artifacts or the event's
PR list. A separate job reports checks and never checks out code. PR events and
the daily run also evaluate. API errors fail closed per PR; an outage during
reporting can leave an old check until a successful rerun. Verify the current
head before merging. Scheduled workflows may stop after 60 inactive days.
