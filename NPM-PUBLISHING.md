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
An npm org owner performs these interactive steps near release time, in order:

1. Use npm 11.15.0 or newer with Node 22.14.0 or newer; npm 10.9 has no `stage`
   command. Every npm command below runs a pinned CLI through `npx`. Check it:

   ```sh
   npx npm@11.21.2 --version
   npx npm@11.21.2 stage --help
   ```

2. Enable 2FA on the npm account. Confirm the `irl-commons` npm org has at least
   two owners from different companies (three before prices).
3. Log in:

   ```sh
   npx npm@11.21.2 login
   ```

4. In a new empty directory, create exactly two files. `package.json`:

   ```json
   {
     "name": "@irl-commons/data",
     "version": "0.0.0-bootstrap.0",
     "license": "(MIT AND CC-BY-4.0)"
   }
   ```

   and `README.md` with one line, `Placeholder. Not a release.` Add no scripts,
   dependencies or other files.
5. Check the contents. The output must list only `README.md` and `package.json`,
   with version `0.0.0-bootstrap.0`:

   ```sh
   npx npm@11.21.2 pack --dry-run
   ```

6. Publish it directly under the `bootstrap` dist-tag (prompts for 2FA). A
   prerelease version needs an explicit tag:

   ```sh
   npx npm@11.21.2 publish --access public --tag bootstrap --ignore-scripts
   ```

   Do not stage the placeholder and then reject it. For a new package,
   `stage publish` creates a public `0.0.0-stage` version, and rejecting the
   only staged version unpublishes the whole package. npm then refuses any
   publish of that name for 24 hours. The placeholder stays until the first
   real release is out (step 12).
7. Verify. `versions` must list only `0.0.0-bootstrap.0` and `dist-tags` must
   include `bootstrap`. If `view` returns 404, the package does not exist: stop
   here and configure nothing.

   ```sh
   npx npm@11.21.2 view @irl-commons/data versions dist-tags --json
   ```

8. Create the `npm-release` GitHub environment, restricted to `v*` tags,
    before any tag exists. Otherwise the first tag push creates it unprotected:

    ```sh
    gh api --method PUT repos/irl-commons/irl-commons/environments/npm-release --input - <<'JSON'
    {"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
    JSON
    gh api --method POST repos/irl-commons/irl-commons/environments/npm-release/deployment-branch-policies -f name='v*' -f type=tag
    gh api repos/irl-commons/irl-commons/environments/npm-release/deployment-branch-policies
    ```

    The read-back must show exactly one policy: name `v*`, type `tag`. While
    there is one steward, add no required reviewer. From two stewards, require
    a reviewer and prevent self-review.
9. Configure the trusted publisher for stage publish only (prompts for 2FA),
    then read it back:

    ```sh
    npx npm@11.21.2 trust github @irl-commons/data --file publish.yml --repo irl-commons/irl-commons --env npm-release --allow-stage-publish
    npx npm@11.21.2 trust list @irl-commons/data
    ```

    Do not pass `--allow-publish`. The read-back must show repository
    `irl-commons/irl-commons`, workflow `publish.yml` and environment
    `npm-release`. On npmjs.com the same settings are under package
    Settings → Trusted publishing → GitHub Actions, with direct publish and
    dist-tag left off.
10. On npmjs.com, open package Settings → Publishing access, select "Require
    two-factor authentication and disallow tokens", and save.
11. Make the first real successful publish within **two days** of step 9.
    Otherwise the configuration expires: delete it and repeat step 9. A
    reviewed `v<version>` tag on main stages the real version in Actions.
    Approve that staged version on npmjs.com (Staged Packages) with 2FA.
12. Once the real version is on npm and `latest` points at it, remove the
    placeholder (prompts for 2FA). npm allows unpublishing a single version
    within 72 hours of publishing it; it is safe now because it is no longer
    the only version. Never do this while the placeholder is the only version.
    Version numbers cannot be reused, so a later placeholder would be
    `0.0.0-bootstrap.1`.

    ```sh
    npx npm@11.21.2 unpublish @irl-commons/data@0.0.0-bootstrap.0
    npx npm@11.21.2 view @irl-commons/data versions dist-tags --json
    ```

    The read-back must list only real versions, with no `bootstrap` tag. After
    72 hours, deprecate the placeholder instead.

13. Log out:

    ```sh
    npx npm@11.21.2 logout
    ```

This procedure documents setup; it does not authorize a tag or release.
References: [trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[npm stage](https://docs.npmjs.com/cli/v11/commands/npm-stage/),
[staged publishing](https://docs.npmjs.com/staged-publishing),
[unpublish policy](https://docs.npmjs.com/policies/unpublish).
