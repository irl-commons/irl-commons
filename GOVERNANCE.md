# Governance (draft)

Sources settle facts: public primary evidence decides data corrections, not votes.
Data changes need one independent, unconflicted review. Rules, schema, licence
and steward changes need two independent, unconflicted reviews and seven days
of lazy consensus: absent a reasoned objection, the proposal may proceed.

A block applies only to rules, must cite a written rule and explain a remedy,
and lapses after 14 days. Two thirds of unconflicted stewards can override it.
A block cannot overrule source evidence or waive the review requirements.

Declare employment, payment and product affiliations in every proposal. Makers
and competitors may submit edit requests with evidence, but cannot approve or
merge their own or a competitor's entry. An independent person reviews and merges.

Stewards: [first steward — pending], [second steward — pending]. There must be
at least two stewards now and at least three before prices are included, with
one seat per company. These placeholders confer no access. The founder has no
special rights. Access and branch protections must reflect these requirements.

npm releases use GitHub Actions trusted publishing only, with no personal npm
tokens. This document does not authorize a release. Code is MIT and data is
CC BY 4.0; contributors retain copyright, with no copyright assignment.

After 90 days without a commit, review or reply, the remaining stewards may give
14 days' public notice and then reassign the silent steward's responsibilities
and access. This applies equally to the founder.

Anyone may fork under the licences, preserve attribution and continue maintenance
if this project becomes inactive or its governance no longer serves contributors.

## GitHub enforcement and bootstrap

The proposed ruleset in `.github/rulesets/main.json` protects main: pull requests,
`validate` and `governance` checks, code-owner review, approval of the last push,
stale-review dismissal, no force pushes, no deletion and no bypass actors.
It is a configuration file, not a live setting. See `.github/rulesets/README.md`
for the apply command and installation order. No workflow changes repository rules.

During bootstrap the numeric approval count is zero with at most one named
steward; it becomes one with two or more, and two for rule paths once three are
listed. `stewards.json` supplies those thresholds. Null handles are unfilled seats
and confer no review authority. The required governance check switches its count
automatically using the policy already on main; proposed changes cannot appoint
their own reviewers. The native ruleset count remains zero; the check enforces
the dynamic count.

At count zero, the author's own PRs may pass the numeric review gate. They still
need CI and governance to pass; rule-path PRs must also complete seven days after
being marked ready for review (creation time for a PR never drafted). A draft
has no running consensus window. Returning to draft and marking ready again
starts a new window. An `objection` label or a steward's unresolved request for
changes fails the check. Daily runs re-evaluate open PRs without a new push.
GitHub's separate last-push and code-owner requirements remain enabled: count
zero does not promise that GitHub will permit a merge without another reviewer.
The actual steward team must replace the CODEOWNERS placeholder before relying
on code-owner protection.

The check counts only current-head approvals from named, unconflicted stewards,
never the PR author. Data conflicts are determined from edited entries, their
maker, and explicit competitor mappings. Same-maker service ids can be derived;
competitors and affiliations must be declared by people. Undeclared interests
cannot be detected. The review API is read with a read-only token; a separate job
has only `checks: write` to report pending/success/failure on the PR head.
Policy code and steward data are read from main. Installation PRs test candidate
logic but cannot enforce an absent base policy until it is merged.

People still verify sources, independence, affiliations, seven-day discussion,
block expiry/overrides, seat limits and succession. A steward must clear an expired
block's label/review after documenting the outcome. Repository administrators
can change settings or workflows; no repository file can prevent that. The weekly
drift watch makes live ruleset changes visible in one issue, without fixing them
automatically. Protecting the workflow files themselves still requires independent
human review and responsible administrators.

The publish workflow runs only for `v*` tag pushes under `irl-commons`. Releases
use GitHub-hosted Actions, npm trusted publishing, OIDC and provenance, with no
npm token secret. Tags and the first release require prior review. A one-time
human package-name bootstrap may create an npm placeholder before trusted
publishing is configured; it must not approve a data release. See
NPM-PUBLISHING.md for the npm settings and bootstrap route.
