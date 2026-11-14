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
                        changes or [], [], dt.datetime.fromisoformat(now))

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
        for path in ['schema/src/schema.ts', 'LICENSE-DATA', 'stewards.json', '.github/workflows/governance.yml']:
            self.assertIn('N=2', self.check(paths=[path])['summary'])


if __name__ == '__main__':
    unittest.main()
