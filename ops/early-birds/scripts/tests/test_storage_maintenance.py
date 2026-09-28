import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import hashlib
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).parents[1]/'storage-maintenance.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RetentionTests(unittest.TestCase):
    def test_path_trigger_does_not_watch_delivery_locks(self):
        unit = Path(__file__).parents[2]/"systemd/harmonic-beacon-storage-maintenance.path"
        watched = [Path(line.split("=", 1)[1]) for line in unit.read_text().splitlines()
                   if line.startswith("PathChanged=")]
        self.assertTrue(watched)
        for watched_path in watched:
            for lock in map(Path, m.LOCKS):
                self.assertNotEqual(watched_path, lock)
                self.assertNotIn(watched_path, lock.parents)

    def images(self):
        return [{'Id': 'sha256:'+str(i)*64,
                 'RepoTags': ['harmonic-beacon/account:'+str(i)*40],
                 'Created': f'2026-01-0{i+1}T00:00:00Z'} for i in range(6)]

    def test_old_rollback_survives_new_failed_builds(self):
        images = self.images()
        eligible, protected = m.selection(images, {images[1]['Id']}, 1800000000,
                                          {images[0]['Id']})
        self.assertIn(images[0]['Id'], protected)
        self.assertEqual([x['Id'] for x in eligible], [images[2]['Id']])

    def test_stopped_container_binding_is_protected(self):
        images = self.images()
        eligible, _ = m.selection(images, {images[0]['Id']}, 1800000000, set())
        self.assertNotIn(images[0], eligible)

    def test_unknown_repository_and_rollback_tag_are_protected(self):
        images = self.images()
        images[0]['RepoTags'].append('unrelated/application:old')
        images[1]['RepoTags'].append('harmonic-beacon/account:rollback-known')
        eligible, _ = m.selection(images, set(), 1800000000, set())
        self.assertEqual([x['Id'] for x in eligible], [images[2]['Id']])

    def test_recent_image_never_retired(self):
        images = self.images()
        eligible, _ = m.selection(images, set(), m.created(images[0])+3600, set())
        self.assertEqual(eligible, [])

    def test_account_delivery_preserves_old_rollback(self):
        images = self.images()
        images[-1]['Running'] = True
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'DELIVERY_STATE', Path(directory)):
            root = Path(directory)/'account-delivery'
            root.mkdir()
            (root/'production-123-1.json').write_text(json.dumps({
                'candidate_image_id': images[-1]['Id'], 'previous_sha': '0'*40}))
            protected = m.rollback_protection(images, {images[-1]['Id']})
            self.assertIn(images[0]['Id'], protected)
            self.assertNotIn(images[2]['Id'], protected)

    def test_uncovered_active_staging_preserves_whole_repository(self):
        images = self.images()
        images[-1]['Running'] = images[-2]['Running'] = True
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'DELIVERY_STATE', Path(directory)):
            root = Path(directory)/'account-delivery'
            root.mkdir()
            (root/'production-123-1.json').write_text(json.dumps({
                'candidate_image_id': images[-1]['Id'], 'previous_sha': '0'*40}))
            protected = m.rollback_protection(images, {images[-1]['Id'], images[-2]['Id']})
            self.assertEqual(protected, {i['Id'] for i in images})

    def test_missing_rollback_stops_retirement(self):
        images = self.images()
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'DELIVERY_STATE', Path(directory)):
            root = Path(directory)/'account-delivery'
            root.mkdir()
            (root/'production-123-1.json').write_text(json.dumps({
                'candidate_image_id': images[-1]['Id'], 'previous_sha': 'a'*40}))
            with self.assertRaisesRegex(RuntimeError, 'rollback image missing'):
                m.rollback_protection(images, {images[-1]['Id']})

    def test_partial_archive_is_preserved_and_budgeted(self):
        image = self.images()[0]
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'ARCHIVES', Path(directory)):
            archive = Path(directory)/image['Id'].split(':')[1]
            archive.mkdir()
            (archive/'image.tar').write_bytes(b'partial')
            self.assertIsNone(m.archive_image(image, 0))
            self.assertEqual(m.expire_archives(set(), 1800000000), 7)
            self.assertTrue((archive/'image.tar').exists())

    def test_archive_grace_period_and_protected_recovery(self):
        now = 1800000000
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'ARCHIVES', Path(directory)):
            for i, age in ((0, 40*86400), (1, 40*86400), (2, 86400)):
                entry = Path(directory)/(str(i)*64)
                entry.mkdir()
                (entry/'verified.json').write_text(json.dumps({
                    'schema': 'hb.storage-archive/v1', 'imageId': 'sha256:'+str(i)*64,
                    'createdAt': now-age}))
            m.expire_archives({'sha256:'+'1'*64}, now)
            self.assertFalse((Path(directory)/('0'*64)).exists())
            self.assertTrue((Path(directory)/('1'*64)).exists())
            self.assertTrue((Path(directory)/('2'*64)).exists())

    def test_reused_archive_gets_new_recovery_grace(self):
        image = self.images()[0]
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'ARCHIVES', Path(directory)), patch.object(m, 'run'):
            entry = Path(directory)/image['Id'].split(':')[1]
            entry.mkdir()
            (entry/'image.tar.zst').write_bytes(b'verified fixture')
            marker = entry/'verified.json'
            marker.write_text(json.dumps({'schema': 'hb.storage-archive/v1',
                'imageId': image['Id'], 'createdAt': 1, 'dockerLoadRoundtrip': True,
                'archiveSha256': hashlib.sha256(b'verified fixture').hexdigest()}))
            with patch.object(m.time, 'time', return_value=1800000000):
                self.assertEqual(m.archive_image(image, 0), 0)
            self.assertEqual(json.loads(marker.read_text())['createdAt'], 1800000000)


if __name__ == '__main__':
    unittest.main()
