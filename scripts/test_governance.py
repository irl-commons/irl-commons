import copy
import datetime as dt
import json
from pathlib import Path
import unittest
from governance import evaluate


class GovernanceTests(unittest.TestCase):
    def setUp(self):
        self.f = json.loads((Path(__file__).parent / 'fixtures/governance.json').read_text())

    def check(self, paths=None, changes=None, now='2026-01-10T12:00:00+00:00'):
        f = self.f
        return evaluate(f['config'], f['pr'], f['reviews'], paths or ['GOVERNANCE.md'], f['events'],
                        changes or [], [], dt.datetime.fromisoformat(now), self.f['live_rules'])

    def test_window_boundary_and_creation_fallback(self):
        self.assertEqual(self.check(now='2026-01-10T11:59:59+00:00')['state'], 'pending')
        self.assertEqual(self.check()['state'], 'success')
        self.f['events'] = []
        self.assertEqual(self.check(now='2026-01-08T12:00:00+00:00')['state'], 'success')
        self.f['pr']['draft'] = True
        self.assertEqual(self.check()['state'], 'pending')
        self.f['pr']['draft'] = False
        self.f['events'] = [{'event': 'convert_to_draft', 'created_at': '2026-01-02T12:00:00Z'}]
        self.assertEqual(self.check()['state'], 'pending')

    def test_objection_and_changes_requested(self):
        self.f['pr']['labels'] = [{'name': 'objection'}]
        self.assertEqual(self.check()['state'], 'failure')
        self.f['pr']['labels'] = []
        self.f['reviews'][0]['state'] = 'CHANGES_REQUESTED'
        self.assertEqual(self.check()['state'], 'failure')

    def test_current_head_latest_independent_reviews_only(self):
        for mutation in ['author', 'old-head', 'dismissed']:
            with self.subTest(mutation=mutation):
                original = copy.deepcopy(self.f)
                if mutation == 'author': self.f['pr']['user']['login'] = 'steward-two'
                elif mutation == 'old-head': self.f['reviews'][0]['commit_id'] = 'old'
                else: self.f['reviews'].append({**self.f['reviews'][0], 'id': 3, 'state': 'DISMISSED'})
                self.assertEqual(self.check()['state'], 'failure')
                self.f = original

    def test_maker_and_competitor_conflicts(self):
        for affiliation in ['sample-maker', 'sample-rival']:
            self.f['reviews'] = self.f['reviews'][:1]
            self.f['config']['stewards'][1]['affiliations'] = [affiliation]
            result = self.check(paths=['data/services.json'], changes=[('services', {'id': 'sample-entry', 'maker': 'Example'})])
            self.assertEqual(result['state'], 'failure')
            self.assertIn('Conflicted', result['summary'])

    def test_bootstrap_thresholds_and_protected_paths(self):
        self.f['reviews'] = []
        self.f['config']['stewards'] = self.f['config']['stewards'][:1]
        self.assertEqual(self.check(paths=['data/words.json'])['state'], 'success')
        self.assertIn('N=0', self.check()['summary'])
        self.f['config']['stewards'].append({'github': 'other', 'affiliations': []})
        self.assertIn('N=1', self.check()['summary'])
        self.f['config']['stewards'].append({'github': 'third', 'affiliations': []})
        for path in ['scripts/stale.ts', 'scripts/check.ts', 'package.json', 'bun.lock', 'README.md', 'NPM-PUBLISHING.md', 'data/README.md', 'schema/src/schema.ts', 'LICENSE-DATA', 'stewards.json', '.github/workflows/governance.yml']:
            self.assertIn('N=2', self.check(paths=[path])['summary'])

    def test_steady_gate_fails_closed(self):
        for live in [None, [], [{'type': 'pull_request', 'parameters': {'required_approving_review_count': 0}}]]:
            self.f['live_rules'] = live
            self.assertIn('Steady ruleset not applied', self.check()['summary'])
            self.assertEqual(self.check()['state'], 'failure')

    def test_author_conflict_bootstrap(self):
        import copy
        original = copy.deepcopy(self.f)
        for affiliation in ['sample-maker', 'sample-rival']:
            self.f = copy.deepcopy(original)
            self.f['config']['stewards'] = [{'github': 'steward-one', 'affiliations': [affiliation]}]
            self.f['pr']['user']['login'] = 'steward-one'
            changes = [('services', {'id': 'sample-entry', 'maker': 'Example'})]
            result = self.check(paths=['data/services.json'], changes=changes)
            self.assertEqual(result['state'], 'failure')
            self.assertIn('author is conflicted', result['summary'])
            self.f['config']['stewards'].append({'github': 'steward-two', 'affiliations': []})
            self.assertEqual(self.check(paths=['data/services.json'], changes=changes)['state'], 'success')

    def test_conflicted_approval_cannot_veto_independent_review(self):
        self.f['reviews'].append({'id': 3, 'user': {'login': 'steward-one'}, 'state': 'APPROVED', 'commit_id': 'current'})
        result = self.check(paths=['data/services.json'], changes=[('services', {'id': 'sample-entry', 'maker': 'Example'})])
        self.assertEqual(result['state'], 'success')
        self.assertIn('ignored', result['summary'])

    def test_force_push_restarts_window(self):
        self.f['events'].append({'event': 'head_ref_force_pushed', 'created_at': '2026-01-09T12:00:00Z'})
        self.assertEqual(self.check()['state'], 'pending')

    def test_fork_review_run_reads_all_open_prs_and_isolates_api_failures(self):
        import os
        import tempfile
        from unittest.mock import patch
        import governance
        config = copy.deepcopy(self.f['config'])
        config['stewards'] = config['stewards'][:1]
        prs = [{**self.f['pr'], 'number': n, 'state': 'open', 'base': {'ref': 'main', 'sha': 'base'},
                'head': {'sha': f'head-{n}', 'repo': None}} for n in [1, 2]]
        refs = []
        def content(repo, path, ref):
            refs.append((repo, path, ref))
            return {'services': [] if ref == 'base' else [{'id': 'sample-entry', 'maker': 'Example'}]}
        def pages(path):
            if path.endswith('pulls?state=open'): return prs
            if '/pulls/1/files' in path: raise ValueError('synthetic API failure')
            if '/files' in path: return [{'filename': 'data/services.json', 'status': 'modified'}]
            return []
        with tempfile.NamedTemporaryFile() as output:
            with patch.dict(os.environ, {'GH_REPO': 'sample/repo', 'PR_NUMBER': '', 'GITHUB_OUTPUT': output.name}), patch.object(governance, 'pages', side_effect=pages), patch.object(governance, 'content', side_effect=content), patch.object(governance.Path, 'read_text', return_value=json.dumps(config)):
                governance.run()
            reports = json.loads(Path(output.name).read_text().removeprefix('reports='))
        self.assertEqual([r['state'] for r in reports], ['failure', 'success'])
        self.assertIn(('sample/repo', 'data/services.json', 'head-2'), refs)


if __name__ == '__main__':
    unittest.main()
