import base64
import json
import sys
import types
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'scripts'),str(ROOT/'lib'),str(ROOT/'components')]
from test_sqlite_migration import Component,Message,Field
sys.modules['lfx.io'].IntInput=Field
from build_supabase_flows import code_for,COMPONENTS

def capability(scope='posko-a'):
    claims={'organization_id':'test-org','context_id':scope,'actor_id':'test-user','exp':9999999999999}
    return base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')+'.server-signature'

class CloudTests(unittest.TestCase):
    def module(self,name):
        module,methods=COMPONENTS[name]
        ns={'__name__':'sigap_secure_test'}
        exec(compile(code_for(module,methods),module+'.py','exec'),ns)
        storage={};snapshots={};receipts={}
        def request(action,args=None):
            args=args or {};scope=ns['cloud_scope']()
            if action=='flow.save':snapshots[(scope,args['id'])]={'envelope':args['envelope'],'committed_reference':None};return True
            if action=='flow.load':return snapshots.get((scope,args['id']))
            if action=='flow.commit':snapshots[(scope,args['id'])]['committed_reference']=args['reference'];return True
            if action=='storage.read':return storage.get(scope,{'revision':0,'document':{'header':[],'rows':[]}})
            if action=='storage.receipt':
                prior=receipts.get((scope,args['commit_key']))
                if prior and prior[0]!=args['request_hash']:raise ValueError('COMMIT_MISMATCH')
                return dict(prior[1],replayed=True) if prior else None
            if action=='storage.commit':
                if args['revision']!=storage.get(scope,{'revision':0})['revision']:raise ValueError('STALE_STORAGE')
                storage[scope]={'revision':args['revision']+1,'document':args['document']}
                receipts[(scope,args['commit_key'])]=(args['request_hash'],args['result']);return args['result']
            raise AssertionError(action)
        ns['cloud_request']=request
        return ns,storage

    def test_every_export_rejects_missing_context(self):
        for name,(module,methods) in COMPONENTS.items():
            with self.subTest(component=name):
                ns,_=self.module(name)
                cls=next(v for v in ns.values() if isinstance(v,type) and v is not Component and issubclass(v,Component))
                instance=cls()
                with self.assertRaisesRegex(ValueError,'signed login context'):
                    getattr(instance,methods[0])()

    def test_source_capability_is_not_in_clean_text_or_llm_payload(self):
        ns,_=self.module('Posko Report Preprocessor')
        cap=capability();raw=json.dumps({'__sigap_context':cap,'input':'02/10/26 09.00 - Relawan: Posko Aula Uji Desa Aman 10 jiwa.'})
        result=ns['PoskoReportPreprocessor'](sigap_context=raw,raw_text=raw,date_order='DMY').build_clean_reports()
        self.assertIn('SOURCE_REF',result.text)
        self.assertNotIn(cap,result.text)
        self.assertIsNone(ns['_cloud_capability'].get())

    def test_snapshot_namespace_blocks_cross_posko_reference_and_commit_supersedes(self):
        ns,_=self.module('Logistics Storage Reader')
        ns['_cloud_capability'].set(capability())
        ref=ns['save_snapshot']({'records':[]})
        self.assertEqual(ns['load_snapshot'](ref),{'records':[]})
        ns['_cloud_capability'].set(capability('posko-b'))
        with self.assertRaises(ValueError):ns['load_snapshot'](ref)
        ns['_cloud_capability'].set(capability())
        next_ref=ns['commit_snapshot'](ref,{'records':[]},{'mode':'supabase'})
        with self.assertRaises(ValueError):ns['load_snapshot'](ref)
        self.assertEqual(ns['load_snapshot'](next_ref)['snapshot_kind'],'committed')

    def test_cloud_write_preserves_merge_validation_and_has_idempotent_receipt(self):
        ns,storage=self.module('Logistics Storage Writer')
        ns['_cloud_capability'].set(capability())
        header=['posko','desa','waktu_laporan','id_laporan','jumlah_jiwa']
        row=['Aula Uji','Aman','2026-10-25T09:00','R001','10']
        payload={'header':header,'rows':[row],'clear_columns':[[]],'update_targets':[None],
          'approved_write':{'source_snapshot':{'snapshot_id':'a'*32,'snapshot_sha256':'b'*64},'effective_payload':{'records':[{'storage_source':{'mode':'supabase','path':ns['cloud_scope']()},'storage_baseline':{'row':None}}]}}}
        match=lambda *args:False
        result=ns['cloud_write_storage'](payload,None,match,ns['merge_update'])
        self.assertEqual(result['appended'],1)
        self.assertEqual(storage[ns['cloud_scope']()]['document']['rows'][0][4],'10')
        self.assertTrue(ns['cloud_write_storage'](payload,None,match,ns['merge_update'])['replayed'])
        changed=json.loads(json.dumps(payload));changed['rows'][0][4]='11'
        with self.assertRaisesRegex(ValueError,'COMMIT_MISMATCH'):ns['cloud_write_storage'](changed,None,match,ns['merge_update'])

    def test_cloud_write_without_approval_or_with_foreign_source_is_rejected(self):
        ns,_=self.module('Logistics Storage Writer')
        ns['_cloud_capability'].set(capability())
        with self.assertRaisesRegex(ValueError,'approval'):ns['cloud_write_storage']({},None,None,None)
        with self.assertRaisesRegex(ValueError,'scope differs'):
            ns['cloud_write_storage']({'header':[],'rows':[],'approved_write':{'source_snapshot':{},'effective_payload':{'records':[{'storage_source':{'mode':'supabase','path':'supabase://other/posko'}}]}}},None,None,None)

if __name__=='__main__':unittest.main()
