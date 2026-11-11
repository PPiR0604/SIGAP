"""Foreign indexes cannot be installed; removal preserves native data and startup."""
import asyncio
from contextlib import closing
from dataclasses import replace
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from deploy.config import Settings
from deploy.metadata import INDEXES, ensure_metadata_indexes
from deploy.runtime import ManagedLangflow
import importlib.util
spec=importlib.util.spec_from_file_location("repair_langflow_indexes",ROOT.parent/"backend/scripts/repair-langflow-indexes.py")
repair_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair_module)
repair=repair_module.repair

def fixture(path, rows=True):
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('create table vertex_build(timestamp text,id text,data text,build_id text primary key,flow_id text)')
        db.execute('create table "transaction"(timestamp text,id text primary key,flow_id text,outputs text)')
        if rows:
            db.executemany('insert into vertex_build values(?,?,?,?,?)',[(f'2026-11-09 01:00:{i:02}',str(i%3),'immutable-'+str(i),str(i),'flow-'+str(i%2)) for i in range(20)])
            db.executemany('insert into "transaction" values(?,?,?,?)',[(f'2026-11-09 01:00:{i:02}',str(i),'flow-'+str(i%2),'immutable-'+str(i)) for i in range(20)])

def records(path):
    with closing(sqlite3.connect(path)) as db, db:
        return {table:db.execute('select * from "'+table+'" order by rowid').fetchall() for table in ['vertex_build','transaction']}

class MetadataTests(unittest.TestCase):
    def test_installation_is_disabled_without_changing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'runtime.db';fixture(path);before=records(path)
            with self.assertRaisesRegex(RuntimeError,'disabled'):ensure_metadata_indexes(path)
            self.assertEqual(records(path),before)
            with closing(sqlite3.connect(path)) as db:
                self.assertFalse(db.execute("select name from sqlite_master where name like 'idx_sigap_%'").fetchall())

    def test_repair_preserves_all_rows_schema_and_verified_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'runtime.db';fixture(path);before=records(path)
            with closing(sqlite3.connect(path)) as db, db:
                for *_,sql in INDEXES:db.execute(sql)
                db.execute('create index native_index on vertex_build(id)')
            backup=Path(directory)/'backup.db'
            result=repair(path,backup)
            self.assertEqual(len(result['removed_indexes']),3)
            self.assertEqual(records(path),before);self.assertEqual(records(backup),before)
            with closing(sqlite3.connect(path)) as db:
                self.assertTrue(db.execute("select name from sqlite_master where name='native_index'").fetchone())
            with self.assertRaisesRegex(ValueError,'new file'):repair(path,backup)
            second=repair(path,Path(directory)/'second.db')
            self.assertEqual(second['removed_indexes'],[])

    def test_repair_rolls_back_on_unexpected_definition(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'runtime.db';fixture(path);before=records(path)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute(INDEXES[0][-1])
                db.execute('create index idx_sigap_tx_flow_time on "transaction"(id)')
            with self.assertRaisesRegex(ValueError,'differs'):repair(path,Path(directory)/'backup.db')
            self.assertEqual(records(path),before)
            with closing(sqlite3.connect(path)) as db:
                self.assertTrue(db.execute('select name from sqlite_master where name=?',(INDEXES[0][0],)).fetchone())

class MetadataStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_managed_start_does_not_install_foreign_indexes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'runtime.db';fixture(path,rows=False)
            config=replace(Settings.from_env({'LANGFLOW_API_KEY':'a'*40,'LANGFLOW_SUPERUSER_PASSWORD':'b'*32,
                'LANGFLOW_SECRET_KEY':'c'*40,'SIGAP_BACKEND_INTERNAL_URL':'https://backend.example.test'}),data_dir=Path(directory))
            runtime=ManagedLangflow(config);process=MagicMock();process.poll.return_value=None
            real_client=httpx.AsyncClient
            def client(**kwargs):
                return real_client(**kwargs,transport=httpx.MockTransport(lambda request:httpx.Response(200,json={'status':'ok'})))
            async def bootstrap(*_):
                with closing(sqlite3.connect(path)) as db, db:
                    names={r[0] for r in db.execute("select name from sqlite_master where type='index'")}
                self.assertFalse({index[0] for index in INDEXES} & names)
                return 'project','internal-key'
            with patch('deploy.runtime.subprocess.Popen',return_value=process),patch('deploy.runtime.httpx.AsyncClient',side_effect=client),patch('deploy.runtime.bootstrap',side_effect=bootstrap),patch('deploy.runtime.verify_tools',new=AsyncMock(return_value=7)):
                task=asyncio.create_task(runtime.start())
                async def ready():
                    while not runtime.ready:
                        if task.done():await task
                        await asyncio.sleep(0.01)
                try:await asyncio.wait_for(ready(),5);self.assertEqual(runtime.phase,'ready')
                finally:
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):await task
