"""Undo only SIGAP's three native indexes, after a verified SQLite backup.

Stop Langflow first. This never changes table rows or native migration settings.
"""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'langflow'))
from deploy.metadata import INDEXES


def row_state(db):
    result = {}
    for (table,) in db.execute("select name from sqlite_master where type='table' order by name"):
        digest = hashlib.sha256()
        count = 0
        quoted = '"' + table.replace('"', '""') + '"'
        for row in db.execute('select * from ' + quoted + ' order by rowid'):
            digest.update(json.dumps(row, ensure_ascii=True, separators=(',', ':'), default=lambda value: {'bytes_hex': value.hex()}).encode())
            digest.update(b'\n')
            count += 1
        result[table] = {'count': count, 'sha256': digest.hexdigest()}
    return result


def repair(database, backup):
    path = Path(database).resolve(strict=True)
    destination = Path(backup).resolve()
    if destination == path or destination.exists():
        raise ValueError('Backup must be a new file distinct from the database.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents overwriting another backup, including a race.
    with destination.open('xb'):
        pass
    with closing(sqlite3.connect(path.as_uri() + '?mode=rw', uri=True, timeout=3)) as db:
        with closing(sqlite3.connect(destination)) as saved:
            db.backup(saved)
            if saved.execute('pragma quick_check').fetchone()[0] != 'ok':
                raise ValueError('Backup integrity check failed; original database unchanged.')
            backed_up = row_state(saved)
        db.execute('begin immediate')
        try:
            before = row_state(db)
            if before != backed_up:
                raise ValueError('Database changed during backup. Stop Langflow and retry with a new backup.')
            schema = db.execute('select type,name,tbl_name,sql from sqlite_master order by type,name').fetchall()
            removed = []
            for name, table, columns, directions, _ in INDEXES:
                existing = db.execute('select tbl_name from sqlite_master where type=? and name=?', ('index', name)).fetchone()
                if not existing:
                    continue
                fields = [r for r in db.execute('pragma index_xinfo("' + name + '")') if r[5]]
                info = next(r for r in db.execute('pragma index_list("' + table + '")') if r[1] == name)
                if existing[0] != table or [r[2] for r in fields] != columns or [r[3] for r in fields] != directions or info[2] or info[3] != 'c' or info[4]:
                    raise ValueError('Index definition differs from the known SIGAP index; no changes committed.')
                db.execute('drop index "' + name + '"')
                removed.append(name)
            after = row_state(db)
            remaining = db.execute('select type,name,tbl_name,sql from sqlite_master order by type,name').fetchall()
            if after != before or remaining != [r for r in schema if not (r[0] == 'index' and r[1] in removed)]:
                raise ValueError('Unexpected data/schema change; rollback required.')
            if db.execute('pragma quick_check').fetchone()[0] != 'ok':
                raise ValueError('Integrity check failed; rollback required.')
            db.commit()
        except BaseException:
            db.rollback()
            raise
    return {'backup': str(destination), 'removed_indexes': removed, 'all_table_rows_unchanged': True, 'other_schema_unchanged': True, 'quick_check': 'ok', 'tables': before}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = repair(args.database, args.backup)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'tables'}, indent=2))
