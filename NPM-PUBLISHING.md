# npm release setup

Package: `@irl-commons/data`. Repository: `irl-commons/irl-commons`.
The first release waits for review. Creating or pushing a `v*` tag runs
`.github/workflows/publish.yml`; the tag must equal `v` plus package.json's
version. No tag or package is created by preparing this change.

On npmjs.com, open **@irl-commons/data → Settings → Trusted publishing → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `irl-commons` |
| Repository | `irl-commons` |
| Workflow filename | `publish.yml` (filename only) |
| Environment | Leave empty (workflow uses none) |
| Allowed actions | Enable direct `npm publish` |

The workflow uses GitHub-hosted runners, Node 24/npm with OIDC support,
`--provenance`, and `id-token: write` only on the publishing job. It has no token
secret. Configure the publisher near release time: its first successful publish
must occur within two days or the connection must be recreated. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Package does not exist yet

npm requires a registry package before adding a trusted publisher; creating the
org alone is insufficient. See [npm trust requirements](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

A minimal bootstrap avoids a long-lived CI token: after separate review, an npm
org member signs in interactively with `npm login` and stages a small reviewed
bootstrap package named `@irl-commons/data` at a distinct prerelease version such
as `0.0.0-bootstrap.0`, using `npm stage publish --access public`. npm creates a
public placeholder, while the staged contents stay unpublished until approval.
Do not approve that staged package as a data release. Then configure the trusted
publisher above. The reviewed first data version (for example `0.1.0`) is
published from Actions by its matching tag. This bootstrap has not been performed.
See [npm scoped-package staging](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

If staging is unavailable for the account, a separately authorized, reviewed
one-time interactive first publish with 2FA is the fallback; it would need an
explicit exception to the Actions-only release policy. Do not add a permanent
npm publishing token to Actions to get around initial setup.
