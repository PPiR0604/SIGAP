"""Index native Langflow debug-history queries without changing/deleting records.

Read-only inspection. Index installation is disabled: Langflow 1.12.6 rejects
custom indexes on its own tables during the next startup Alembic check.
"""
import argparse
import json
from pathlib import Path
import sqlite3
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'langflow'))
from deploy.metadata import validate_metadata_schema

parser = argparse.ArgumentParser()
parser.add_argument('--database', type=Path, required=True)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--output', type=Path)
args = parser.parse_args()
if args.apply:
    parser.error('--apply is disabled: custom indexes prevent Langflow startup. Use repair-langflow-indexes.py to remove the old indexes with a backup.')
database = args.database.resolve(strict=True)
if not database.is_file():
    raise ValueError('Expected an existing Langflow SQLite file.')
db = sqlite3.connect(database.as_uri()+'?mode=ro', uri=True, timeout=3)
db.execute('pragma busy_timeout=3000')
validate_metadata_schema(db)
flow_id,vertex_id = db.execute('select flow_id,id from vertex_build order by timestamp desc limit 1').fetchone() or ('0'*32,'sigap-index-probe')
queries = {
    'vertex_keep': ('select build_id from vertex_build where flow_id=? and id=? order by timestamp desc,build_id desc limit 100', (flow_id,vertex_id)),
    'global_keep': ('select build_id from vertex_build order by timestamp desc,build_id desc limit 1000', ()),
    'transaction_keep': ('select id from "transaction" where flow_id=? order by timestamp desc limit -1 offset 999', (flow_id,)),
}

def measure():
    result={}
    for name,(sql,values) in queries.items():
        times=[]
        for _ in range(3):
            started=time.perf_counter();db.execute(sql,values).fetchall()
            times.append(round((time.perf_counter()-started)*1000,3))
        result[name]={'ms':times,'plan':[row[3] for row in db.execute('explain query plan '+sql,values)]}
    return result

before=measure()
changes={'indexes_created':[]}
result={'applied':args.apply,'records_modified':False,'before':before,'after':measure(),**changes}
db.close()
if args.output:
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,indent=2))
