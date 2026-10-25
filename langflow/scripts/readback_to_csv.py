"""CSV adapter for a canonical MCP backup; the original JSON backup stays unchanged."""
import ast
import csv
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def export_readback(source,destination):
    data=json.loads(Path(source).read_text(encoding='utf-8'))
    records=data['records']
    tree=ast.parse((ROOT/'components'/'logistics_storage_reader.py').read_text(encoding='utf-8'))
    mapping=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(getattr(t,'id','')=='COLUMN_MAP' for t in node.targets))
    inverse={v:k for k,v in mapping.items()}
    fields=list(dict.fromkeys(field for record in records for field in record))
    header=[inverse.get(field,field) for field in fields]
    def cell(field,value):
        if value is None:return ''
        if field in ('urgent_needs','surplus_do_not_send'):
            return '; '.join(item if isinstance(item,str) else item.get('item','') for item in value)
        if isinstance(value,(dict,list,bool)):return json.dumps(value,ensure_ascii=False,sort_keys=True)
        return str(value)
    with Path(destination).open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream)
        writer.writerow(header)
        writer.writerows([[cell(field,record.get(field)) for field in fields] for record in records])
    return len(records)


if __name__=='__main__':
    base=ROOT.parent/'output'/'testing'/'storage-migration'
    print(json.dumps({'exported_rows':export_readback(base/'source-readback.json',base/'source-rekap.csv'),'source_modified':False}))
