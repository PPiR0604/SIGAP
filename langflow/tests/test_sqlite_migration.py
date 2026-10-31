import csv
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'lib'),str(ROOT/'components'),str(ROOT/'scripts')]
# Only Langflow UI plumbing is stubbed; snapshot, validator, gate and SQL code run unchanged.
class Field:
    def __init__(self,**kwargs): self.__dict__.update(kwargs)
class Component:
    def __init__(self,**kwargs):
        for field in getattr(self,'inputs',[]):setattr(self,field.name,getattr(field,'value',None))
        self.__dict__.update(kwargs)
    def stop(self,*_):pass
class Message:
    def __init__(self,text=''):self.text=text
for module in ('lfx','lfx.custom','lfx.custom.custom_component','lfx.custom.custom_component.component','lfx.io','lfx.schema','lfx.schema.message'):
    sys.modules[module]=types.ModuleType(module)
sys.modules['lfx.custom.custom_component.component'].Component=Component
for name in ('DropdownInput','MessageTextInput','Output','SecretStrInput','StrInput','MultilineInput'):
    setattr(sys.modules['lfx.io'],name,Field)
sys.modules['lfx.schema.message'].Message=Message
try:import httpx
except ImportError:
    sys.modules['httpx']=types.SimpleNamespace(HTTPError=RuntimeError)

from sigap_sqlite import read_sqlite,write_sqlite,compare_stored,resolve_storage_conflicts,connect_storage,identity_for
from sigap_contracts import save_snapshot,save_candidate_snapshot,load_snapshot,matches_update_target,verify_readback
from migrate_csv_sqlite import migrate
from logistics_storage_writer import LogisticsStorageWriter,merge_update,is_row_match,parse_rows_json
from logistics_storage_reader import LogisticsStorageReader,build_records
from officer_confirmation_gate import OfficerConfirmationGate
from posko_report_preprocessor import PoskoReportPreprocessor
from shelter_report_validator import ShelterReportValidator,merge_correction


