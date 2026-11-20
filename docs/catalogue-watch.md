# Catalogue watch

`bun run watch` helps stewards pick which entries to recheck first. It never edits data: a signal is a reason to look, not a check.

## What it reports

- **Entries to recheck.** It reads each service's and standard's public sources (GitHub releases and READMEs, App Store versions, page text compared with earlier runs, redirects and Discord invite validity) and ranks entries by what changed since their `checked_on`, with the reasons.
- **Products not listed yet.** It lists candidates from GitHub and App Store searches, makers' other repositories, links on makers' pages and names in standards' `other_users`, each with the maker's page and a draft entry marked unverified.

Page text changes show from the second run on, because the first run is the baseline. Releases, App Store versions and repository state work from the first run.

## Running it

```sh
bun run watch [--state DIR] [--today YYYY-MM-DD] [--only signals|discover] [--max-age HOURS] [--offline]
```

Reports, cache and snapshots go to `--state`, else `$CATALOGUE_WATCH_DIR`, else `.catalogue-watch/` in the repository, which Git ignores. Set `GITHUB_TOKEN` or `GH_TOKEN` for GitHub's API limits; a read-only token is enough.

The Catalogue watch workflow runs the same command when started by hand and posts the short version to one rolling issue. The full report is in the run's artifact.

## Fetching

It identifies itself as `irl-commons-catalogue-watch`, follows robots.txt for pages, keeps requests to each site slow and caches responses with conditional requests.
