# npm release setup

Package: `@irl-commons/data`. Repository: `irl-commons/irl-commons`.
Only reviewed `v*` tags whose commits are ancestors of main can reach staging;
the tag must equal `v` plus package.json's version. Install both release-tag
rulesets as described in `.github/rulesets/README.md` before releasing.

Create the `npm-release` GitHub environment with deployment tags restricted to
`v*`. With two stewards, require a reviewer and prevent self-review. Configure
npm trusted publishing with organization `irl-commons`, repository `irl-commons`,
workflow `publish.yml`, environment `npm-release`, and allowed action **stage
publish**. Require 2FA and disallow publishing tokens in npm publishing access.

Tests, dependency installation (scripts disabled), ancestry, version and schema
drift checks run in a read-only verify job. Only the separate staging job has
`id-token: write`. It checks out the reviewed tag, installs no dependencies and
runs no tests or lifecycle scripts. It uses Node 24, a staging-capable npm CLI,
and `npm stage publish --ignore-scripts --provenance --access public`.
A steward approves the staged release interactively on npmjs.com with 2FA.
No long-lived npm token is used.

## One-time package placeholder

The package must already exist before a trusted publisher can be configured.
An npm org owner performs these interactive steps near release time:

1. Enable 2FA, confirm the npm org, and arrange at least two org owners from
   different companies (three before prices).
2. Run `npm login` locally. In a minimal reviewed directory use package name
   `@irl-commons/data` and version `0.0.0-bootstrap.0`.
3. Run `npm stage publish --access public`. For a new package this creates a
   public placeholder. **Reject that staged version; do not approve it.**
4. Set up the trusted publisher and publishing access above.
5. Make the first real successful publish within **two days** of configuration
   or recreate the configuration. A reviewed matching tag on main runs Actions;
   approve that staged version on npmjs.com with 2FA.

This procedure documents setup; it does not authorize a tag or release.
References: [trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[npm stage](https://docs.npmjs.com/cli/v11/commands/npm-stage/).