class StorageTests(unittest.TestCase):
    def test_native_row_snapshots_preserve_decimal_stock_and_independent_approval_references(self):
        records=[{'report_id':'R001','shelter_name':'A','stock':{'air_liter_per_hari':300.0}}, {'report_id':'R002','shelter_name':'B','stock':{}}]
        parent=load_snapshot(save_candidate_snapshot({'records':records,'report_records':records,'issues':[]}))
        refs=parent['row_snapshot_refs']
        self.assertEqual(len(refs),2)
        self.assertNotEqual(refs[0]['snapshot_id'],refs[1]['snapshot_id'])
        self.assertEqual(load_snapshot(refs[0])['records'],records[:1])
        self.assertEqual(load_snapshot(refs[1])['records'],records[1:])

    def test_structured_form_validates_without_llm_and_allocates_stable_id_only_on_bound_target(self):
        from prepare_user_testing import baseline,storage_payload
        fixture=storage_payload(baseline('2026-10-25'))
        write_sqlite(fixture,self.path,lambda *_:False,lambda *_:None,migration=True)
        records=build_records(fixture['header'],fixture['rows'])
        reference=save_snapshot({'records':records,'snapshot_kind':'storage_readback'})
        target={**reference,'record_index':1}
        source=PoskoReportPreprocessor(raw_text=json.dumps({'report_text':'Mohon klarifikasi laporan R002 (Posko Harapan): lansia: 14. disabilitas: 0.','correction_target':target})).build_clean_reports().text
        extraction={'records':[{'report_id':'R001','shelter_name':'Posko Harapan','elderly':14,'disability':0}]}
        result=ShelterReportValidator(llm_output=json.dumps(extraction),source_text=source).build_validated().text
        self.assertNotIn('GAGAL:',result)
        parsed=json.loads(result.split('```json\n')[-1].split('\n```')[0])
        rec=parsed['snapshot_records'][0]
        self.assertEqual(rec['total_people'],98)
        self.assertEqual(rec['elderly'],14)
        self.assertEqual(rec['disability'],0)
        self.assertTrue(rec['shelter_id'])
        self.assertEqual(rec['update_target']['report_id'],'R002')
        self.assertEqual(read_sqlite(self.path)['rows'],fixture['rows'])

    def test_extended_form_keeps_stock_evidence_and_clear_proposals_until_approval(self):
        from prepare_user_testing import baseline,storage_payload
        fixture=storage_payload(baseline('2026-10-25'))
        write_sqlite(fixture,self.path,lambda *_:False,lambda *_:None,migration=True)
        records=build_records(fixture['header'],fixture['rows'])
        reference=save_snapshot({'records':records,'snapshot_kind':'storage_readback'})
        target={**reference,'record_index':1}
        text='Mohon klarifikasi laporan R002 (Posko Harapan): jumlah KK: 20. bayi/balita: 0. anak: 8. ibu hamil: 1. ibu menyusui: 0. waktu laporan: 2026-10-29 08:15. stok air: 0 L untuk 48 jam dicatat 29/10/2026 08:15. Usulkan pengosongan field: disability.'
        source=PoskoReportPreprocessor(raw_text=json.dumps({'report_text':text,'correction_target':target})).build_clean_reports().text
        extraction={'records':[{'report_id':'R001','shelter_name':'Posko Harapan','total_families':20,'infants_toddlers':0,'children':8,'pregnant':1,'breastfeeding':0,'reported_at':'2026-10-29 08:15','stock':{'air_liter_per_hari':0},'stock_context':{'air_liter_per_hari':{'unit':'L','recorded_at':'2026-10-29 08:15','horizon_hours':48}}}]}
        result=ShelterReportValidator(llm_output=json.dumps(extraction),source_text=source).build_validated().text
        self.assertNotIn('GAGAL:',result)
        rec=json.loads(result.split('```json\n')[-1].split('\n```')[0])['snapshot_records'][0]
        self.assertEqual(rec['total_families'],20)
        self.assertEqual(rec['infants_toddlers'],0)
        self.assertEqual(rec['stock']['air_liter_per_hari'],0)
        self.assertEqual(rec['stock_context']['air_liter_per_hari']['horizon_hours'],48)
        self.assertIn('disability',rec['pending_clear_fields'])
        self.assertEqual(read_sqlite(self.path)['rows'],fixture['rows'])

    def setUp(self):
        directory=ROOT.parent/'output'/'testing'
        directory.mkdir(parents=True,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=directory)
        self.path=Path(self.tmp.name)/'rekap.sqlite3'
        self.old_env={key:os.environ.get(key) for key in ('SIGAP_SHELTER_DB_PATH','SIGAP_SNAPSHOT_DIR')}
        os.environ['SIGAP_SHELTER_DB_PATH']=str(self.path)
        os.environ['SIGAP_SNAPSHOT_DIR']=str(Path(self.tmp.name)/'snapshots')
    def tearDown(self):
        for key,value in self.old_env.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value
        self.tmp.cleanup()
    def payload(self,rows,key='a'):
        header=['posko','desa','jumlah_jiwa','laki_laki','perempuan','waktu_laporan']
        return {'header':header,'rows':rows,'approved_write':{'source_snapshot':{'snapshot_id':key*32,'snapshot_sha256':'b'*64},'effective_payload':{'records':[{} for _ in rows]}}}
    def match(self,a,b,h,target):return a[:2]==b[:2]

    def test_identity_changes_keep_original_baseline_and_still_reject_concurrent_changes(self):
        header=['batch_id','id_laporan','posko','desa','jumlah_jiwa']
        stored={'header':header,'rows':[['old','R002','Posko Harapan','Sukamaju','10']]}
        baseline={'identity':identity_for(header,stored['rows'][0]),'row':dict(zip(header,stored['rows'][0]))}
        target={'batch_id':'old','report_id':'R002','shelter_name':'Posko Harapan','village':'Sukamaju'}
        for change in ({'shelter_name':'Posko Harapan Utama'},{'village':'Desa Baru'}):
            record={'batch_id':'new','report_id':'R001','shelter_name':'Posko Harapan','village':'Sukamaju','total_people':10,'storage_baseline':baseline,'update_target':target,**change}
            result=compare_stored([record],stored)
            self.assertEqual(result[0]['storage_baseline'],baseline)
            changed={'header':header,'rows':[['old','R002','Posko Harapan','Sukamaju','12']]}
            with self.assertRaisesRegex(ValueError,'berubah'):compare_stored([record],changed)

    def test_explicit_source_bound_rename_preserves_target_and_other_candidate_records(self):
        original={'batch_id':'old','report_id':'R001','shelter_name':'Posko Harapan','village':'Sukamaju','total_people':10,'male':4,'female':6,'urgent_needs':['air bersih']}
        other={**original,'report_id':'R002','shelter_name':'Posko Lain'}
        ref=save_snapshot({'snapshot_kind':'report_candidate','records':[original,other]})
        target={**ref,'record_index':0}
        patch={**original,'batch_id':'new','report_id':'R001'}
        with self.assertRaisesRegex(ValueError,'tidak cocok'):
            merge_correction([{**patch,'shelter_name':'Posko Salah'}],target,candidate=True)
        for extracted_name in ('Posko Harapan','Posko Harapan Utama'):
            corrected=merge_correction([{**patch,'shelter_name':extracted_name}],target,candidate=True,source_text='Koreksi nama posko ini menjadi Posko Harapan Utama. Desa tetap Sukamaju.')[0]
            self.assertEqual(corrected['shelter_name'],'Posko Harapan Utama')
            self.assertEqual(corrected['total_people'],10)
            self.assertEqual(corrected['urgent_needs'],['air bersih'])
            self.assertEqual(corrected['candidate_lineage'],[{'batch_id':'old','report_id':'R001'}])
            self.assertIn('nama posko',corrected['field_provenance']['shelter_name']['source_excerpt'])
        self.assertEqual(load_snapshot(ref)['records'],[original,other])
        with self.assertRaisesRegex(ValueError,'beberapa'):
            merge_correction([patch],target,candidate=True,source_text='Ubah nama posko menjadi A. Ganti nama posko menjadi B.')
    def write(self,payload):return write_sqlite(payload,self.path,self.match,merge_update)
    def baseline(self,payload,index=0):
        data=read_sqlite(self.path)
        payload['approved_write']['effective_payload']['records'][index]['storage_baseline']={'row':dict(zip(data['header'],data['rows'][index]))}
    def test_atomic_replay_and_history(self):
        payload=self.payload([['A','Desa A','10','4','6','2026-10-21 10:00'],['B','Desa B','20','9','11','2026-10-21 10:00']])
        self.assertEqual(self.write(payload)['appended'],2)
        self.assertTrue(self.write(payload)['replayed'])
        update=self.payload([['A','Desa A','12','5','7','2026-10-21 11:00']],'c');self.baseline(update)
        self.write(update)
        data=read_sqlite(self.path)
        self.assertEqual(data['rows'][0][2],'12');self.assertEqual(data['rows'][1][2],'20')
        with connect_storage(self.path) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM shelter_history').fetchone()[0],3)
    def test_stale_baseline_rejects_whole_transaction(self):
        self.write(self.payload([['A','Desa A','10','4','6','2026-10-21 10:00']]))
        update=self.payload([['B','Desa B','20','9','11','2026-10-21 11:00'],['A','Desa A','12','5','7','2026-10-21 11:00']],'c')
        update['approved_write']['effective_payload']['records'][1]['storage_baseline']={'row':{'jumlah_jiwa':'old'}}
        with self.assertRaisesRegex(ValueError,'berubah'):self.write(update)
        self.assertEqual(read_sqlite(self.path)['count'],1)
    def test_unapproved_and_duplicate_and_stale_dates_rejected(self):
        p=self.payload([['A','Desa A','10','4','6','2026-10-21 10:00']])
        with self.assertRaises(ValueError):self.write({'header':p['header'],'rows':p['rows']})
        with self.assertRaises(ValueError):self.write(self.payload(p['rows']*2))
        self.assertEqual(read_sqlite(self.path)['count'],0)
        self.write(p)
        older=self.payload([['A','Desa A','10','4','6','2026-10-20 10:00']],'c');self.baseline(older)
        with self.assertRaisesRegex(ValueError,'usang'):self.write(older)
    def test_migration_dry_run_apply_and_replay(self):
        source=Path(self.tmp.name)/'old.csv'
        with source.open('w',encoding='utf-8-sig',newline='') as stream:
            csv.writer(stream).writerows([['posko','desa','jumlah_jiwa','versi','disimpan_di'],['A','Desa A','10','2','2026-10-21']])
        before=source.read_bytes()
        self.assertFalse(migrate(source,self.path)['applied']);self.assertFalse(self.path.exists())
        self.assertTrue(migrate(source,self.path,True)['applied']);self.assertTrue(migrate(source,self.path,True)['replayed'])
        self.assertEqual(source.read_bytes(),before)
    def test_targeted_legacy_update_matches_storage_version_and_rejects_stale_target(self):
        header=['batch_id','id_laporan','posko','desa','jumlah_jiwa','laki_laki','perempuan','waktu_laporan']
        old=['old','R002','Posko Harapan','','98','45','55','2026-10-02T07:32']
        migrated_header=header+['versi','disimpan_di']
        migrated=old+['1','']
        write_sqlite({'header':migrated_header,'rows':[migrated]},self.path,self.match,merge_update,migration=True)
        target={'batch_id':'old','report_id':'R002','shelter_name':'Posko Harapan','village':'','expected':dict(zip(migrated_header,migrated))}
        next_row=['new','R001','Posko Harapan','','98','43','55','2026-10-22T22:23']
        payload={'header':header,'rows':[next_row],'update_targets':[target],'approved_write':{'source_snapshot':{'snapshot_id':'c'*32,'snapshot_sha256':'b'*64},'effective_payload':{'records':[{'storage_baseline':{'row':dict(zip(migrated_header,migrated))}}]}}}
        match=lambda incoming,stored,columns,target:matches_update_target(stored,columns,target)
        self.assertFalse(match(next_row,migrated,header,target),'reproduces old schema omission')
        result=write_sqlite(payload,self.path,match,merge_update)
        self.assertEqual(result['updated'],1);self.assertEqual(result['appended'],0)
        data=read_sqlite(self.path);self.assertEqual(data['count'],1)
        self.assertEqual(data['rows'][0][data['header'].index('laki_laki')],'43')
        self.assertEqual(data['rows'][0][data['header'].index('versi')],'2')
        self.assertTrue(write_sqlite(payload,self.path,match,merge_update)['replayed'])
        payload['approved_write']['source_snapshot']['snapshot_id']='d'*32
        with self.assertRaisesRegex(ValueError,'Target posko'):write_sqlite(payload,self.path,match,merge_update)
    def test_readback_blank_optional_field_is_equal_but_changed_value_is_not(self):
        record={'shelter_name':'Posko Harapan','village':'','shelter_type':'','male':43}
        self.assertEqual(verify_readback({'records':[record]},[record])['status'],'verified')
        self.assertEqual(verify_readback({'records':[record]},[{**record,'male':45}])['status'],'mismatch')
        self.assertEqual(verify_readback({'records':[record]},[{**record,'shelter_type':'tenda'}])['status'],'mismatch')
    def test_full_source_validate_gate_write_readback_and_conflict_resolution(self):
        def prepare(total,male,female,time):
            raw=f'22/10/2026 {time} - Relawan: Posko Harapan di Desa A. Total {total} jiwa, laki-laki {male}, perempuan {female}. Butuh air bersih.'
            source=PoskoReportPreprocessor(raw_text=raw).build_clean_reports().text
            extraction={'records':[{'report_id':'R001','shelter_name':'Posko Harapan','village':'Desa A','total_people':total,'male':male,'female':female,'urgent_needs':['air bersih']}]}
            result=ShelterReportValidator(llm_output=json.dumps(extraction),source_text=source).build_validated().text
            self.assertNotIn('GAGAL:',result)
            parsed=json.loads(result.split('```json\n')[-1].split('\n```')[0])
            return parsed
        def commit(preview,choices=None):
            request={key:preview[key] for key in ('snapshot_id','snapshot_sha256')}
            request.update(approved_snapshot_sha256=preview['snapshot_sha256'],confirmed_by_officer=True,allow_partial=True,conflict_decisions=choices or {})
            gate=OfficerConfirmationGate(payload=json.dumps(request))
            rows=gate.build_approved().text
            self.assertTrue(rows,gate._result().get('reason'))
            result=LogisticsStorageWriter(content=rows,storage_mode='sqlite').send().text
            self.assertNotIn('GAGAL',result)
            return json.loads(result.split('SIGAP_WRITE_RESULT ')[1].split('\n')[0])
        initial=prepare(10,4,6,'10.00');receipt=commit(initial)
        reader=LogisticsStorageReader(query=json.dumps({'action':'all','expected_snapshot_id':receipt['snapshot_id'],'expected_snapshot_sha256':receipt['snapshot_sha256']}),storage_mode='sqlite')
        read=reader.fetch().text
        self.assertIn('verified',read)
        new=prepare(12,5,7,'11.00')
        conflicts=new['snapshot_records'][0]['storage_conflicts']
        self.assertEqual({c['field'] for c in conflicts},{'total_people','male','female'})
        gate=OfficerConfirmationGate(payload=json.dumps({'snapshot_id':new['snapshot_id'],'snapshot_sha256':new['snapshot_sha256'],'approved_snapshot_sha256':new['snapshot_sha256'],'confirmed_by_officer':True,'allow_partial':True}))
        self.assertFalse(gate._result()['approved'])
        commit(new,{'R001':{c['field']:'keep' for c in conflicts}})
        records=build_records(**{key:read_sqlite(self.path)[key] for key in ('header','rows')})
        self.assertEqual(records[0]['total_people'],10)
        self.assertEqual(records[0]['male'],4)


if __name__=='__main__':unittest.main()
