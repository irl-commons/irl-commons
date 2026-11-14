"""Evaluate review evidence. API access is GET-only; check reporting is separate."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
import urllib.request

RULE_FILES = {'GOVERNANCE.md', 'CONTRIBUTING.md', 'stewards.json', 'README.md',
              'NPM-PUBLISHING.md', 'package.json', 'bun.lock', 'data/README.md'}


def rule_path(path):
    return (path in RULE_FILES or path.startswith(('LICENSE', 'schema/', '.github/', 'scripts/'))
            or path.lower().split('/')[-1].startswith(('steward', 'maintainer'))
            or path in {'scripts/governance.py', 'scripts/ruleset_drift.py'})


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def evaluate(config, pr, reviews, paths, events, changes, services, now, live_rules=None):
    stewards = {s['github'].lower(): set(s['affiliations'])
                for s in config['stewards'] if s.get('github')}
    policy = config['approval_policy']
    rules = any(rule_path(p) for p in paths)
    count = len(stewards)
    needed = policy['solo'] if count < 2 else policy['rules'] if rules and count >= 3 else policy['data']
    errors = []
    notes = []
    if count >= 2 and not any(
        rule.get('type') == 'pull_request'
        and rule.get('parameters', {}).get('require_last_push_approval') is True
        and rule.get('parameters', {}).get('require_code_owner_review') is True
        and rule.get('parameters', {}).get('required_approving_review_count', 0) >= 1
        for rule in (live_rules or [])
    ):
        errors.append('Steady ruleset not applied; an org owner must apply it before merges resume.')
    latest = {}
    for review in sorted(reviews, key=lambda r: r['id']):
        if review['state'] in {'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'}:
            latest[review['user']['login'].lower()] = review
    blocked = 'objection' in {label['name'].lower() for label in pr.get('labels', [])}
    if any(r['state'] == 'CHANGES_REQUESTED' for who, r in latest.items() if who in stewards):
        blocked = True
    if rules and blocked:
        errors.append('Unresolved objection label or steward request for changes.')
    forbidden = set()
    # Only edited rows contribute conflicts, not every maker in a changed file.
    for dataset, entry in changes:
        key = f'{dataset}/{entry["id"]}'
        mapping = config.get('entries', {}).get(key, {})
        forbidden.update(mapping.get('competitors', []))
        maker = mapping.get('maker')
        if maker:
            forbidden.add(maker)
        if dataset == 'services':
            forbidden.add(entry['id'])
            # Maker text only derives same-maker affiliations; never infer competitors.
            forbidden.update(s['id'] for s in services if s['maker'].casefold() == entry['maker'].casefold())
        else:
            forbidden.update(entry.get('services', entry.get('covers', [])))
    author = pr['user']['login'].lower()
    if stewards.get(author, set()) & forbidden:
        needed = max(needed, 1)
        notes.append('PR author is conflicted; an independent steward must approve or this PR waits.')
    approvals = []
    for who, review in latest.items():
        if review['state'] != 'APPROVED':
            continue
        if who == pr['user']['login'].lower() or review.get('commit_id') != pr['head']['sha']:
            continue
        if who in stewards and stewards[who] & forbidden:
            notes.append(f'Conflicted approving steward ignored: {who}.')
            continue
        if who in stewards:
            approvals.append(who)
    if len(approvals) < needed:
        errors.append(f'Need {needed} independent steward approvals; found {len(approvals)}.')
    pending = False
    due = None
    if rules:
        ready = [e['created_at'] for e in events if e.get('event') in {'ready_for_review', 'head_ref_force_pushed'}]
        was_draft = pr.get('draft') or any(e.get('event') == 'convert_to_draft' for e in events)
        start = max(ready) if ready else None if was_draft else pr['created_at']
        if pr.get('draft') or start is None:
            pending = True
        else:
            due = timestamp(start) + dt.timedelta(days=7)
            pending = now < due
    return {'state': 'failure' if errors else 'pending' if pending else 'success',
            'summary': f'{count} listed stewards; N={needed} ({"rules" if rules else "data"}); '
                       f'{len(approvals)} current-head approvals. '
                       + ('Waiting for ready-for-review and seven days. ' if pending else '')
                       + (f'Window ends {due.isoformat()}. ' if due else '') + ' '.join(notes + errors)}


def api(path):
    req = urllib.request.Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def pages(path):
    out = []
    page = 1
    while True:
        rows = api(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        out.extend(rows)
        if len(rows) < 100:
            return out
        page += 1


def content(repo, path, ref):
    from urllib.parse import quote
    result = api(f'repos/{repo}/contents/{path}?ref={quote(ref, safe="")}')
    return json.loads(base64.b64decode(result['content']))


def run():
    repo = os.environ['GH_REPO']
    number = os.environ.get('PR_NUMBER')
    prs = [api(f'repos/{repo}/pulls/{number}')] if number else pages(f'repos/{repo}/pulls?state=open')
    reports = []
    for pr in prs:
        if pr['state'] != 'open' or pr['base']['ref'] != 'main':
            continue
        try:
            root = f'repos/{repo}/issues/{pr["number"]}'
            base = pr['base']['sha']
            # Policy always comes from the base, never from proposed steward edits.
            config = json.loads(Path('stewards.json').read_text())
            files = pages(f'repos/{repo}/pulls/{pr["number"]}/files')
            if len(files) >= 3000:
                raise ValueError('PR file limit reached; cannot safely evaluate all paths')
            paths = [p for f in files for p in [f['filename'], f.get('previous_filename')] if p]
            changes = []
            services = content(repo, 'data/services.json', base)['services']
            for f in files:
                if f['filename'] not in {f'data/{n}.json' for n in ['words', 'answers', 'guides', 'services', 'plans']}:
                    continue
                dataset = Path(f['filename']).stem
                key = 'carriers' if dataset == 'plans' else dataset
                old = content(repo, f['filename'], base)[key] if f['status'] != 'added' else []
                new = content(repo, f['filename'], pr['head']['sha'])[key] if f['status'] != 'removed' else []
                a, b = ({e['id']: e for e in rows} for rows in [old, new])
                for ident in a.keys() | b.keys():
                    if a.get(ident) != b.get(ident):
                        # Include old and new ownership for changed or removed entries.
                        changes.extend((dataset, entry) for entry in [a.get(ident), b.get(ident)] if entry)
            result = evaluate(config, pr, pages(f'repos/{repo}/pulls/{pr["number"]}/reviews'), paths,
                              pages(root + '/timeline'), changes, services, dt.datetime.now(dt.timezone.utc),
                              api(f'repos/{repo}/rules/branches/main') if sum(bool(s.get('github')) for s in config['stewards']) >= 2 else [])
        except Exception:
            result = {'state': 'failure', 'summary': 'Governance evidence unavailable; resolve API or policy errors and re-run.'}
        reports.append({'number': pr['number'], 'sha': pr['head']['sha'], **result})
        print(f'PR #{pr["number"]}: {result["state"]}: {result["summary"]}')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('reports=' + json.dumps(reports, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    run()
