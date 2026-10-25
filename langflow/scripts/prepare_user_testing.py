"""Generate synthetic participant materials and seed a NEW, isolated Langflow SQLite database."""
import argparse
import ast
import csv
import hashlib
import json
import math
import sqlite3
import sys
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'langflow' / 'lib'))
from sigap_sqlite import read_sqlite, write_sqlite

REQUIRED = ['shelter_name', 'village', 'total_people', 'male', 'female', 'infants_toddlers', 'elderly', 'pregnant', 'breastfeeding', 'disability']
NUMERIC = ['total_people', 'total_families', 'male', 'female', 'infants_toddlers', 'children', 'elderly', 'pregnant', 'breastfeeding', 'disability']


def baseline(day):
    date.fromisoformat(day)
    definitions = [
        ('Posko Cibening', 'Cibineng', 100, 55, 45, 7, 0, ['air bersih', 'beras', 'minyak goreng'], 500, 24),
        ('Posko Harapan', 'Sukamaju', 98, 43, 55, 12, None, ['air bersih', 'popok'], 1000, 24),
        ('Posko Teduh', 'Mekarsari', 80, 38, 42, 5, 0, ['perlengkapan kebersihan'], 1500, 24),
        ('Posko Melati', 'Cisarua', 63, None, None, None, None, ['selimut', 'makanan bayi'], None, None),
        ('Posko Nusa', 'Sukamaju', 120, 59, 61, 8, 1, ['air bersih', 'obat-obatan'], 2000, 48),
        ('Posko Pelita', 'Cipandan', 54, 26, 28, 4, 0, ['air bersih', 'makanan siap saji'], 0, 24),
        ('Posko Harapan', 'Cipandan', 40, 19, 21, 3, 0, ['selimut'], 100, 24),
        ('Posko Mandiri', 'Cibineng', 75, 36, 39, 6, 0, ['perlengkapan kebersihan'], 1125, 24),
    ]
    records = []
    for index, (name, village, people, male, female, elderly, disability, needs, water, horizon) in enumerate(definitions, 1):
        rid = f'R{index:03d}'
        stamp = f'{day}T00:00'
        record = dict(disaster_id='', shelter_id='', batch_id=f'user-validation-{day}', report_id=rid,
                      reported_at=stamp, shelter_name=name, village=village, shelter_type='terkonsentrasi',
                      total_people=people, total_families=None if male is None else math.ceil(people/4),
                      male=male, female=female, infants_toddlers=None if male is None else 4,
                      children=None if male is None else 10, elderly=elderly, pregnant=None if male is None else 1,
                      breastfeeding=None if male is None else 2, disability=disability, urgent_needs=needs,
                      surplus_do_not_send=['air bersih'] if name=='Posko Teduh' else [],
                      notes='DATA SINTETIS — khusus uji pengguna SIGAP; bukan laporan kejadian nyata.',
                      stock={} if water is None else {'air_liter_per_hari': water},
                      stock_context={} if water is None else {'air_liter_per_hari': {'unit':'L', 'recorded_at':stamp, 'horizon_hours':horizon}},
                      source_report_ids=[rid], validation_issues=[], unverified_numbers=[], stock_issues=[],
                      notes_history=[], corrections=[], pending_clear_fields=[], is_estimate=male is None)
        record['missing_fields'] = [key for key in REQUIRED if record[key] is None]
        record['validation_status'] = 'PARSIAL' if record['missing_fields'] else 'LOLOS_PEMERIKSAAN'
        record['field_provenance'] = {key: {'report_id':rid, 'reported_at':stamp, 'source_excerpt':f'Data sintetis uji pengguna, {name}, Desa {village}: {key} = {record[key]}.'} for key in NUMERIC if record[key] is not None}
        records.append(record)
    return {'synthetic':True, 'purpose':'Uji pengguna SIGAP, bukan data bencana nyata', 'fixture_version':1, 'scenario_date':day, 'records':records}


