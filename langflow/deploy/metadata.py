"""Legacy index definitions for rollback only; installation breaks native startup."""
from pathlib import Path
import sqlite3

INDEXES = [
    ('idx_sigap_vbuild_vertex_time', 'vertex_build', ['flow_id','id','timestamp','build_id'],
     [0,0,1,1], 'create index if not exists idx_sigap_vbuild_vertex_time on vertex_build(flow_id,id,timestamp desc,build_id desc)'),
    ('idx_sigap_vbuild_global_time', 'vertex_build', ['timestamp','build_id'],
     [1,1], 'create index if not exists idx_sigap_vbuild_global_time on vertex_build(timestamp desc,build_id desc)'),
    ('idx_sigap_tx_flow_time', 'transaction', ['flow_id','timestamp','id'],
     [0,1,0], 'create index if not exists idx_sigap_tx_flow_time on "transaction"(flow_id,timestamp desc,id)'),
]

def validate_metadata_schema(db):
    for _,table,columns,_,_ in INDEXES:
        available={row[1] for row in db.execute('pragma table_info("'+table+'")')}
        if not set(columns)<=available:
            raise ValueError('Unsupported Langflow metadata schema.')

def ensure_metadata_indexes(database):
    """Disabled: native Langflow's Alembic check rejects these indexes on restart."""
    raise RuntimeError('Custom history indexes are disabled because they prevent Langflow startup.')
