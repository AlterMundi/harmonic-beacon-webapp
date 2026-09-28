import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('observer', Path(__file__).parents[1]/'platform-observer.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class BackupFreshnessTests(unittest.TestCase):
    def test_staging_backup_does_not_refresh_production(self):
        with tempfile.TemporaryDirectory() as directory:
            production = Path(directory)/'periodic-account-20260923T000000Z.dump.age'
            staging = Path(directory)/'periodic-account-staging-20260928T000000Z.dump.age'
            production.write_bytes(b'encrypted-production')
            staging.write_bytes(b'encrypted-staging')
            os.utime(production, (100, 100))
            os.utime(staging, (200, 200))
            with patch.object(Path, 'is_mount', return_value=True):
                self.assertEqual(m.backup_time(directory, m.BACKUPS['account'][1]), 100)
                production.unlink()
                self.assertEqual(m.backup_time(directory, m.BACKUPS['account'][1]), 0)
