"""SQLite rekap owner: Langflow. No model-generated SQL or direct browser access."""
import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def database_path(path=None):
    return Path(path or os.environ.get('SIGAP_SHELTER_DB_PATH', 'output/rekap_posko.sqlite3')).expanduser().resolve()


@contextmanager
def connect_storage(path=None):
    location = database_path(path)
    location.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(location), timeout=15, isolation_level=None)
    try:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS shelters (
            identity TEXT PRIMARY KEY, row_json TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0));
          CREATE TABLE IF NOT EXISTS shelter_history (
            id INTEGER PRIMARY KEY, identity TEXT NOT NULL, before_json TEXT,
            after_json TEXT NOT NULL, commit_key TEXT NOT NULL, saved_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS storage_commits (
            commit_key TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, result_json TEXT NOT NULL);
        ''')
        yield db
    finally:
        db.close()


def identity_for(header, row, allow_incomplete=False):
    get = lambda name: str(row[header.index(name)] or '').strip() if name in header else ''
    norm = lambda s: ' '.join(re.findall(r'\w+', s.casefold()))
    disaster, shelter = get('disaster_id'), get('shelter_id')
    if shelter:
        return json.dumps([disaster, 'id', shelter], ensure_ascii=False)
    name, village = norm(get('posko')), norm(get('desa'))
    if not name or not village or village in ('?', 'belum diketahui'):
        if allow_incomplete:
            # Preserve incomplete historical rows without inventing a village or public shelter ID.
            return json.dumps([disaster,'legacy',get('batch_id'),get('id_laporan'),name],ensure_ascii=False)
        raise ValueError('Identitas posko/desa belum lengkap; klarifikasi sebelum menyimpan.')
    return json.dumps([disaster, 'name', name, village], ensure_ascii=False)


def read_sqlite(path=None):
    with connect_storage(path) as db:
        db.execute('BEGIN')
        header = db.execute("SELECT value FROM storage_meta WHERE key='header'").fetchone()
        rows = [json.loads(r[0]) for r in db.execute('SELECT row_json FROM shelters ORDER BY rowid')]
        db.commit()
    return {'header': json.loads(header[0]) if header else [], 'rows': rows, 'count': len(rows), 'path': str(database_path(path))}


def write_sqlite(payload, path, match, merge, *, migration=False):
    """One transaction covers every row, history and idempotency receipt."""
    header = payload['header']
    rows = payload['rows']
    if not header or len(set(header)) != len(header) or any(len(row) != len(header) for row in rows):
        raise ValueError('Schema/baris penyimpanan tidak valid.')
    approved = payload.get('approved_write')
    if not migration and not approved:
        raise ValueError('SQLite hanya menerima baris dari snapshot yang disetujui.')
    digest = hashlib.sha256(json.dumps({k:payload.get(k) for k in ('header','rows','clear_columns','update_targets')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    commit_key = json.dumps(approved['source_snapshot'],sort_keys=True) if approved else 'migration:' + digest
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    output_header = header if migration else header + ['versi','disimpan_di']
    with connect_storage(path) as db:
        db.execute('BEGIN IMMEDIATE')
        try:
            prior = db.execute('SELECT payload_sha256,result_json FROM storage_commits WHERE commit_key=?',(commit_key,)).fetchone()
            if prior:
                if prior[0] != digest:
                    raise ValueError('Snapshot sudah disimpan dengan keputusan berbeda.')
                db.rollback()
                return {**json.loads(prior[1]), 'replayed': True}
            meta = db.execute("SELECT value FROM storage_meta WHERE key='header'").fetchone()
            old_header = json.loads(meta[0]) if meta else output_header
            if old_header != output_header and not set(old_header).issubset(output_header):
                raise ValueError('Schema SQLite berbeda; migrasi eksplisit diperlukan.')
            existing = [(r[0],json.loads(r[1]),r[2]) for r in db.execute('SELECT identity,row_json,version FROM shelters ORDER BY rowid')]
            if migration and existing:
                raise ValueError('Migrasi awal hanya boleh ke database rekap kosong.')
            existing = [(key,[row[old_header.index(c)] if c in old_header else '' for c in output_header],version) for key,row,version in existing]
            # Persist additive header expansion for untouched shelters as well.
            for key,row,version in existing:
                db.execute('UPDATE shelters SET row_json=? WHERE identity=?',(json.dumps(row,ensure_ascii=False),key))
            appended = updated = 0
            seen = set()
            for index,row in enumerate(rows):
                target = payload.get('update_targets',[None]*len(rows))[index]
                # Existing rows include storage metadata (versi/disimpan_di). Targets
                # read from storage can bind these columns too; use their actual schema.
                matches = [(key,old,version) for key,old,version in existing if match(row,old,output_header,target)]
                if len(matches)>1 or target and len(matches)!=1:
                    raise ValueError('Target posko berubah/hilang/ambigu. Baca ulang dan setujui kandidat baru.')
                key = matches[0][0] if matches else identity_for(header,row,allow_incomplete=migration)
                if key in seen:
                    raise ValueError('Posko duplikat dalam satu batch; selesaikan konflik sebelum menyimpan.')
                seen.add(key)
                old = matches[0][1] if matches else None
                new_identity=identity_for(header,row,allow_incomplete=migration or bool(target))
                if any(other_key!=key and identity_for(output_header,other_row,allow_incomplete=True)==new_identity for other_key,other_row,_ in existing):
                    raise ValueError('Perubahan identitas bertabrakan dengan posko lain.')
                if not migration:
                    record = approved['effective_payload']['records'][index]
                    source=record.get('storage_source')
                    if source and (source.get('mode')!='sqlite' or database_path(source.get('path'))!=database_path(path)):
                        raise ValueError('Database writer berbeda dari sumber yang ditinjau petugas.')
                    baseline = record.get('storage_baseline')
                    if baseline:
                        current = dict(zip(output_header,old)) if old else None
                        if current != baseline['row']:
                            raise ValueError('Rekap berubah sejak pratinjau. Baca ulang dan validasi kembali sebelum simpan.')
                    elif old and not target:
                        raise ValueError('Pembaruan belum dibandingkan dengan rekap SQLite. Validasi ulang kandidat.')
                version = matches[0][2]+1 if matches else 1
                if migration:
                    out = row
                    version = int(row[header.index('versi')] or 1) if 'versi' in header else 1
                else:
                    clear = payload.get('clear_columns',[[]]*len(rows))[index]
                    out = (merge(old,row,header,clear) if old else ['' if value is None else str(value) for value in row]) + [str(version),stamp]
                if old: updated += 1
                else: appended += 1
                db.execute('INSERT INTO shelters VALUES(?,?,?) ON CONFLICT(identity) DO UPDATE SET row_json=excluded.row_json,version=excluded.version',(key,json.dumps(out,ensure_ascii=False),version))
                db.execute('INSERT INTO shelter_history(identity,before_json,after_json,commit_key,saved_at) VALUES(?,?,?,?,?)',(key,json.dumps(old,ensure_ascii=False) if old else None,json.dumps(out,ensure_ascii=False),commit_key,stamp))
                existing = [item for item in existing if item[0]!=key]+[(key,out,version)]
            db.execute("INSERT INTO storage_meta VALUES('header',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(output_header),))
            result = {'path':str(database_path(path)),'count':len(rows),'appended':appended,'updated':updated,'replayed':False}
            db.execute('INSERT INTO storage_commits VALUES(?,?,?)',(commit_key,digest,json.dumps(result)))
            db.commit()
            return result
        except BaseException:
            db.rollback()
            raise


def compare_stored(records, stored):
    """Attach exact baseline row for optimistic concurrency and human field decisions."""
    if not stored['rows']:
        return records
    header = stored['header']
    columns = {'total_people':'jumlah_jiwa','male':'laki_laki','female':'perempuan','elderly':'lansia','disability':'disabilitas',
               'total_families':'jumlah_kk','infants_toddlers':'bayi_balita','children':'anak','pregnant':'ibu_hamil','breastfeeding':'ibu_menyusui',
               'urgent_needs':'kebutuhan_mendesak','surplus_do_not_send':'sudah_cukup','notes':'catatan','stock':'stok_json','stock_context':'konteks_stok_json','shelter_type':'jenis_pengungsian'}
    for record in records:
        target=record.get('update_target')
        if target:
            # Renames/village changes compare against the original bound row, not the new label.
            target_probe=[target.get({'posko':'shelter_name','desa':'village','id_laporan':'report_id'}.get(c,c)) for c in header]
            key=identity_for(header,target_probe,allow_incomplete=True)
        else:
            probe = [record.get({'posko':'shelter_name','desa':'village'}.get(c,c)) for c in header]
            try: key = identity_for(header,probe)
            except ValueError: continue
        matches = [row for row in stored['rows'] if identity_for(header,row,allow_incomplete=True)==key]
        if len(matches)>1: raise ValueError('Data tersimpan memiliki identitas posko ambigu.')
        baseline={'identity':key,'row':dict(zip(header,matches[0])) if matches else None}
        if record.get('storage_baseline') and record['storage_baseline']!=baseline:
            raise ValueError('Rekap tersimpan berubah sejak kandidat pertama. Baca ulang sebelum koreksi.')
        record['storage_baseline']=baseline
        record['validation_issues']=[i for i in record.get('validation_issues',[]) if i.get('field')!='storage_conflicts']
        if not matches: continue
        cells = dict(zip(header,matches[0]))
        old = {field:cells.get(column) for field,column in columns.items()}
        for field in list(columns)[:10]:
            value=old.get(field)
            old[field]=int(value) if value not in (None,'') else None
        for field in ('urgent_needs','surplus_do_not_send'):
            old[field]=[v.strip() for v in (old.get(field) or '').split(';') if v.strip()]
        for field in ('stock','stock_context'):
            old[field]=json.loads(old.get(field) or '{}')
        old['reported_at']=cells.get('waktu_laporan')
        old['field_provenance']=json.loads(cells.get('provenance_json') or '{}')
        conflicts = []
        for field,column in columns.items():
            before,after = old.get(field),record.get(field)
            if field in ('stock','stock_context') and isinstance(after,dict):
                active={k:v for k,v in after.items() if v not in (None,'',{})}
                different=any(before.get(k) is not None and before.get(k)!=v for k,v in active.items()) if isinstance(before,dict) else False
            elif field in ('urgent_needs','surplus_do_not_send'):
                item_text=lambda items:[(v.get('item','')+(f" ({v['qty']} {v.get('unit') or ''})".rstrip() if v.get('qty') else '')) if isinstance(v,dict) else str(v) for v in (items or [])]
                different=item_text(before)!=item_text(after)
            else:different=before!=after
            if before not in (None,'',[],{}) and after not in (None,'',[],{}) and different:
                conflicts.append({'field':field,'previous_value':before,'incoming_value':after,'previous_reported_at':old.get('reported_at'),'incoming_reported_at':record.get('reported_at'),'previous_provenance':old.get('field_provenance',{}).get(field),'incoming_provenance':record.get('field_provenance',{}).get(field)})
        record['storage_conflicts']=conflicts
        if conflicts:
            record.setdefault('validation_issues',[]).append({'field':'storage_conflicts','reason':'Nilai berbeda dengan rekap tersimpan; petugas wajib memilih nilai lama atau baru sebelum simpan.'})
    return records


def resolve_storage_conflicts(records, decisions):
    expected = {r['report_id']:{c['field'] for c in r.get('storage_conflicts',[])} for r in records}
    if not isinstance(decisions,dict) or any(not isinstance(values,dict) or set(values)-expected.get(report,set()) for report,values in decisions.items()):
        raise ValueError('Keputusan konflik mengacu field yang tidak ada pada pratinjau.')
    for record in records:
        for conflict in record.get('storage_conflicts',[]):
            field = conflict['field']
            choice = decisions.get(record['report_id'],{}).get(field)
            if choice not in ('keep','incoming'):
                raise ValueError(f'Putuskan konflik {record["report_id"]} {field}: keep atau incoming.')
            if choice=='keep':
                record[field]=conflict['previous_value']
                if conflict.get('previous_provenance'):
                    record.setdefault('field_provenance',{})[field]=conflict['previous_provenance']
                else:
                    record.setdefault('field_provenance',{}).pop(field,None)
            record.setdefault('corrections',[]).append({**conflict,'action':choice,'value':record.get(field)})
        record['storage_conflicts']=[]
        record['validation_issues']=[i for i in record.get('validation_issues',[]) if i.get('field')!='storage_conflicts']
        if all(isinstance(record.get(k),int) for k in ('total_people','male','female')) and record['male']+record['female']!=record['total_people']:
            # Existing partial snapshots may already contain this issue. Conflict decisions must not create it anew.
            if expected.get(record['report_id']):
                raise ValueError('Pilihan konflik menghasilkan laki-laki + perempuan berbeda dengan jumlah jiwa. Periksa pilihan atau klarifikasi dulu.')
    return records