def expected_results(fixture):
    records=[]
    for record in fixture['records']:
        people=record['total_people']
        stock=record['stock'].get('air_liter_per_hari')
        horizon=record['stock_context'].get('air_liter_per_hari',{}).get('horizon_hours')
        records.append({key:record[key] for key in ('report_id','shelter_name','village','total_people')} | {
            'air_liter_per_hari':people*15, 'kkal_per_hari':people*2100, 'jamban_unit':math.ceil(people/20),
            'ruang_hunian_m2':people*3.5, 'gap_air_liter_per_hari':max(0,people*15-stock) if stock is not None and horizon==24 else None,
            'is_estimate':record['is_estimate'], 'missing_fields':record['missing_fields']})
    return {'synthetic':True,'baseline':{'shelters':len(records),'total_people':sum(r['total_people'] for r in records),
            'air_liter_per_hari':sum(r['air_liter_per_hari'] for r in records),'kkal_per_hari':sum(r['kkal_per_hari'] for r in records)},
            'records':records,'after_new_csv':{'shelters':10,'total_people':744},
            'participant_task_order':{'after_task_3_incoming':{'shelters':8,'total_people':638},'after_task_4_csv':{'shelters':10,'total_people':752},'after_task_5_both_incoming':{'shelters':10,'total_people':760},'after_task_5_both_keep':{'shelters':10,'total_people':752}},
            'after_harapan_population_correction':{'total_people':102,'male':47,'female':55,'air_liter_per_hari':1530},
            'after_cibening_population_correction':{'total_people':104,'male':57,'female':47,'air_liter_per_hari':1560}}


