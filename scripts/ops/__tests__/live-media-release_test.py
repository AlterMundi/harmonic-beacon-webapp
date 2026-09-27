import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[3] / 'deploy/hb-live-media-release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class Recovery(unittest.TestCase):
    def fixture(self):
        snapshot = {'Id': 'old', 'Image': 'sha256:old', 'Config': {'Env': ['SECRET=private', 'BEACON_GIT_SHA=old'], 'Cmd': ['node', 'server.js'], 'Entrypoint': ['entry'], 'Labels': {}},
                    'HostConfig': {'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3000'}]}},
                    'NetworkSettings': {'Networks': {'private': {'Aliases': ['app'], 'IPAMConfig': None}}}}
        return snapshot

    def test_provenance_does_not_replace_production_configuration(self):
        old = self.fixture()
        image = {**old['Config'], 'Env': ['SECRET=staging', 'BEACON_GIT_SHA=new', 'NEW_DEFAULT=1']}
        result = r.replacement(old, 'sha256:new', image)
        self.assertEqual(r.env_map(result), {'SECRET': 'private', 'BEACON_GIT_SHA': 'new', 'NEW_DEFAULT': '1'})
        self.assertEqual(result['HostConfig'], old['HostConfig'])
        self.assertEqual(old['Config']['Env'][1], 'BEACON_GIT_SHA=old')

    def test_interrupted_create_is_recoverable_only_with_exact_intent(self):
        old = self.fixture()
        intent = r.replacement(old, 'sha256:new')
        intent['Labels']['com.harmonicbeacon.media-release-590'] = 'transaction'
        current = {**copy.deepcopy(old), 'Id': 'new', 'Image': 'sha256:new',
                   'Config': {k: v for k, v in intent.items() if k not in ('HostConfig', 'NetworkingConfig')}}
        state = {'created': {}, 'priorDigest': 'transaction', 'intents': {'app': intent}}
        self.assertTrue(r.owned(current, {'app': old}, state, 'app'))
        for mutate in [lambda x: x['Config']['Env'].append('FOREIGN=1'),
                       lambda x: x['HostConfig']['PortBindings'].clear(),
                       lambda x: x['Config']['Labels'].clear(),
                       lambda x: x.update(Image='sha256:foreign')]:
            changed = copy.deepcopy(current)
            mutate(changed)
            self.assertFalse(r.owned(changed, {'app': old}, state, 'app'))

    def test_static_ip_refuses_implicit_reallocation(self):
        old = self.fixture()
        old['NetworkSettings']['Networks']['private']['IPAMConfig'] = {'IPv4Address': '10.0.0.2'}
        with self.assertRaises(RuntimeError):
            r.replacement(old, 'sha256:new')

if __name__ == '__main__':
    unittest.main()
