"""Embed reviewed storage components and helpers; preserve flow IDs, edges and other configuration."""
import ast
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
COMPONENTS={'Logistics Storage Writer':'logistics_storage_writer','Logistics Storage Reader':'logistics_storage_reader',
            'Officer Confirmation Gate':'officer_confirmation_gate','Shelter Report Validator':'shelter_report_validator'}


def embedded(name):
    code=(ROOT/'components'/f'{name}.py').read_text(encoding='utf-8')
    for module in ('sigap_contracts','sigap_sqlite'):
        helper=(ROOT/'lib'/f'{module}.py').read_text(encoding='utf-8')
        code=re.sub(r'^from '+module+r' import [^\n]+$',lambda _:helper,code,flags=re.M)
    ast.parse(code)
    return code


def sync():
    changed=[]
    for path in (ROOT/'flows').glob('*.json'):
        flow=json.loads(path.read_text(encoding='utf-8'))
        touched=False
        for node in flow.get('data',{}).get('nodes',[]):
            config=node.get('data',{}).get('node',{})
            name=config.get('display_name')
            if name not in COMPONENTS: continue
            template=config['template']
            template['code']['value']=embedded(COMPONENTS[name])
            if name!='Officer Confirmation Gate':
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


if __name__=='__main__':sync()
