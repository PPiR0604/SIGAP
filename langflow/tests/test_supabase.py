import base64
import copy
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
    def test_compact_reader_preserves_complete_metadata_and_human_default(self):
        ns,_=self.module('Logistics Storage Reader')
        rows=[{'report_id':'R001','shelter_name':'Posko Uji','total_people':0,
               'stock':{'air_liter_per_hari':0},'notes':'Baris satu\nBaris dua Ω',
               'field_provenance':{'total_people':{'source_report_id':'R001','value':0}},
               'pending_clear_fields':['notes'],'storage_conflicts':[{'field':'total_people','previous_value':12,'incoming_value':0}]}]
        reference={'snapshot_id':'1'*32,'snapshot_sha256':'a'*64}
        calc={**reference,'shelters':[{'total_people':0,'needs':{'air_liter_per_hari':{'value':0}}}], 'totals':{'air_liter_per_hari':0}}
        for records,source_count in [(rows,1),([],0),([],9)]:
            for verification in [None,{'status':'verified','matched_count':1},
                                 {'status':'mismatch','difference_count':1,'differences':[{'field':'total_people','expected':0,'observed':12}]}]:
                with self.subTest(count=source_count,verification=verification):
                    options={'source_count':source_count,'query':'literal filter','reference':reference if records else None,
                             'calculation':calc if records else None,'verification':verification}
                    human=ns['format_shelter_summary'](records,'Supabase',**options)
                    self.assertEqual(human,ns['format_shelter_summary'](records,'Supabase',response_format='human',**options))
                    expected=json.loads(human.split('```json\n')[-1].split('\n```')[0])
                    expected['verification_status']=expected['verification']['status']
                    compact=ns['format_shelter_summary'](records,'Supabase',response_format='compact',**options)
                    self.assertEqual(len(compact.splitlines()),1)
                    self.assertEqual(json.loads(compact.removeprefix('SIGAP_READ_RESULT ')),expected)
                    self.assertLess(len(compact.encode()),len(human.encode()))

    def test_compact_reader_request_keeps_fresh_snapshot_calculation_and_storage_unchanged(self):
        ns,storage=self.module('Logistics Storage Reader')
        cap=capability();token=ns['_cloud_capability'].set(cap)
        try:
            storage[ns['cloud_scope']()]={'revision':7,'document':{'header':['posko','jumlah_jiwa'], 'rows':[['Posko A','0'],['Posko B','12']]}}
        finally:ns['_cloud_capability'].reset(token)
        before=copy.deepcopy(storage)
        raw=json.dumps({'action':'all','include_calculation':True,'response_format':'compact'})
        output=ns['LogisticsStorageReader'](query=raw,storage_mode='sqlite',sigap_context=json.dumps({'__sigap_context':cap,'input':raw})).fetch().text
        self.assertEqual(len(output.splitlines()),1)
        data=json.loads(output.removeprefix('SIGAP_READ_RESULT '))
        self.assertEqual([r['total_people'] for r in data['records']],[0,12])
        self.assertEqual(data['validated_calculation']['totals']['air_liter_per_hari'],180)
        self.assertEqual(data['snapshot_id'],data['validated_calculation']['snapshot_id'])
        self.assertEqual(data['snapshot_sha256'],data['validated_calculation']['snapshot_sha256'])
        token=ns['_cloud_capability'].set(cap)
        try: self.assertEqual(ns['load_snapshot']({k:data[k] for k in ('snapshot_id','snapshot_sha256')})['records'],data['records'])
        finally:ns['_cloud_capability'].reset(token)
        self.assertEqual(storage,before)
        raw=json.dumps({'action':'all','response_format':'unknown'})
        rejected=ns['LogisticsStorageReader'](query=raw,storage_mode='sqlite',sigap_context=json.dumps({'__sigap_context':cap,'input':raw})).fetch().text
        self.assertTrue(rejected.startswith('GAGAL:'))

    def test_omitted_unknown_fields_preserve_validated_numbers_stock_and_review_flags(self):
        ns,_=self.module('Shelter Report Validator')
        for text,values in [
            ('Posko Uji di Desa Uji: 0 jiwa, laki-laki 0, perempuan 0. Stok air 200 liter untuk 48 jam.',
             {'total_people':0,'male':0,'female':0,'stock':{'air_liter_per_hari':200},'stock_context':{'air_liter_per_hari':{'unit':'L','horizon_hours':48}}}),
            ('Posko Uji di Desa Uji: laki-laki 5. Jumlah jiwa belum diketahui.',{'male':5}),
        ]:
            with self.subTest(text=text):
                sparse={'report_id':'R001','shelter_name':'Posko Uji','village':'Desa Uji',**values}
                dense={**{key:None for key in ns['NUMERIC_FIELDS']},**sparse}
                source='[R001] waktu=tidak diketahui | pelapor=-\n'+text
                one=ns['validate'](json.dumps({'records':[sparse]}),source)
                two=ns['validate'](json.dumps({'records':[dense]}),source)
                self.assertEqual(one,two)
                row=one['records'][0]
                self.assertEqual(row['total_people'],values.get('total_people'))
                self.assertEqual(row['female'],values.get('female'))
                self.assertEqual(row['male'],values['male'])

    def test_confirmed_source_save_avoids_only_its_same_invocation_readback(self):
        ns,storage=self.module('Shelter Report Validator')
        original=ns['cloud_request'];reads=[]
        def counted(action,args=None):
            if action=='flow.load':reads.append(args['id'])
            return copy.deepcopy(original(action,args))
        ns['cloud_request']=counted
        def run(instance):
            payload={'records':[{'total_people':10}]}
            instance.reference=ns['save_snapshot'](payload)
            payload['records'][0]['total_people']=999
            loaded=ns['load_snapshot'](instance.reference)
            loaded['records'][0]['total_people']=888
            instance.people=ns['load_snapshot'](instance.reference)['records'][0]['total_people']
        cls=type('ShelterReportValidator',(),{'run':ns['authenticated_component'](run)})
        instance=cls();instance.sigap_context=json.dumps({'__sigap_context':capability(),'input':''})
        instance.run();self.assertEqual(instance.people,10);self.assertEqual(reads,[])
        self.assertIsNone(ns['_cloud_snapshot_reads'].get())
        token=ns['_cloud_capability'].set(capability())
        try:self.assertEqual(ns['load_snapshot'](instance.reference)['records'][0]['total_people'],10)
        finally:ns['_cloud_capability'].reset(token)
        self.assertEqual(len(reads),1)
        writer=type('LogisticsStorageWriter',(),{'run':ns['authenticated_component'](run)})()
        writer.sigap_context=instance.sigap_context;writer.run()
        self.assertEqual(len(reads),3)
        self.assertEqual(storage,{})

    def test_unconfirmed_or_failed_save_never_seeds_the_validation_cache(self):
        for failure in ('false','error'):
            with self.subTest(failure=failure):
                ns,_=self.module('Shelter Report Validator')
                def rejected(action,args=None):
                    if failure=='error':raise ValueError('gateway unavailable')
                    return False
                ns['cloud_request']=rejected
                def run(instance):
                    try:ns['save_snapshot']({'records':[]})
                    finally:instance.cached=len(ns['_cloud_snapshot_reads'].get())
                instance=type('ShelterReportValidator',(),{'run':ns['authenticated_component'](run)})()
                instance.sigap_context=json.dumps({'__sigap_context':capability(),'input':''})
                with self.assertRaises(ValueError):instance.run()
                self.assertEqual(instance.cached,0)
                self.assertIsNone(ns['_cloud_snapshot_reads'].get())
                self.assertIsNone(ns['_cloud_capability'].get())

    def test_new_cached_source_still_enforces_hash_expiry_and_capability_scope(self):
        from unittest.mock import patch
        import time
        ns,_=self.module('Shelter Report Validator')
        test=self
        def run(instance):
            reference=ns['save_snapshot']({'records':[{'total_people':10}]})
            with test.assertRaisesRegex(ValueError,'hash mismatch'):
                ns['load_snapshot']({**reference,'snapshot_sha256':'0'*64})
            with patch.object(ns['time'],'time',return_value=time.time()+86401):
                with test.assertRaisesRegex(ValueError,'expired'):ns['load_snapshot'](reference)
            token=ns['_cloud_capability'].set(capability('other-posko'))
            try:
                with test.assertRaises(ValueError):ns['load_snapshot'](reference)
            finally:ns['_cloud_capability'].reset(token)
            instance.people=ns['load_snapshot'](reference)['records'][0]['total_people']
        instance=type('ShelterReportValidator',(),{'run':ns['authenticated_component'](run)})()
        instance.sigap_context=json.dumps({'__sigap_context':capability(),'input':''});instance.run()
        self.assertEqual(instance.people,10)

    def test_reader_calculates_from_the_same_fresh_readback_without_changing_storage(self):
        ns,storage=self.module('Logistics Storage Reader')
        cap=capability();token=ns['_cloud_capability'].set(cap)
        try:
            scope=ns['cloud_scope']()
            storage[scope]={'revision':7,'document':{'header':['posko','desa','jumlah_jiwa'],
                'rows':[['Posko A','Desa A','10'],['Posko B','Desa B','20']]}}
        finally:ns['_cloud_capability'].reset(token)
        before=copy.deepcopy(storage)
        raw=json.dumps({'action':'all','include_calculation':True})
        output=ns['LogisticsStorageReader'](query=raw,storage_mode='sqlite',sigap_context=json.dumps({'__sigap_context':cap,'input':raw})).fetch().text
        self.assertNotIn('GAGAL:',output)
        data=json.loads(output.split('```json\n')[-1].split('\n```')[0])
        calc=data['validated_calculation']
        self.assertEqual(data['total_shelters'],2);self.assertEqual(len(calc['shelters']),2)
        self.assertEqual(calc['totals']['air_liter_per_hari'],450)
        self.assertEqual(calc['snapshot_id'],data['snapshot_id'])
        self.assertEqual(calc['snapshot_sha256'],data['snapshot_sha256'])
        self.assertEqual(storage,before)

    def test_inline_correction_prepares_and_validates_a_signed_source_without_storage_write(self):
        import re
        ns,storage=self.module('Shelter Report Validator')
        cap=capability()
        token=ns['_cloud_capability'].set(cap)
        try:
            prepared,_=ns['prepare_source']('Posko Aula Uji di Desa Aman. Total 10 jiwa, laki-laki 4, perempuan 6. Butuh air bersih.')
        finally: ns['_cloud_capability'].reset(token)
        ref=json.loads(re.search(r'<<<SOURCE_REF>>>(.*?)<<<END_SOURCE_REF>>>',prepared,re.S)[1])
        def run(payload):
            raw=json.dumps(payload)
            result=ns['ShelterReportValidator'](payload=raw,sigap_context=json.dumps({'__sigap_context':cap,'input':raw})).build_validated().text
            return result
        first=run({**ref,'records':[{'report_id':'R001','shelter_name':'Posko Aula Uji','village':'Desa Aman','total_people':10,'male':4,'female':6}],'include_calculation':True})
        self.assertNotIn('GAGAL:',first)
        first=json.loads(first.split('```json\n')[-1].split('\n```')[0])
        self.assertEqual(first['validated_calculation']['shelters'][0]['needs']['air_liter_per_hari']['value'],150)
        target={k:first[k] for k in ('snapshot_id','snapshot_sha256')};target['record_index']=0
        source={'report_text':'Mohon klarifikasi laporan R001 (Posko Aula Uji): jumlah jiwa: 12. laki-laki: 5. perempuan: 7.','candidate_target':target}
        result=run({'source_request':source,'records':[{'report_id':'R001','shelter_name':'Posko Aula Uji','total_people':12,'male':5,'female':7}],'include_calculation':True})
        self.assertNotIn('GAGAL:',result)
        result=json.loads(result.split('```json\n')[-1].split('\n```')[0])
        record=result['snapshot_records'][0]
        self.assertEqual((record['total_people'],record['male'],record['female']),(12,5,7))
        self.assertEqual(record['village'],'Desa Aman')
        self.assertEqual(record['storage_baseline'],first['snapshot_records'][0]['storage_baseline'])
        calculated=result['validated_calculation']
        self.assertEqual(calculated['snapshot_id'],result['snapshot_id'])
        self.assertEqual(calculated['snapshot_sha256'],result['snapshot_sha256'])
        self.assertEqual(calculated['shelters'][0]['total_people'],12)
        self.assertEqual(calculated['shelters'][0]['needs']['air_liter_per_hari']['value'],180)
        token=ns['_cloud_capability'].set(cap)
        try:
            saved=ns['load_snapshot']({key:result[key] for key in ('snapshot_id','snapshot_sha256')})
        finally:ns['_cloud_capability'].reset(token)
        self.assertNotIn('validated_calculation',saved)
        self.assertEqual(saved['records'][0]['total_people'],12)
        self.assertEqual(storage,{})
        forged=json.loads(json.dumps(source));forged['candidate_target']['snapshot_sha256']='0'*64
        rejected=run({'source_request':forged,'records':[{'report_id':'R001','total_people':999}]})
        self.assertNotIn('SIGAP_REFERENCE',rejected)
        self.assertEqual(storage,{})

    def test_validation_reuses_immutable_snapshot_only_within_one_invocation(self):
        ns,_=self.module('Shelter Report Validator')
        cap=capability()
        token=ns['_cloud_capability'].set(cap)
        try: reference=ns['save_snapshot']({'records':[{'total_people':10}]})
        finally: ns['_cloud_capability'].reset(token)
        original=ns['cloud_request'];reads=[]
        def counted(action,args=None):
            if action=='flow.load':reads.append(args['id'])
            return copy.deepcopy(original(action,args))
        ns['cloud_request']=counted
        def run(self):
            first=ns['load_snapshot'](reference)
            first['records'][0]['total_people']=999
            self.assertion=ns['load_snapshot'](reference)['records'][0]['total_people']
        cls=type('ShelterReportValidator',(),{'run':ns['authenticated_component'](run)})
        instance=cls();instance.sigap_context=json.dumps({'__sigap_context':cap,'input':''})
        instance.run();self.assertEqual(instance.assertion,10);self.assertEqual(len(reads),1)
        instance.run();self.assertEqual(len(reads),2)
        self.assertIsNone(ns['_cloud_snapshot_reads'].get())
        self.assertIsNone(ns['_cloud_capability'].get())
        # A writer never reuses the validation read cache.
        writer=type('LogisticsStorageWriter',(),{'run':ns['authenticated_component'](run)})()
        writer.sigap_context=instance.sigap_context
        writer.run();self.assertEqual(len(reads),4)

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

    def test_compact_prompt_keeps_report_braces_literal_and_redacts_before_formatting(self):
        ns,storage=self.module('Posko Report Preprocessor')
        cap=capability()
        raw=json.dumps({'__sigap_context':cap,'input':'02/10/26 09.00 - Relawan: Posko Uji Desa Aman 10 jiwa. Catatan literal {reports.__class__}. Kontak 081234567890.'})
        result=ns['PoskoReportPreprocessor'](sigap_context=raw,raw_text=raw,date_order='DMY',
            extraction_template='Instruksi tetap. JSON {{"records":[]}}\n{reports}\nAKHIR').build_clean_reports().text
        self.assertTrue(result.startswith('Instruksi tetap. JSON {"records":[]}\n'))
        self.assertTrue(result.endswith('\nAKHIR'))
        self.assertIn('{reports.__class__}',result)
        self.assertIn('<<<SOURCE_REF>>>',result)
        self.assertNotIn('081234567890',result)
        self.assertNotIn(cap,result)
        self.assertEqual(storage,{})
        self.assertIsNone(ns['_cloud_capability'].get())

    def test_compact_prompt_rejects_unexpected_template_fields(self):
        ns,_=self.module('Posko Report Preprocessor')
        raw=json.dumps({'__sigap_context':capability(),'input':'Posko Uji 10 jiwa.'})
        for template in ('{unknown}', '{reports.__class__}', '{reports} {reports}', 'no report variable'):
            with self.subTest(template=template),self.assertRaises(ValueError):
                ns['PoskoReportPreprocessor'](sigap_context=raw,raw_text=raw,date_order='DMY',extraction_template=template).build_clean_reports()

    def test_compact_export_has_only_source_preparation_and_authenticated_chat_output(self):
        from build_supabase_flows import compact_preparation
        flow=json.loads((ROOT/'flows'/'prepare_needs.json').read_text(encoding='utf-8'))
        chat=next(n for n in flow['data']['nodes'] if n['data']['node'].get('display_name')=='Chat Input')
        prep=next(n for n in flow['data']['nodes'] if n['data']['node'].get('display_name')=='Posko Report Preprocessor')
        compact_preparation(flow)
        self.assertEqual([n['data']['node']['display_name'] for n in flow['data']['nodes']],['Chat Input','Posko Report Preprocessor','Chat Output'])
        self.assertEqual(len([e for e in flow['data']['edges'] if e['source']==chat['id'] and e['target']==prep['id']]),1)
        self.assertIn('sigap:compact-preparation-v1',flow['description'])

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
