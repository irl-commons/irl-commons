# Governance (draft)

Sources settle facts: public primary evidence decides data corrections, not votes.
Data normally needs one independent, unconflicted steward approval. Rule paths
need two and seven days of lazy consensus; with exactly two listed stewards they
need one approval. An author conflict requires at least one independent steward
approval. While fewer than two stewards are listed, the bootstrap clause below
applies instead.

A block applies only to rules, must cite a written rule and explain a remedy,
and lapses after 14 days. Two thirds of unconflicted stewards can override it.
A block cannot overrule source evidence or waive review requirements. The
`objection` label and unresolved steward change requests fail the check only on
rule paths. On data paths, sources decide; people resolve review disagreements.

Declare employment, payment and product affiliations in every proposal. Makers
and direct competitors may submit evidence but cannot approve or merge their
own or a competitor's entry. Outside bootstrap, a non-conflicted steward must
approve a conflicted author's edit, or it waits, and an independent person
presses merge.

There is currently **one named steward** in `stewards.json`, `pjeweb`
(affiliation: openstreambox); the second seat is pending and grants no access.
Launch needs two stewards; until the second is listed, the bootstrap clause
below applies. Prices need three, one seat per company.
The GitHub org and npm org each require **at least two org owners now**, and
three before prices, one seat per company. This is a setup requirement, not a
claim that the accounts or seats have already been filled. Owners administer
accounts; stewards review policy/data. The founder has no special rights.

npm releases use Actions trusted publishing with no personal npm tokens and
human 2FA approval of staged versions. This document authorizes no release.
Code is MIT and data CC BY 4.0; contributors retain copyright without assignment.

After 90 days without a commit, review or reply, remaining stewards may give
14 days' public notice and reassign the silent steward's responsibilities and
access. This applies equally to the founder. Anyone may fork under the licences,
preserve attribution and continue maintenance if governance no longer serves them.

## Bootstrap: while only one steward is listed

While `stewards.json` lists fewer than two stewards, the review counts (one
independent approval for data, two for rules, schema and licence) and the
seven-day objection window don't apply. In practice the one steward can merge
their own changes; every pull request stays public, so anyone can review it
afterwards.

A conflict of interest is still declared in the pull request. The governance
check shows any conflict it finds, but doesn't block on it. Sources still settle
facts, objections and steward change requests on rule paths still block, and
the required checks still run.

All of this switches on automatically once a second steward is listed in
`stewards.json`. No other rule change is needed: the check enforces the counts,
the window and conflicts from its next run. GitHub's own branch protection is
separate and still needs the manual ruleset switch described below.

## GitHub, the check, and people

The committed bootstrap main ruleset requires PRs, resolved review threads,
`validate` and `governance` from Actions app 15368, stale-review dismissal, no
force-push, no deletion and no bypass. Its native approval count is zero; it
requires neither code-owner nor last-push approval. Files are not live settings.
Installation must land on main before its check is required; see
`.github/rulesets/README.md` for owner apply commands. Workflows never apply rules.

A second-steward PR adds the handle/affiliations, sets a real CODEOWNERS team,
copies `main.steady.json` over `main.json`, and updates this bootstrap status.
After it lands, the check requires one approval and fails every PR until an org
owner manually PUTs the steady ruleset. GitHub then enforces code-owner review,
at least one approval and approval of the last push. The check adds declared
conflicts, current-head independent steward approvals and two approvals for rule
paths once three stewards are listed. Proposed policy cannot appoint its reviewers:
code and policy always come from main.

Rule paths include governance/contribution documents, steward policy, README,
NPM-PUBLISHING.md, data/README.md, package.json, bun.lock, licences, schema,
workflows/rulesets and all scripts. Outside bootstrap, seven days start at ready-for-review (creation
for never-draft PRs). A force-push restarts the window. Return substantive ordinary
pushes to draft, then mark ready to restart it. Drafts wait; reopening alone does
not restart the window. Daily evaluation handles elapsed time.

Only edited entries contribute conflicts, using both old and new maker ownership,
linked services and explicit competitor mappings. Conflicted approvals are ignored
and noted; they cannot veto otherwise sufficient independent approvals. Undeclared
interests cannot be detected. The author's own approval never counts.

Fork and same-repo reviews run a permissionless no-op trigger. A `workflow_run`
uses main's evaluator with read-only API access and evaluates all open PRs. It
never trusts PR code, artifacts or the trigger's PR list. A separate check reporter
has `checks: write` and no checkout. API failures fail closed; a failed report can
leave a previous check until rerun, so verify the current head before merging.

People still verify sources, affiliations and independence; who presses merge;
whether a block cites a written rule; expiry and the two-thirds override count;
seat limits, succession and substantive-change discussion. The check cannot stop
a conflicted person pressing merge once valid approvals exist. Clear an expired
label/review only after documenting its outcome. Administrators can alter settings
and workflows; drift monitoring makes changes visible but cannot prevent them.
GitHub may disable scheduled daily, weekly and drift workflows after 60 days of
inactivity. Check their status and run them manually when necessary.

Releases stage only from `v*` tags on main, in the restricted `npm-release`
environment, after read-only tests pass. Only the separate staging job can mint
OIDC tokens; it runs no tests, dependency installation or lifecycle scripts.
Release tag creation is admin-only and tags are immutable. A one-time interactive
placeholder is published before trusted publishing setup and removed after the first release; see NPM-PUBLISHING.md.
