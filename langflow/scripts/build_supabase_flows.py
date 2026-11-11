"""Separate secure exports. Existing local flows remain available for rollback, never selected implicitly."""
import ast
import argparse
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

def compact_preparation(flow):
    """Preparation publishes a signed source prompt; extraction/validation are separate tools."""
    data = flow['data']
    def single(name):
        nodes = [n for n in data['nodes'] if n.get('data', {}).get('node', {}).get('display_name') == name]
        if len(nodes) != 1:
            raise ValueError('Expected one preparation node: ' + name)
        return nodes[0]
    chat, prepare, prompt, output = [single(n) for n in ('Chat Input', 'Posko Report Preprocessor', 'Prompt Template', 'Chat Output')]
    template = prompt['data']['node']['template']
    if template.get('use_double_brackets', {}).get('value'):
        raise ValueError('Mustache preparation templates are not supported.')
    value = template['template']['value']
    from string import Formatter
    if [f for _, f, _, _ in Formatter().parse(value) if f is not None] != ['reports']:
        raise ValueError('Unexpected preparation template variables.')
    config = prepare['data']['node']
    config['template']['extraction_template'] = {'_input_type':'MultilineInput', 'name':'extraction_template',
        'display_name':'Template Instruksi Ekstraksi', 'value':value, 'advanced':True, 'required':False, 'show':True, 'type':'str'}
    config['field_order'] = list(dict.fromkeys(config.get('field_order', []) + ['extraction_template']))
    source = next(e for e in data['edges'] if e['source'] == prepare['id'] and e['target'] == prompt['id'])
    target = next(e for e in data['edges'] if e['target'] == output['id'])
    import copy
    joined = copy.deepcopy(target)
    joined.update(source=prepare['id'], sourceHandle=source['sourceHandle'], id='sigap-prepared-output')
    joined.setdefault('data', {})['sourceHandle'] = json.loads(source['sourceHandle'].replace('œ', '"'))
    data['nodes'] = [chat, prepare, output]
    data['edges'] = [e for e in data['edges'] if e['source'] == chat['id'] and e['target'] == prepare['id']] + [joined]
    flow['description'] += ' sigap:compact-preparation-v1 — Menyiapkan laporan bersih dan referensi sumber. Ekstraksi LLM serta validasi dijalankan terpisah oleh backend; tidak menyimpan rekap.'
    return flow

def code_for(module, methods):
    code = (ROOT/'components'/f'{module}.py').read_text(encoding='utf-8')
    # Helpers share module globals. Insert one copy, with definitions in dependency order.
    code = re.sub(r'^[ \t]*from sigap_(contracts|sqlite|preprocess|needs) import [^\n]+$', '', code, flags=re.M)
    helpers = '\n'.join((ROOT/'lib'/f'{m}.py').read_text(encoding='utf-8') for m in ('sigap_contracts','sigap_sqlite','sigap_cloud','sigap_preprocess','sigap_needs'))
    helpers = re.sub(r'^from sigap_contracts import [^\n]+$', '', helpers, flags=re.M).replace('from __future__ import annotations','')
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
    parser = argparse.ArgumentParser()
    parser.add_argument('--flow', choices=[p.stem for p in (ROOT/'flows').glob('*.json')])
    selected = parser.parse_args().flow
    output=ROOT/'flows'/'supabase';output.mkdir(exist_ok=True)
    for file in (ROOT/'flows').glob('*.json'):
        if selected and file.stem != selected:
            continue
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
        if file.stem=='validate_needs':
            flow['description']+=' sigap:structured-source-v1 — Memvalidasi perubahan formulir: input JSON source_request dengan report_text dan referensi kandidat/read-back, serta satu records. Menyiapkan sumber dan memvalidasi dalam satu workflow. Tidak menyimpan rekap operasional.'
            flow['description']+=' sigap:validated-calculation-v1 — include_calculation=true mengembalikan hitungan deterministik untuk satu kandidat, terikat ke snapshot tervalidasi yang sama.'
        if file.stem=='fetch_shelters':
            flow['description']+=' sigap:compact-read-result-v1 — response_format=compact mengembalikan seluruh metadata yang sama pada satu baris SIGAP_READ_RESULT; format manusia tetap default.'
            flow['description']+=' sigap:validated-calculation-v1 — include_calculation=true mengembalikan hitungan deterministik seluruh hasil baca, terikat ke snapshot read-back yang sama; tidak mengubah rekap.'
        if file.stem=='prepare_needs':
            compact_preparation(flow)
        (output/file.name).write_text(json.dumps(flow,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Built authenticated Supabase flows: ' + (selected or 'all seven') + '.')

if __name__=='__main__':main()
