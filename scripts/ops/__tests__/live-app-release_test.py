import copy
import datetime
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

base = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('app_release', base / 'deploy/hb-live-app-release.py')
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)

class Admission(unittest.TestCase):
    def permit(self):
        return {'permitId':'1'*64,'sourceSha':'2'*40,'priorSourceSha':'3'*40,
                'candidateImageId':'sha256:'+'4'*64,'priorImageId':'sha256:'+'5'*64,'expiresAt':'2026-09-28T01:00:00Z'}
    def test_closed_identity_and_expiry_with_recovery_after_expiry(self):
        p=self.permit();now=datetime.datetime(2026,9,28,tzinfo=datetime.timezone.utc)
        self.assertEqual(a.validate_permit(p,'prepare',now),p)
        for key in p:
            changed={**p,key:'invalid'}
            with self.assertRaises((RuntimeError,ValueError)):a.validate_permit(changed,'apply',now)
        with self.assertRaises(RuntimeError):a.validate_permit({**p,'command':'sh'},'apply',now)
        with self.assertRaises(RuntimeError):a.validate_permit(p,'apply',now+datetime.timedelta(hours=2))
        self.assertEqual(a.validate_permit(p,'recover',now+datetime.timedelta(days=2)),p)
    def test_forward_window_never_blocks_interrupted_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            e=SimpleNamespace(ROOT=Path(tmp),safe_path=lambda p:None)
            self.assertTrue(a.forward_admission_required(e,False,'prepare'))
            directory=e.ROOT/'production';directory.mkdir()
            path=directory/'state.json'
            for phase in ['prepared','applying','applied','restoring','recovery-required','rolled-back']:
                path.write_text(json.dumps({'phase':phase}))
                self.assertEqual(a.forward_admission_required(e,False,'apply'),phase=='prepared')
                for verb in ['recover','rollback','status']:
                    self.assertFalse(a.forward_admission_required(e,False,verb))
                self.assertFalse(a.forward_admission_required(e,True,'apply'))

    def test_production_status_does_not_skip_staging_rehearsal(self):
        engine_spec=importlib.util.spec_from_file_location('engine',base/'deploy/hb-live-media-release.py')
        e=importlib.util.module_from_spec(engine_spec);engine_spec.loader.exec_module(e)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);p=self.permit()
            e.safe_path=lambda *args:None
            e.inspect=lambda name:None
            first,forward=a.configure(e,p,False,'status',root,'fingerprint')
            e.operate('status',False)
            self.assertFalse(forward.exists())
            # Even a leftover directory from an older status invocation is not proof.
            (forward/'production').mkdir(parents=True)
            a.configure(e,p,True,'prepare',root,'fingerprint')
            self.assertEqual(e.ROOT,first)

    def test_app_apply_rollback_and_failed_health_recovery(self):
        for fail_health in (False,True):
            with self.subTest(fail_health=fail_health), tempfile.TemporaryDirectory() as tmp:
                engine_spec=importlib.util.spec_from_file_location('engine',base/'deploy/hb-live-media-release.py')
                e=importlib.util.module_from_spec(engine_spec);engine_spec.loader.exec_module(e)
                p=self.permit();a.configure(e,p,False,'prepare',Path(tmp),'fingerprint')
                config={'Env':['SECRET=retained','BEACON_GIT_SHA='+p['priorSourceSha']],
                        'Cmd':['node','server.js'],'Entrypoint':None,'Labels':{}}
                old={'Id':'old','Image':p['priorImageId'],'Config':config,
                     'HostConfig':{'PortBindings':{}},'NetworkSettings':{'Networks':{}},
                     'State':{'Running':True}}
                current=[copy.deepcopy(old)];calls=[]
                e.safe_path=lambda *args:None
                e.inspect=lambda name:copy.deepcopy(current[0]) if current[0] else None
                e.boundary=lambda staging:None
                e.continuity=lambda *args,**kwargs:None
                def api(method,path,body=None):
                    calls.append((method,path))
                    if path.startswith('/images/'):
                        return {'Config':{**config,'Env':['BEACON_GIT_SHA='+p['sourceSha']]}}
                    if method=='DELETE':current[0]=None;return None
                    if path.startswith('/containers/create?'):
                        current[0]={'Id':'created-'+str(len(calls)),'Image':body['Image'],
                            'Config':{k:v for k,v in body.items() if k not in ('HostConfig','NetworkingConfig')},
                            'HostConfig':body['HostConfig'],'NetworkSettings':{'Networks':{}},'State':{'Running':False}}
                        return {'Id':current[0]['Id']}
                    if path.endswith('/start'):current[0]['State']['Running']=True;return None
                    if '/stop?' in path:current[0]['State']['Running']=False;return None
                    raise AssertionError((method,path))
                e.api=api
                def health(names,source,origin):
                    self.assertEqual(set(names),{'app'})
                    if fail_health and current[0]['Image']==p['candidateImageId']:
                        raise RuntimeError('candidate unhealthy')
                    self.assertTrue(current[0]['State']['Running'])
                    self.assertEqual(e.env_map(current[0]['Config'])['BEACON_GIT_SHA'],source)
                e.health=health
                e.operate('prepare',False)
                if fail_health:
                    with self.assertRaisesRegex(RuntimeError,'candidate unhealthy'):e.operate('apply',False)
                else:
                    e.operate('apply',False)
                    self.assertEqual(current[0]['Image'],p['candidateImageId'])
                    e.operate('rollback',False)
                self.assertEqual(current[0]['Image'],p['priorImageId'])
                self.assertEqual(e.env_map(current[0]['Config'])['SECRET'],'retained')
                state=json.loads((e.ROOT/'production/state.json').read_text())
                self.assertEqual(state['phase'],'rolled-back')
                self.assertEqual(state.get('candidateVerified',False),not fail_health)
                self.assertFalse(any('tapestry' in path or 'playlist-bot' in path for _,path in calls))

    def test_only_app_and_exact_rollback_forward_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);p=self.permit();e=SimpleNamespace(safe_path=lambda p:None)
            first,forward=a.configure(e,p,True,'prepare',root,'fingerprint')
            self.assertEqual(set(e.IMAGES),{'app'})
            self.assertEqual(e.IMAGES['app'][0],p['candidateImageId'][7:])
            self.assertEqual(e.ROOT,first)
            (first/'staging').mkdir(parents=True)
            state={'phase':'rolled-back','candidateVerified':True,'helperSha256':'fingerprint','source':p['sourceSha'],'targets':{'app':p['candidateImageId']}}
            (first/'staging/state.json').write_text(json.dumps(state))
            a.configure(e,p,True,'prepare',root,'fingerprint');self.assertEqual(e.ROOT,forward)
            (forward/'staging').mkdir(parents=True)
            path=forward/'staging/state.json';path.write_text(json.dumps({**state,'phase':'applied'}))
            e.inspect=lambda name:{'Image':p['candidateImageId']}
            calls=[];e.health=lambda *args:calls.append(args)
            a.require_rehearsal(e,p,first,forward,'fingerprint');self.assertEqual(len(calls),1)
            for field,value in [('candidateVerified',False),('phase','prepared'),('helperSha256','changed'),('source','changed'),('targets',{'app':p['priorImageId']})]:
                path.write_text(json.dumps({**state,'phase':'applied',field:value}))
                with self.assertRaises(RuntimeError):a.require_rehearsal(e,p,first,forward,'fingerprint')
            a.configure(e,p,False,'prepare',root,'fingerprint')
            self.assertEqual(e.IMAGES['app'][1],p['candidateImageId'][7:])
            self.assertEqual(set(e.IMAGES),{'app'})

if __name__=='__main__':unittest.main()
