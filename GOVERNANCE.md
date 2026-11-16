# Governance (draft)

## Principles

- Sources settle facts. Public evidence decides data corrections, not votes.
- Everyone declares work, payment and ownership ties in every proposal. Makers and direct competitors can submit evidence, but they can't approve or merge their own or a competitor's entry.
- The founder has no special rights.

## Who reviews what

| Change | Approvals | Wait |
|---|---|---|
| Data | 1 independent steward | none |
| Rules | 2 stewards (1 while exactly two are listed) | 7 days for objections |
| Any change by a conflicted author | at least 1 independent steward | as above |

Rules means governance and contributing docs, steward policy, README, NPM-PUBLISHING.md, data/README.md, package.json, bun.lock, licences, schema, workflows, rulesets and all scripts.

The seven days start when the pull request is ready for review. A force-push starts them again. Drafts wait.

## Blocks

A steward can block a rule change. A block must cite a written rule and suggest a fix, and it ends after 14 days. Two thirds of the unconflicted stewards can override it. A block can't overrule source evidence or skip review. On data, sources decide and people settle disagreements in review.

## Stewards and owners

One steward is listed in `stewards.json`: `pjeweb` (affiliation: irl-commons). The second seat is open and gives no access.

- Launch needs two stewards. Prices need three, one seat per company.
- The GitHub and npm organisations each need at least two owners now, and three before prices, one seat per company. This is a requirement, not a claim that the seats are filled.
- Owners run the accounts. Stewards review policy and data.
- After 90 days without a commit, review or reply, the other stewards may give 14 days' public notice and hand over a silent steward's tasks and access. This applies to the founder too.

Anyone may fork under the licences, keep the attribution and continue the work.

## Bootstrap: while only one steward is listed

The review counts and the seven-day wait are off, so the one steward can merge their own changes. Every pull request stays public, so anyone can review it afterwards. Conflicts are still declared, and the governance check shows them without blocking. Sources still settle facts, objections on rule changes still block, and the required checks still run.

Everything switches on automatically once a second steward is listed. GitHub's own branch protection needs a manual switch, described in [.github/rulesets/README.md](.github/rulesets/README.md).

## Licences and releases

Code is MIT and data CC BY 4.0. Contributors keep their copyright. npm releases use trusted publishing with no personal tokens, and a person approves each version with 2FA. This document authorizes no release. Details are in [NPM-PUBLISHING.md](NPM-PUBLISHING.md).
