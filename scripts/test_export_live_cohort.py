import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('cohort_export', Path(__file__).with_name('export-live-cohort.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CohortExportTest(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 9, 23, 22, tzinfo=dt.timezone.utc)
        self.coverage = dict(release_sha='a' * 40, coverage_started_at='2026-09-23T21:15:00Z')
        self.visit = dict(issuer=module.ISSUER, subject='synthetic',
                          first_seen_at='2026-09-23T21:16:00Z', last_seen_at='2026-09-23T21:20:00Z',
                          surfaces=['landing', 'session'])

    def test_empty_is_active_but_preserves_partial_coverage(self):
        result = module.snapshot([], [], self.coverage, self.now)
        self.assertEqual(result['accounts'], [])
        self.assertEqual(result['coverage_started_at'], self.coverage['coverage_started_at'])
        self.assertEqual(result['source']['status'], 'active')
        self.assertTrue(result['selection_required'])

    def test_no_name_or_email_linking(self):
        result = module.snapshot([self.visit], [], self.coverage, self.now)
        self.assertEqual(result['accounts'][0]['review_flags'], ['account_not_found'])
        self.assertIsNone(result['accounts'][0]['email'])

    def test_rejects_duplicate_and_pre_cutoff(self):
        with self.assertRaises(ValueError):
            module.snapshot([self.visit, self.visit], [], self.coverage, self.now)
        with self.assertRaises(ValueError):
            module.snapshot([{**self.visit, 'first_seen_at': '2026-09-23T20:59:59Z'}], [], self.coverage, self.now)

    def test_profile_fields_are_allowlisted(self):
        profile = dict(subject='synthetic', name='Example', preferred_name='Example',
                       email='example@example.invalid', email_verified=True, profile_complete=True,
                       review_flags=['reserved_email_domain'], private_name='excluded', token='excluded')
        row = module.snapshot([self.visit], [profile], self.coverage, self.now)['accounts'][0]
        self.assertNotIn('token', row)
        self.assertNotIn('private_name', row)
        self.assertEqual(row['surfaces'], ['landing', 'session'])


if __name__ == '__main__':
    unittest.main()
