"""Focused privilege-boundary tests; no Docker, credentials or network."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import hashlib
from unittest.mock import patch


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


class OperatorGenerationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = self.root / 'beacon-operator.cjs'
        self.manifest = self.root / 'manifest.json'
        self.bundle.write_bytes(b'exact operator source fixture')
        self.bundle.chmod(0o600)
        self.digest = hashlib.sha256(self.bundle.read_bytes()).hexdigest()
        self.manifest.write_text(json.dumps({'sourceSha':'a'*40, 'bundleSha256':self.digest,
                                            'compatibleRuntimeShas':['a'*40]}))
        for name, value in [('BUNDLE', self.bundle), ('MANIFEST', self.manifest)]:
            context = patch.object(helper, name, value); context.start(); self.addCleanup(context.stop)
        for context in [patch.object(helper, 'custody'), patch.object(helper.os, 'geteuid', return_value=0)]:
            context.start(); self.addCleanup(context.stop)

    def test_legacy_fallback_preserves_only_declared_compatibility(self):
        self.assertEqual(helper.select_bundle('a'*40)[0], self.bundle)
        with self.assertRaisesRegex(RuntimeError, 'does not admit'):
            helper.select_bundle('b'*40)

    def test_exact_generation_reused_without_replacing_legacy_or_other_runtime(self):
        before = self.manifest.read_bytes()
        helper.install_generation('b'*40, self.bundle, self.digest)
        self.assertEqual(helper.select_bundle('b'*40)[1]['compatibleRuntimeShas'], ['b'*40])
        helper.install_generation('b'*40, self.bundle, self.digest)
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertEqual(helper.select_bundle('a'*40)[0], self.bundle)

    def test_existing_incomplete_generation_never_falls_back(self):
        generation = self.root / 'runtimes' / ('a'*40)
        generation.mkdir(parents=True)
        with self.assertRaises(RuntimeError): helper.select_bundle('a'*40)

    def test_tampered_or_cross_source_generation_stops_selection(self):
        helper.install_generation('b'*40, self.bundle, self.digest)
        generation = self.root / 'runtimes' / ('b'*40)
        manifest = json.loads((generation/'manifest.json').read_text())
        manifest['sourceSha'] = 'a'*40
        (generation/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'generation mismatch'):
            helper.select_bundle('b'*40)

    def test_digest_mismatch_does_not_publish_or_overwrite(self):
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            helper.install_generation('b'*40, self.bundle, 'f'*64)
        self.assertFalse((self.root/'runtimes').exists())
        helper.install_generation('b'*40, self.bundle, self.digest)
        self.bundle.write_bytes(b'different')
        other = hashlib.sha256(self.bundle.read_bytes()).hexdigest()
        with self.assertRaisesRegex(RuntimeError, 'already differs'):
            helper.install_generation('b'*40, self.bundle, other)
        self.assertEqual(helper.select_bundle('b'*40)[1]['bundleSha256'], self.digest)

    def test_interrupted_publish_leaves_legacy_and_no_partial_runtime(self):
        with patch.object(helper.os, 'rename', side_effect=OSError('simulated publication failure')):
            with self.assertRaises(OSError): helper.install_generation('b'*40, self.bundle, self.digest)
        self.assertFalse((self.root/'runtimes'/('b'*40)).exists())
        self.assertFalse((self.root/'runtimes'/'.pending').exists())
        self.assertEqual(helper.select_bundle('a'*40)[0], self.bundle)

    def test_generation_ceiling_preserves_all_prior_generations(self):
        helper.install_generation('b'*40, self.bundle, self.digest)
        with patch.object(helper, 'MAX_GENERATIONS', 1):
            with self.assertRaisesRegex(RuntimeError, 'ceiling'):
                helper.install_generation('c'*40, self.bundle, self.digest)
        self.assertEqual(helper.select_bundle('b'*40)[1]['bundleSha256'], self.digest)


if __name__ == '__main__': unittest.main()
