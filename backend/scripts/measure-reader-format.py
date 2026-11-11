"""Offline formatting replay of an authorized storage document received on stdin.

No native flow, model, capability, snapshot or operational write is performed.
Private replay text stays under ignored output/; public metrics contain no rows.
"""
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'langflow/tests'),str(ROOT/'langflow/lib'),str(ROOT/'langflow/components')]
import test_sqlite_migration
from logistics_storage_reader import format_shelter_summary,build_records
from sigap_needs import calculate

document=json.load(sys.stdin)
records=build_records(document['header'],document['rows'])
# This local fixture reference is used only to compare serialization. It is
# never loaded, saved, signed, or sent to any flow/API as a valid source.
reference={'snapshot_id':'0'*32,'snapshot_sha256':hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()}
calculation=calculate(json.loads(json.dumps(records)))
calculation.update(reference)
options=dict(reference=reference,calculation=calculation)
before=format_shelter_summary(records,'Supabase',**options)
after=format_shelter_summary(records,'Supabase',response_format='compact',**options)
expected=json.loads(before.split('```json\n')[-1].split('\n```')[0])
expected['verification_status']=expected['verification']['status']
assert json.loads(after.removeprefix('SIGAP_READ_RESULT '))==expected
samples={}
for mode in ('human','compact'):
 started=time.perf_counter()
 for _ in range(200):format_shelter_summary(records,'Supabase',response_format=mode,**options)
 samples[mode]=round((time.perf_counter()-started)*1000/200,4)
directory=ROOT/'output/reader-format-replay';directory.mkdir(parents=True,exist_ok=True)
(directory/'human.txt').write_text(before,encoding='utf-8')
(directory/'compact.txt').write_text(after,encoding='utf-8')
digest=hashlib.sha256(json.dumps(expected,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
result={'authorized_storage_document':True,'offline_formatting_replay':True,'fixture_reference_not_saved_or_dispatched':True,
        'flow_calls':0,'model_calls':0,'operational_write':False,'records':len(records),'validated_calculation':True,
        'complete_payload_equal':True,'payload_sha256':digest,'human_bytes':len(before.encode()),'compact_bytes':len(after.encode()),
        'formatter_mean_ms_200_iterations':samples,'private_replay_directory':'output/reader-format-replay',
        'not_a_live_flow_latency_measurement':True}
(ROOT/'ref/compact-reader-format.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
