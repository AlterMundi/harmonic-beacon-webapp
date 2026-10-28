import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).with_name('hb-live-candidate.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
S = 'a' * 40
P = 'b' * 40


class AdmissionTests(unittest.TestCase):
    def evidence(self, path):
        if path == 'git/ref/heads/release': return {'object': {'sha': S}}
        if path.startswith('commits/' + S + '/pulls'):
            return [{'merged_at': '2026-10-28T00:00:00Z', 'base': {'ref': 'release', 'sha': 'c'*40},
                     'merge_commit_sha': S, 'head': {'sha': P, 'ref': 'candidate'}, 'number': 10}]
        if path == 'commits/' + P + '/statuses?per_page=100':
            return [{'id':1,'context': 'delivery-gate-release', 'state': 'success',
                    'creator': {'login': 'github-actions[bot]'},
                    'target_url': 'https://github.com/' + m.REPO + '/actions/runs/123'}]
        if path == 'actions/runs/123':
            return {'path':'.github/workflows/delivery-gate.yml','event':'workflow_dispatch','head_branch':'release','head_sha':'c'*40,'conclusion':'success','status':'completed'}
        if path in ('git/commits/'+S,'git/commits/'+P):return {'tree':{'sha':'d'*40}}
        if path.startswith('actions/runs?'):
            return {'workflow_runs':[{'id':321,'path':'.github/workflows/ci.yml','head_sha':P,'head_branch':'candidate','event':'pull_request','status':'completed','conclusion':'success','run_attempt':1,'check_suite_id':987}]}
        if path == 'actions/runs/321/attempts/1/jobs?per_page=100':
            return {'total_count':1,'jobs':[{'name':'required-impact-checks','status':'completed','conclusion':'success','check_run_url':'https://api.github.com/repos/'+m.REPO+'/check-runs/456'}]}
        if path == 'check-runs/456':return {'app':{'id':15368},'head_sha':P,'check_suite':{'id':987},'conclusion':'success'}
        self.fail('unexpected external target: ' + path)

    def test_exact_merged_source_and_trusted_gate(self):
        self.assertEqual(m.qualify(S, self.evidence)['headSha'], P)

    def test_source_must_be_current_release(self):
        with self.assertRaises(RuntimeError): m.qualify(P, self.evidence)

    def test_reject_wrong_merge_target_identity_or_unmerged(self):
        for key in ('target', 'merge', 'unmerged', 'duplicate'):
            def fetch(path):
                value = self.evidence(path)
                if '/pulls' in path:
                    if key == 'target': value[0]['base']['ref'] = 'main'
                    if key == 'merge': value[0]['merge_commit_sha'] = P
                    if key == 'unmerged': value[0]['merged_at'] = None
                    if key == 'duplicate': value += value[:]
                return value
            with self.subTest(key=key), self.assertRaises(RuntimeError): m.qualify(S, fetch)

    def test_reject_failed_spoofed_or_wrong_gate_run(self):
        for key in ('failed', 'spoofed', 'run', 'missing', 'duplicate'):
            def fetch(path):
                value = self.evidence(path)
                if '/statuses?' in path:
                    gate = value[0]
                    if key == 'failed': gate['state'] = 'pending'
                    if key == 'spoofed': gate['creator']['login'] = 'operator'
                    if key == 'run': gate['target_url'] = 'https://example.org/run/123'
                    if key == 'missing': value = []
                    if key == 'duplicate': value += [gate]
                return value
            with self.subTest(key=key), self.assertRaises(RuntimeError): m.qualify(S, fetch)

    def test_reject_untrusted_gate_run_or_mismatched_candidate_ci(self):
        for key in ('gate_workflow','gate_base','gate_event','tree','ci_head','ci_failed','ci_check_app','ci_check_suite'):
            def fetch(path):
                value = self.evidence(path)
                if path == 'actions/runs/123':
                    if key == 'gate_workflow':value['path']='.github/workflows/other.yml'
                    if key == 'gate_base':value['head_sha']=S
                    if key == 'gate_event':value['event']='push'
                if key == 'tree' and path == 'git/commits/'+S:value['tree']['sha']='e'*40
                if path.startswith('actions/runs?'):
                    if key == 'ci_head':value['workflow_runs'][0]['head_sha']=S
                    if key == 'ci_failed':value['workflow_runs'][0]['conclusion']='failure'
                if path == 'check-runs/456':
                    if key == 'ci_check_app':value['app']['id']=1
                    if key == 'ci_check_suite':value['check_suite']['id']=0
                return value
            with self.subTest(key=key), self.assertRaises(RuntimeError):m.qualify(S,fetch)

    def test_reject_broader_service_changes(self):
        for path in ('Dockerfile', 'package-lock.json', 'prisma/schema.prisma', 'services/tapestry/a.ts', 'docker-compose.yml'):
            with patch.object(m, 'run', side_effect=[b'', path.encode()]), self.subTest(path=path):
                with self.assertRaises(RuntimeError): m.compatible(S, P, Path('/fixed'))

    def test_accept_app_and_operator_docs_without_broadening_runtime(self):
        with patch.object(m, 'run', side_effect=[b'', b'src/app/page.tsx\ndeploy/hb-live-candidate.py\ndocs/ops/x.md\n']):
            m.compatible(S, P, Path('/fixed'))

    def test_pending_marker_prevents_launcher_race_or_second_build(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'build.lock').touch()
            with patch.object(m, 'ROOT', root), patch.object(m, 'safe'), patch.object(m.os, 'geteuid', return_value=0), patch.object(m, 'qualify'), patch.object(m.subprocess, 'run') as launch:
                self.assertEqual(m.main(['build', S])['phase'], 'queued')
                self.assertEqual(m.main(['build', S])['phase'], 'retained')
                with self.assertRaises(RuntimeError): m.main(['build', P])
                self.assertEqual(launch.call_count, 1)
                argv = launch.call_args.args[0]
                self.assertEqual(argv[:2], ['/usr/bin/screen', '-DmS'])
                self.assertIn('-I', argv); self.assertNotIn('/bin/sh', argv)

    def test_failed_or_uncertain_work_never_auto_replayed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'build.lock').touch(); (root / S).mkdir()
            (root / S / 'result.json').write_text(json.dumps({'phase': 'failed', 'sourceSha': S}))
            with patch.object(m, 'ROOT', root), patch.object(m, 'safe'), patch.object(m.os, 'geteuid', return_value=0), patch.object(m.subprocess, 'run') as launch:
                self.assertEqual(m.main(['build', S])['phase'], 'retained'); launch.assert_not_called()

    def test_reject_extra_arguments_shell_text_or_worker_sudo_shape(self):
        for args in ([], ['build', S, 'extra'], ['build', S+';id'], ['build', '../escape'], ['unknown', S]):
            with self.subTest(args=args), self.assertRaises(RuntimeError): m.main(args)

    def test_previous_nonterminal_transaction_rejects_permit_rotation(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); state = root / 'c' / 'forward' / 'production' / 'state.json';state.parent.mkdir(parents=True)
            for phase in ('prepared', 'replacing', 'failed', 'unknown'):
                state.write_text(json.dumps({'phase': phase}))
                with patch.object(m, 'STATE', root), patch.object(m, 'safe'), self.subTest(phase=phase), self.assertRaises(RuntimeError):
                    m.terminal_previous({'permitId': 'c'})

    def test_terminal_recovery_evidence_allows_rotation_check(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); state = root / 'c' / 'rehearsal' / 'staging' / 'state.json';state.parent.mkdir(parents=True)
            state.write_text(json.dumps({'phase': 'rolled-back'}))
            with patch.object(m, 'STATE', root), patch.object(m, 'safe'): m.terminal_previous({'permitId': 'c'})

    def test_read_status_does_not_claim_pending_job_is_alive(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / S).mkdir()
            with patch.object(m, 'ROOT', root), patch.object(m, 'safe'), patch.object(m.os, 'geteuid', return_value=0):
                self.assertEqual(m.main(['status', S])['phase'], 'pending')

    def test_context_restores_only_tracked_modes_with_private_parent(self):
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d); parent.chmod(0o700); checkout = parent / 'source'; checkout.mkdir()
            regular = checkout / 'asset'; regular.write_text('public'); regular.chmod(0o600)
            executable = checkout / 'script'; executable.write_text('public'); executable.chmod(0o700)
            secret = parent / 'permit'; secret.write_text('private'); secret.chmod(0o600)
            records = b'100644 abcd 0\tasset\0' + b'100755 abcd 0\tscript\0'
            with patch.object(m, 'run', return_value=records): m.context_modes(checkout)
            self.assertEqual(regular.stat().st_mode & 0o777, 0o644)
            self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
            self.assertEqual(parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(secret.stat().st_mode & 0o777, 0o600)

    def test_admission_rejects_changed_qualified_base_under_lock(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); directory = root / S; directory.mkdir()
            (directory / 'result.json').write_text(json.dumps({'phase':'built','sourceSha':S,'imageId':'sha256:'+('1'*64),'priorImageId':'sha256:'+('2'*64),'priorSourceSha':P}))
            permit = root / 'permit.json';permit.write_text(json.dumps({'permitId':'old','sourceSha':P,'candidateImageId':'sha256:'+('2'*64)}))
            lock = root / 'lock';lock.touch()
            current = {'Image':'sha256:'+('3'*64),'Config':{'Labels':{'org.opencontainers.image.revision':P}}}
            before = permit.read_bytes()
            with patch.object(m,'ROOT',root),patch.object(m,'PERMIT',permit),patch.object(m,'LOCK',lock),patch.object(m,'safe'),patch.object(m,'qualify'),patch.object(m,'terminal_previous'),patch.object(m,'inspect',return_value=current),patch.object(m,'run') as command:
                with self.assertRaisesRegex(RuntimeError,'base changed'):m.admit(S)
                command.assert_not_called()
            self.assertEqual(permit.read_bytes(),before)

    def retirement_fixture(self, root, phase='failed'):
        source=root/S;source.mkdir();(source/'result.json').write_text(json.dumps({'sourceSha':S,'phase':phase}))
        (source/'build.log').write_text('retained diagnostic')
        (source/'source').mkdir();(source/'source'/'public-code').write_text('reconstructible')
        lock=root/'build.lock';lock.touch();release_lock=root/'release.lock';release_lock.touch()
        permit=root/'permit.json';permit.write_text(json.dumps({'sourceSha':P,'priorSourceSha':'c'*40}))
        return source,release_lock,permit

    def test_retirement_preserves_failed_evidence_before_explicit_rebuild(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source,lock,permit=self.retirement_fixture(root)
            (root/'active.json').write_text(json.dumps({'sourceSha':S}))
            with patch.object(m,'ROOT',root),patch.object(m,'LOCK',lock),patch.object(m,'PERMIT',permit),patch.object(m,'safe'),patch.object(m,'run',return_value=b''):
                result=m.retire(S)
            self.assertEqual(result['phase'],'retired');self.assertFalse(source.exists());self.assertFalse((root/'active.json').exists())
            archives=list((root/'retired').glob('*.tar.gz'));self.assertEqual(len(archives),1)
            import tarfile
            with tarfile.open(archives[0]) as t:self.assertEqual(t.extractfile('build.log').read(),b'retained diagnostic')

    def test_retirement_rejects_pending_current_and_runtime_references(self):
        for case in ('pending','current','container'):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);source,lock,permit=self.retirement_fixture(root,'pending' if case=='pending' else 'built')
                if case=='current':permit.write_text(json.dumps({'sourceSha':S,'priorSourceSha':P}))
                outputs=[b'container',('image '+S).encode()] if case=='container' else [b'']
                with patch.object(m,'ROOT',root),patch.object(m,'LOCK',lock),patch.object(m,'PERMIT',permit),patch.object(m,'safe'),patch.object(m,'run',side_effect=outputs),self.subTest(case=case),self.assertRaises(RuntimeError):m.retire(S)
                self.assertTrue((source/'build.log').exists())

    def test_retirement_does_not_overwrite_uncertain_archive(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source,lock,permit=self.retirement_fixture(root);history=root/'retired';history.mkdir();pending=history/(S+'.pending');pending.write_bytes(b'uncertain')
            with patch.object(m,'ROOT',root),patch.object(m,'LOCK',lock),patch.object(m,'PERMIT',permit),patch.object(m,'safe'),patch.object(m,'run',return_value=b''),self.assertRaises(FileExistsError):m.retire(S)
            self.assertEqual(pending.read_bytes(),b'uncertain');self.assertTrue(source.exists())

    def test_runtime_readback_never_serializes_environment_or_participant_data(self):
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d)/'lock';lock.touch()
            value = {'Id':'container','Image':'image','Config':{'Labels':{},'Env':['POSTGRES_USER=service','POSTGRES_DB=beacon','PRIVATE=do-not-expose']},'State':{'Running':True,'Health':{'Status':'healthy'}}}
            with patch.object(m,'LOCK',lock),patch.object(m,'safe'),patch.object(m,'inspect',return_value=value),patch.object(m,'run',return_value=b'{"live":0,"within24h":0,"next":null}'):
                result=m.readback(S)
            self.assertEqual(len(result['services']),7)
            self.assertNotIn('do-not-expose',json.dumps(result))
            self.assertNotIn('Env',json.dumps(result))
            self.assertEqual(result['agenda']['live'],0)

    def test_sudo_grant_has_no_worker_root_shell_or_docker_capability(self):
        grant = Path(__file__).with_name('hb-live-app-release.sudoers.example').read_text()
        self.assertNotIn('_worker', grant)
        self.assertNotIn('/bin/sh', grant)
        self.assertNotIn('/usr/bin/docker', grant)
        self.assertIn('NOSETENV', grant)
        for verb in ('build', 'status', 'admit'): self.assertIn('/usr/local/sbin/hb-live-candidate '+verb+' *', grant)


if __name__ == '__main__': unittest.main()
