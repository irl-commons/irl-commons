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

6. Stage it. A prerelease version needs an explicit tag:

   ```sh
   npx npm@11.21.2 stage publish --access public --tag bootstrap
   ```

   For a new package npm creates the public placeholder version `0.0.0-stage`.
   The staged `0.0.0-bootstrap.0` stays private.
7. List the staged versions and note the stage id of `0.0.0-bootstrap.0`:

   ```sh
   npx npm@11.21.2 stage list @irl-commons/data
   ```

8. Reject it (prompts for 2FA). **Reject; do not approve.**

   ```sh
   npx npm@11.21.2 stage reject <stage-id>
   ```

9. Verify. `stage list` must show nothing staged, and `view` must print a list
   containing `0.0.0-stage` and not `0.0.0-bootstrap.0`. If `view` returns 404,
   the package does not exist: stop here and configure nothing.

   ```sh
   npx npm@11.21.2 stage list @irl-commons/data
   npx npm@11.21.2 view @irl-commons/data versions --json
   ```

10. Create the `npm-release` GitHub environment, restricted to `v*` tags,
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
11. Configure the trusted publisher for stage publish only (prompts for 2FA),
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
12. On npmjs.com, open package Settings → Publishing access, select "Require
    two-factor authentication and disallow tokens", and save.
13. Log out:

    ```sh
    npx npm@11.21.2 logout
    ```

14. Make the first real successful publish within **two days** of step 11.
    Otherwise the configuration expires: delete it and repeat step 11. A
    reviewed `v<version>` tag on main stages the real version in Actions.
    Approve that staged version on npmjs.com (Staged Packages) with 2FA.

This procedure documents setup; it does not authorize a tag or release.
References: [trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[npm stage](https://docs.npmjs.com/cli/v11/commands/npm-stage/),
[staged publishing](https://docs.npmjs.com/staged-publishing).
