import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backups', Path(__file__).parents[1]/'periodic-backups.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class BackupRetentionTests(unittest.TestCase):
    def fixture(self, root):
        paths = []
        for day in range(1, 6):
            p = root/f'periodic-live-2026090{day}T000000Z.dump.age'
            p.write_bytes(b'encrypted fixture')
            p.with_name(p.name+'.sha256').write_text(f'{m.checksum(p)}  {p.name}\n')
            os.utime(p, (day, day))
            paths.append(p)
        return paths

    def test_retains_three_and_ignores_deploy_backups(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'regular', lambda p: p.stat()):
            root = Path(tmp)
            paths = self.fixture(root)
            unrelated = root/'live-pre-deploy.dump'
            unrelated.write_bytes(b'recovery')
            m.retain(root, 'live', 30*86400)
            self.assertEqual([p.exists() for p in paths], [False, False, True, True, True])
            self.assertTrue(unrelated.exists())

    def test_keeps_recent_even_when_more_than_three(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'regular', lambda p: p.stat()):
            paths = self.fixture(Path(tmp))
            m.retain(Path(tmp), 'live', 86400)
            self.assertTrue(all(p.exists() for p in paths))

    def test_corrupted_checksum_prevents_deletion(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'regular', lambda p: p.stat()):
            paths = self.fixture(Path(tmp))
            paths[1].with_name(paths[1].name+'.sha256').write_text('corrupt')
            with self.assertRaisesRegex(RuntimeError, 'unverified'):
                m.retain(Path(tmp), 'live', 30*86400)
            self.assertTrue(paths[1].exists())
