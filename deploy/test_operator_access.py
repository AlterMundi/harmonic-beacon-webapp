"""Focused privilege-boundary tests; no Docker, credentials or network."""
import importlib.util
from pathlib import Path
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


helper = load('operator_root', 'hb-operator-root.py')
access = load('operator_access', 'hb-operator-access.py')


class OperatorAccessTest(unittest.TestCase):
    def test_non_json_success_is_preserved_without_repeating_the_api_call(self):
        self.assertEqual(access.response_fields(b''), {'body': None, 'responseEncoding': 'empty'})
        self.assertEqual(access.response_fields(b'{"ok":true}')['body'], {'ok': True})
        self.assertEqual(access.response_fields(b'\xff\x00')['bodyBase64'], '/wA=')
        self.assertEqual(access.response_fields(b'column\nvalue\n')['responseEncoding'], 'base64')

    def test_profiles_preserve_legacy_and_separate_environments_and_actors(self):
        self.assertEqual(helper.profile_directory('production'), helper.CONFIG / 'production')
        self.assertEqual(helper.profile_directory('staging', 'eko'), helper.CONFIG / 'staging/operators/eko')
        self.assertNotEqual(helper.profile_directory('production', 'eko'), helper.profile_directory('production', 'compaii'))

    def test_profile_cannot_escape_root_custody(self):
        for name in ('../eko', '/tmp/eko', 'eko/x', '', 'Eko', 'x' * 33):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                helper.profile_directory('production', name)
        with self.assertRaises(RuntimeError): helper.profile_directory('../production', 'eko')

    def test_caller_must_match_registered_uid_and_environment(self):
        policy = {'beacon-eko': {'uid': 2345, 'operator': 'eko', 'environments': ['staging']}}
        self.assertEqual(access.caller_profile(policy, 'staging', 'beacon-eko', '2345'), 'eko')
        for env, user, uid in [('production', 'beacon-eko', '2345'), ('staging', 'other', '2345'), ('staging', 'beacon-eko', '0')]:
            with self.subTest(env=env, user=user, uid=uid), self.assertRaises(ValueError):
                access.caller_profile(policy, env, user, uid)

    def test_delegate_cannot_select_identity_privileged_operation_or_output(self):
        base = {'expectedSourceSha': 'a' * 40, 'method': 'GET', 'apiPath': '/api/ops/events'}
        self.assertEqual(access.validate_request(base), base)
        for key in ('email', 'name', 'tokenPath', 'responsePath', 'operator', 'operation', 'environment'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                access.validate_request({**base, key: 'arbitrary'})

    def test_delegate_api_scope_rejects_traversal_and_other_services(self):
        for path in ('/api/internal/secret', '/api/ops/../secret', '/api/ops/%2e', '//other/api/ops', '/api/ops\\x', '/api/ops/x\n'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                access.validate_request({'expectedSourceSha': 'a' * 40, 'method': 'GET', 'apiPath': path})

    def test_runtime_boundary_remains_read_only_exact_image_and_namespace(self):
        runtime = {'Id': 'selected-container', 'Config': {'Env': ['DATABASE_URL=private', 'UNRELATED_SECRET=omit']}}
        result = helper.container_config(runtime, 'sha256:exact', 'staging', Path('/input'), Path('/output'), 'run')
        self.assertEqual(result['Image'], 'sha256:exact')
        self.assertEqual(result['HostConfig']['NetworkMode'], 'container:selected-container')
        self.assertTrue(result['HostConfig']['ReadonlyRootfs'])
        self.assertEqual(result['HostConfig']['CapDrop'], ['ALL'])
        self.assertNotIn('UNRELATED_SECRET=omit', result['Env'])
        self.assertIn('/input:/run/operator-in:ro', result['HostConfig']['Binds'])


if __name__ == '__main__': unittest.main()
