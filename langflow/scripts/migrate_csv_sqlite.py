"""Explicit, atomic migration of an existing canonical SIGAP CSV. Original file is preserved."""
import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
from sigap_sqlite import identity_for, read_sqlite, write_sqlite


def migrate(source,destination,apply=False):
    raw=Path(source).read_bytes()
    with Path(source).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream)
        header=next(reader,[])
        rows=[row for row in reader if any(row)]
    if not {'posko','desa'}.issubset(header) or len(set(header))!=len(header):
        raise ValueError('Migrasi membutuhkan CSV rekap kanonis dengan judul unik, posko dan desa.')
    keys=[]
    counts={'jumlah_jiwa','jumlah_kk','laki_laki','perempuan','bayi_balita','anak','lansia','ibu_hamil','ibu_menyusui','disabilitas'}
    for row in rows:
        if len(row)!=len(header):raise ValueError('Jumlah kolom CSV tidak sesuai schema.')
        keys.append(identity_for(header,row,allow_incomplete=True))
        for col,value in zip(header,row):
            if col in counts and value and (not value.isdigit() or int(value)<0):raise ValueError('Jumlah pengungsi pada CSV tidak valid.')
    if len(set(keys))!=len(keys):raise ValueError('CSV memiliki posko duplikat/ambigu; selesaikan dahulu.')
    for column,default in (('versi','1'),('disimpan_di','')):
        if column not in header:
            header.append(column)
            rows=[row+[default] for row in rows]
    summary={'source_sha256':hashlib.sha256(raw).hexdigest(),'rows':len(rows),'destination':str(Path(destination).resolve()),'applied':False}
    if not rows:raise ValueError('CSV kosong.')
    if apply:
        result=write_sqlite({'header':header,'rows':rows},destination,lambda *_:False,lambda *_:None,migration=True)
        if read_sqlite(destination)['rows']!=rows:raise RuntimeError('Verifikasi migrasi gagal.')
        summary.update(applied=True,replayed=result['replayed'])
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv',required=True)
    parser.add_argument('--database',required=True)
    parser.add_argument('--apply',action='store_true',help='Tanpa flag ini hanya validasi/pratinjau, tanpa menulis database.')
    args=parser.parse_args()
    print(json.dumps(migrate(args.csv,args.database,args.apply),ensure_ascii=False,indent=2))