def write_csv(path, header, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer=csv.writer(stream);writer.writerow(header);writer.writerows(rows)


def generate_pack(directory, day):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    fixture=baseline(day)
    (directory/'baseline.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (directory/'expected-results.json').write_text(json.dumps(expected_results(fixture),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=[]
    labels={'total_people':'Total','male':'Laki-laki','female':'Perempuan','infants_toddlers':'Bayi/balita','children':'Anak','elderly':'Lansia','pregnant':'Ibu hamil','breastfeeding':'Ibu menyusui','disability':'Disabilitas'}
    day_label=date.fromisoformat(day).strftime('%d/%m/%y')
    for record in fixture['records']:
        counts='; '.join(f'{label}: {record[key]}' for key,label in labels.items() if record[key] is not None)
        water=record['stock'].get('air_liter_per_hari')
        stock=f" Stok air bersih: {water} L untuk {record['stock_context']['air_liter_per_hari']['horizon_hours']} jam, dicatat saat laporan ini." if water is not None else ' Stok belum dilaporkan.'
        lines.append(f"{day_label} {record['reported_at'][11:]} - Relawan Simulasi: {record['shelter_name']}, Desa {record['village']}. {counts}. {'Jumlah merupakan estimasi. ' if record['is_estimate'] else ''}Butuh {', '.join(record['urgent_needs'])}.{stock} Data sintetis untuk uji pengguna.")
    (directory/'01-laporan-awal-whatsapp.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    (directory/'02-koreksi-bergantian.txt').write_text(
        'DATA SINTETIS. Lakukan melalui detail posko agar target terikat otomatis.\n\n'
        'A. Posko Harapan, Desa Sukamaju: jumlah jiwa 102; laki-laki 47; perempuan 55; disabilitas 2.\n'
        'B. Tanpa menyimpan A dahulu, buka Posko Cibening, Desa Cibineng: jumlah jiwa 104; laki-laki 57; perempuan 47; lansia 9.\n'
        'C. Buka kembali Harapan Sukamaju: pastikan 102/47/55 tetap ada. Ubah lansia menjadi 14.\n'
        'D. Tinjau pilihan nilai lama/baru lalu setujui tiap kandidat secara terpisah. Cibening harus tetap 104/57/47/9.\n'
        'E. Harapan di Cipandan harus tetap 40 jiwa. Kebutuhan posko lain tidak boleh hilang.\n',encoding='utf-8')
    header=['posko','desa','jumlah_jiwa','laki_laki','perempuan','lansia','disabilitas','kebutuhan_mendesak','waktu_laporan','catatan']
    write_csv(directory/'03-impor-posko-baru.csv',header,[['Posko Anggrek','Sukajaya',50,24,26,4,0,'air bersih; selimut',f'{day} 00:10','DATA SINTETIS'],['Posko Kenanga','Cipandan',64,30,34,5,1,'beras; popok',f'{day} 00:12','DATA SINTETIS']])
    # Target shelters not touched by the earlier correction task; avoid backdating its updates.
    write_csv(directory/'04-impor-konflik.csv',header,[['Posko Teduh','Mekarsari',84,40,44,5,0,'perlengkapan kebersihan',f'{day} 00:20','DATA SINTETIS - pilih nilai lama atau baru'],['Posko Harapan','Cipandan',44,21,23,3,0,'selimut',f'{day} 00:25','DATA SINTETIS - Harapan di Cipandan, bukan Sukamaju']])
    (directory/'05-laporan-bermasalah.txt').write_text(f'{day_label} 00:30 - Relawan Simulasi: Posko Uji Konflik, Desa Uji. Total 70 jiwa; laki-laki 35; perempuan 40. Butuh air bersih. Data sintetis.\n',encoding='utf-8')
    (directory/'06-perintah-cek.txt').write_text('Tolong baca rekap posko yang sudah tersimpan dan ringkas jumlah posko serta total jiwanya.\n\nPeriksa kebutuhan di semua desa, termasuk kandidat yang belum disimpan.\n\nPosko mana yang kekurangan air bersih? Tampilkan angka dan dasar perhitungannya. Jangan menebak stok yang belum lengkap.\n\nTolong susun draf buletin donatur dalam Markdown dari rekap tersimpan. Hanya pratinjau, jangan dipublikasikan.\n',encoding='utf-8')
    write_csv(directory/'template-feedback.csv',['kode_peserta','tanggal','skenario','hasil_berhasil_sebagian_gagal','durasi_detik','bantuan_diperlukan','kemudahan_1_5','kejelasan_1_5','manfaat_1_5','masalah_ditemukan','saran','path_bukti','izin_kutip_ya_tidak'],[[f'U{i:02d}','','','','','','','','','','','',''] for i in range(1,4)])
    return fixture


def storage_payload(fixture):
    tree=ast.parse((ROOT/'langflow/components/officer_confirmation_gate.py').read_text(encoding='utf-8'))
    values={name:ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) for target in node.targets if (name:=getattr(target,'id','')) in ('SHEET_COLUMNS','JSON_FIELDS')}
    columns=values['SHEET_COLUMNS'];json_fields=values['JSON_FIELDS']
    header=[label for _,label in columns]+['status','dicatat_pada','catatan_petugas','versi','disimpan_di']
    def cell(key,value):
        if key in json_fields:return json.dumps(value,ensure_ascii=False,sort_keys=True)
        if value is None:return ''
        if isinstance(value,bool):return json.dumps(value)
        if isinstance(value,list):return '; '.join(value)
        return str(value)
    rows=[[cell(key,r.get(key,{} if key in ('stock','stock_context','field_provenance') else [])) for key,_ in columns]+['DATA SINTETIS UNTUK UJI',r['reported_at'],'Seed administratif uji pengguna', '1',r['reported_at']] for r in fixture['records']]
    return {'header':header,'rows':rows}


def seed_database(fixture_path, destination, backup_from=None, apply=False):
    fixture_path=Path(fixture_path);fixture=json.loads(fixture_path.read_text(encoding='utf-8'))
    if fixture.get('synthetic') is not True or not fixture.get('records'):raise ValueError('Seed harus memuat data sintetis eksplisit.')
    location=Path(destination).resolve()
    if location.exists():raise ValueError('Database tujuan sudah ada. Gunakan direktori uji baru; data tidak ditimpa.')
    if backup_from and location==Path(backup_from).resolve():raise ValueError('Database uji harus terpisah dari sumber lama.')
    summary={'synthetic':True,'rows':len(fixture['records']),'total_people':sum(r['total_people'] for r in fixture['records']),
             'database':str(location),'baseline_sha256':hashlib.sha256(fixture_path.read_bytes()).hexdigest(),'applied':False}
    if not apply:return summary
    payload=storage_payload(fixture)
    location.parent.mkdir(parents=True,exist_ok=True)
    if backup_from:
        source=Path(backup_from).resolve()
        backup=location.parent/'previous-database.sqlite3'
        if backup.exists():raise ValueError('Cadangan sebelumnya sudah ada; gunakan direktori uji baru.')
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as old, closing(sqlite3.connect(backup)) as target:
            old.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Cadangan gagal pemeriksaan integritas.')
        summary['backup']=str(backup);summary['previous_database']=str(source)
    write_sqlite(payload,location,lambda *_:False,lambda *_:None,migration=True)
    checked=read_sqlite(location)
    if checked['rows']!=payload['rows']:raise RuntimeError('Seed gagal verifikasi read-back.')
    with closing(sqlite3.connect(location)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Database uji gagal pemeriksaan integritas.')
    summary['applied']=True
    (location.parent/'seed-manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date',default=datetime.now(timezone(timedelta(hours=7))).date().isoformat())
    parser.add_argument('--pack',default=str(ROOT/'data/synthetic/user-validation'))
    parser.add_argument('--database')
    parser.add_argument('--backup-from')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    generate_pack(args.pack,args.date)
    print(json.dumps(seed_database(Path(args.pack)/'baseline.json',args.database,args.backup_from,args.apply) if args.database else {'pack':str(Path(args.pack).resolve()),'synthetic':True,'rows':8},ensure_ascii=False,indent=2))
