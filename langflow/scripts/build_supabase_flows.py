"""Separate secure exports. Existing local flows remain available for rollback, never selected implicitly."""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = {
 'Posko Report Preprocessor': ('posko_report_preprocessor', ['build_clean_reports']),
 'OpenAI Report Extractor': ('openai_report_extractor', ['build_extraction']),
 'Shelter Report Validator': ('shelter_report_validator', ['build_validated']),
 'Officer Confirmation Gate': ('officer_confirmation_gate', ['build_approved','build_rejected']),
 'Logistics Storage Writer': ('logistics_storage_writer', ['send']),
 'Logistics Storage Reader': ('logistics_storage_reader', ['fetch']),
 'Needs Gap Calculator': ('needs_gap_calculator', ['build_needs_gap']),
 'Duplicate & Silent Shelter Detector': ('duplicate_silent_detector', ['build_detection']),
 'Donor Bulletin Builder': ('donor_bulletin_builder', ['build_bulletin_message']),
}

def code_for(module, methods):
    code = (ROOT/'components'/f'{module}.py').read_text(encoding='utf-8')
    # Helpers share module globals. Insert one copy, with definitions in dependency order.
    code = re.sub(r'^from sigap_(contracts|sqlite) import [^\n]+$', '', code, flags=re.M)
    helpers = '\n'.join((ROOT/'lib'/f'{m}.py').read_text(encoding='utf-8') for m in ('sigap_contracts','sigap_sqlite','sigap_cloud'))
    overrides = '\n_local_read_storage=read_sqlite\n_local_write_storage=write_sqlite\nsave_snapshot=cloud_save_snapshot\nload_snapshot=cloud_load_snapshot\ncommit_snapshot=cloud_commit_snapshot\nread_sqlite=cloud_read_storage\nwrite_sqlite=cloud_write_storage\n'
    # Existing local writer continues to validate local scratch provenance. Component-facing source is Supabase.
    code = code.replace("{'mode':'sqlite','path':", "{'mode':'supabase','path':").replace("source_info = f\"SQLite:", "source_info = f\"Supabase:")
    # Writer's default database_path is not used by the cloud transport.
    code = code.replace("write_sqlite(payload, database_path(getattr(self,'sqlite_path',None)),", "write_sqlite(payload, None,")
    code = re.sub(r'^(    inputs = \[)',r'\1\n        MessageTextInput(name="sigap_context", display_name="Authenticated backend context", required=True, advanced=True),',code,flags=re.M)
    # Some components import MessageInput rather than MessageTextInput.
    code = 'from lfx.io import MessageTextInput\n' + code.replace('from __future__ import annotations','')
    for method in methods:
        if not re.search(r'^    def '+method+r'\(',code,re.M):
            raise ValueError(f'Method missing: {module}.{method}')
        code = re.sub(r'^(    def '+method+r'\()',r'    @authenticated_component\n\1',code,flags=re.M)
    result = helpers + overrides + code
    ast.parse(result)
    return result

def main():
    output=ROOT/'flows'/'supabase';output.mkdir(exist_ok=True)
    for file in (ROOT/'flows').glob('*.json'):
        flow=json.loads(file.read_text(encoding='utf-8'))
        chat=next(n for n in flow['data']['nodes'] if n['data']['node'].get('display_name')=='Chat Input')
        source=next(e['sourceHandle'] for e in flow['data']['edges'] if e['source']==chat['id'])
        for node in flow['data']['nodes']:
            config=node['data']['node'];name=config.get('display_name')
            if name not in COMPONENTS:continue
            module,methods=COMPONENTS[name]
            config['template']['code']['value']=code_for(module,methods)
            config['template']['sigap_context']={'_input_type':'MessageTextInput','name':'sigap_context','display_name':'Authenticated backend context','value':'','required':True,'advanced':True,'show':True,'type':'str','input_types':['Message']}
            config.setdefault('field_order',[]).append('sigap_context')
            handle=json.dumps({'fieldName':'sigap_context','id':node['id'],'inputTypes':['Message'],'type':'str'}).replace('"','œ')
            flow['data']['edges'].append({'source':chat['id'],'target':node['id'],'sourceHandle':source,'targetHandle':handle,'id':f'sigap-auth-{node["id"]}','data':{'sourceHandle':json.loads(source.replace('œ','"')),'targetHandle':json.loads(handle.replace('œ','"'))}})
        flow['description']=flow.get('description','')+' Requires authenticated SIGAP backend capability. Supabase scoped storage; unsigned calls rejected.'
        (output/file.name).write_text(json.dumps(flow,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Built seven authenticated Supabase flows.')

if __name__=='__main__':main()
