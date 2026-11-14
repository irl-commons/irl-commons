"""Compare committed rules with live rules; update one issue, never settings."""
import json
from pathlib import Path
import subprocess


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def project(actual, expected):
    if isinstance(expected, dict):
        return {k: project(actual.get(k), v) for k, v in expected.items()} if isinstance(actual, dict) else actual
    if isinstance(expected, list):
        if not isinstance(actual, list): return actual
        if expected and isinstance(expected[0], dict) and 'type' in expected[0]:
            by_type = {x['type']: x for x in expected}
            return sorted([project(x, by_type.get(x.get('type'), x)) for x in actual], key=lambda x: x['type'])
        return actual
    return actual


def run():
    expected = json.loads(Path('.github/rulesets/main.json').read_text())
    wanted = dict(expected, rules=sorted(expected['rules'], key=lambda x: x['type']))
    rulesets = json.loads(gh('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/rulesets?per_page=100'))
    candidates = [x for page in rulesets for x in page if x['name'] == expected['name']]
    matches = len(candidates) == 1 and project(json.loads(gh('api', f'repos/{{owner}}/{{repo}}/rulesets/{candidates[0]["id"]}')), expected) == wanted
    marker = '<!-- rolling-ruleset-drift -->'
    body = marker + '\n\n' + ('Live rules match the committed ruleset.' if matches else
        'The live main ruleset is missing, duplicated or differs from `.github/rulesets/main.json`. Review repository settings and the committed policy. This workflow never changes settings.')
    issues = json.loads(gh('api', '--paginate', '--slurp', 'repos/{owner}/{repo}/issues?state=all&per_page=100'))
    issue = next((i for page in issues for i in page if i['user']['login'] == 'github-actions[bot]' and (i.get('body') or '').startswith(marker) and 'pull_request' not in i), None)
    Path('ruleset-report.md').write_text(body + '\n')
    if issue:
        gh('issue', 'edit', str(issue['number']), '--body-file', 'ruleset-report.md')
        gh('issue', 'close' if matches else 'reopen', str(issue['number']))
    elif not matches:
        gh('issue', 'create', '--title', 'Repository ruleset drift', '--body-file', 'ruleset-report.md')
    print(body)


if __name__ == '__main__':
    run()
