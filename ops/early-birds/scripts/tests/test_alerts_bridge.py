import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

stub = types.ModuleType('client')
stub.Client = object
stub.private_text = lambda p: Path(p).read_text()
with patch.dict(sys.modules, client=stub):
    spec = importlib.util.spec_from_file_location('beacon_bridge', Path(__file__).parents[1] / 'alerts-bridge.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class Client:
    def __init__(self):
        self.values = []
        self.fail = False

    def call(self, method, path, value):
        self.values.append(json.loads(json.dumps(value)))
        if self.fail:
            raise OSError('lost acceptance')
        return value


class Tests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        Path(self.root.name).chmod(0o700)
        self.client = Client()
        self.config = dict(state_dir=self.root.name, base_url='http://127.0.0.1:1', token_file='unused',
                           producer_id='beacon', observer_id='beacon-observer', receiving_scope='human')
        self.bridge = module.Bridge(self.config, self.client)
        self.active = {'a': dict(name='BeaconServiceUnavailable', service='live', severity='error', code='service_unavailable')}

    def tearDown(self):
        self.bridge.close()
        self.root.cleanup()

    def test_repeat_does_not_notify_again_and_recovery_keeps_identity(self):
        self.bridge.observe(self.active, 100)
        self.bridge.observe(self.active, 101)
        self.assertEqual(len(self.client.values), 1)
        self.bridge.observe({}, 102)
        self.assertEqual(self.client.values[-1]['incident_id'], self.client.values[0]['incident_id'])
        self.assertEqual(self.client.values[-1]['revision'], 2)
        self.assertEqual(self.client.values[-1]['processing_state'], 'resolved')
        self.bridge.observe(self.active, 103)
        self.assertNotEqual(self.client.values[-1]['incident_id'], self.client.values[0]['incident_id'])

    def test_lost_acceptance_replays_exact_content_before_later_state(self):
        self.client.fail = True
        with self.assertRaises(OSError):
            self.bridge.observe(self.active, 100)
        old = self.client.values[0]
        self.bridge.close()
        self.client.fail = False
        self.bridge = module.Bridge(self.config, self.client)
        self.bridge.observe({}, 110)
        self.assertEqual(self.client.values[1], old)
        self.assertEqual(self.client.values[2]['revision'], 2)

    def test_bad_observation_never_resolves_prior_work(self):
        self.bridge.observe(self.active, 100)
        for data in [{'status': 'error'}, {'status': 'success', 'data': {'alerts': [{}]}}]:
            with self.assertRaises((KeyError, ValueError)):
                module.project(data, {})
        self.assertEqual(len(self.client.values), 1)
        self.bridge.heartbeat(False)
        self.assertEqual(self.client.values[-1]['source_state'], 'observation_unreadable')

    def test_unknown_rule_refuses_incomplete_coverage(self):
        data = {'status': 'success', 'data': {'alerts': [{'labels': {'alertname': 'NewRule'}, 'state': 'firing'}]}}
        with self.assertRaises(ValueError):
            module.project(data, {})

    def test_missing_or_stale_rule_inventory_cannot_claim_recovery(self):
        response = {'status': 'success', 'data': {'groups': [{'rules': [
            {'name': 'Known', 'health': 'ok', 'lastEvaluation': '2026-10-27T12:00:00Z'}]}]}}
        now = module.dt.datetime.fromisoformat('2026-10-27T12:00:30+00:00').timestamp()
        module.qualify_rules(response, {'Known': 'warning'}, now)
        with self.assertRaises(ValueError):
            module.qualify_rules(response, {'Known': 'warning', 'Missing': 'critical'}, now)
        with self.assertRaises(ValueError):
            module.qualify_rules(response, {'Known': 'warning'}, now + 301)

    def test_annotations_and_private_labels_are_not_projected(self):
        data = {'status': 'success', 'data': {'alerts': [{'labels': {'alertname': 'Known', 'service': 'live', 'instance': 'private-host'}, 'state': 'firing', 'annotations': {'summary': 'secret'}}]}}
        result = module.project(data, {'Known': 'critical'})
        self.assertNotIn('secret', json.dumps(result))
        self.assertNotIn('private-host', json.dumps(result))

    def test_binding_cannot_silently_change(self):
        self.bridge.close()
        with self.assertRaises(ValueError):
            module.Bridge(dict(self.config, producer_id='another'), self.client)
        self.bridge = module.Bridge(self.config, self.client)


if __name__ == '__main__':
    unittest.main()
