"""Embed reviewed workflow components and helpers; preserve flow IDs, edges and other configuration."""
import argparse
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
COMPONENTS={'Posko Report Preprocessor':'posko_report_preprocessor',
            'Logistics Storage Writer':'logistics_storage_writer','Logistics Storage Reader':'logistics_storage_reader',
            'Officer Confirmation Gate':'officer_confirmation_gate','Shelter Report Validator':'shelter_report_validator'}


def embedded(name):
    code=(ROOT/'components'/f'{name}.py').read_text(encoding='utf-8')
    for module in ('sigap_preprocess','sigap_contracts','sigap_sqlite'):
        helper=(ROOT/'lib'/f'{module}.py').read_text(encoding='utf-8')
        helper=helper.replace('from __future__ import annotations','')
        code=re.sub(r'^from '+module+r' import [^\n]+$',lambda _:helper,code,flags=re.M)
    compile(code,name+'.py','exec')
    return code


def sync(selected=None):
    changed=[]
    for path in (ROOT/'flows').glob('*.json'):
        if selected and path.stem != selected: continue
        flow=json.loads(path.read_text(encoding='utf-8'))
        touched=False
        for node in flow.get('data',{}).get('nodes',[]):
            config=node.get('data',{}).get('node',{})
            name=config.get('display_name')
            if name not in COMPONENTS: continue
            template=config['template']
            template['code']['value']=embedded(COMPONENTS[name])
            if name not in ('Officer Confirmation Gate','Posko Report Preprocessor'):
                template['sqlite_path']={'_input_type':'StrInput','name':'sqlite_path','display_name':'Database Rekap SQLite','value':'','advanced':True,'required':False,'show':True,'type':'str','info':'Path yang sama di reader/writer/validator; kosong memakai SIGAP_SHELTER_DB_PATH.'}
                if 'sqlite_path' not in config.get('field_order',[]):config.setdefault('field_order',[]).append('sqlite_path')
            if name in ('Logistics Storage Writer','Logistics Storage Reader'):
                template['storage_mode']['value']='sqlite'
                template['storage_mode']['options']=['sqlite','auto','google_sheets','csv']
                template['storage_mode']['info']='SQLite adalah sumber utama rekap. Reader/writer memakai SIGAP_SHELTER_DB_PATH yang sama.'
            touched=True
        if touched:
            path.write_text(json.dumps(flow,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            changed.append(path.name)
    print('Updated: '+', '.join(changed))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--flow',choices=[p.stem for p in (ROOT/'flows').glob('*.json')])
    sync(parser.parse_args().flow)
