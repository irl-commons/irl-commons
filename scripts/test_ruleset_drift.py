import copy
import json
from pathlib import Path
import unittest
from ruleset_drift import project


class RulesetTests(unittest.TestCase):
    def test_api_metadata_is_ignored_but_enforcement_changes_are_visible(self):
        expected = json.loads((Path(__file__).parent.parent / '.github/rulesets/main.json').read_text())
        expected['rules'].sort(key=lambda r: r['type'])
        live = {**copy.deepcopy(expected), 'id': 123, 'created_at': 'irrelevant'}
        live['rules'].reverse()
        self.assertEqual(project(live, expected), expected)
        for key, value in [('enforcement', 'disabled'), ('bypass_actors', [{'actor_id': 1}])]:
            bad = {**live, key: value}
            self.assertNotEqual(project(bad, expected), expected)
        bad = copy.deepcopy(live)
        next(r for r in bad['rules'] if r['type'] == 'pull_request')['parameters']['require_last_push_approval'] = False
        self.assertNotEqual(project(bad, expected), expected)


if __name__ == '__main__':
    unittest.main()
