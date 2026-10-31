import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'langflow/scripts'))
from prepare_user_testing import baseline,expected_results,generate_pack,seed_database,storage_payload
from sigap_sqlite import read_sqlite


class UserTestingTests(unittest.TestCase):
    def test_registration_seed_matches_participant_baseline(self):
        fixture=json.loads((ROOT/'data/synthetic/user-validation/baseline.json').read_text(encoding='utf-8'))
        sql=(ROOT/'backend/supabase/test-registration.sql').read_text(encoding='utf-8')
        payload=json.loads(sql.split('$fixture$',2)[1])
        self.assertTrue(fixture['synthetic'])
        self.assertEqual(payload,storage_payload(fixture))
        self.assertEqual(sum(r['total_people'] for r in fixture['records']),630)

    def test_fixture_identity_totals_and_unknown_vs_zero(self):
        fixture=baseline('2026-10-25');rows=fixture['records'];expected=expected_results(fixture)
        self.assertEqual(len(rows),8)
        self.assertEqual(expected['baseline']['total_people'],630)
        self.assertEqual(expected['baseline']['air_liter_per_hari'],9450)
        self.assertEqual(expected['baseline']['kkal_per_hari'],1323000)
        self.assertEqual(len({(r['shelter_name'],r['village']) for r in rows}),8)
        self.assertEqual(len([r for r in rows if r['shelter_name']=='Posko Harapan']),2)
        self.assertEqual(len([r for r in rows if r['village']=='Cibineng']),2)
        self.assertEqual(expected['records'][5]['gap_air_liter_per_hari'],810)
        self.assertIsNone(expected['records'][4]['gap_air_liter_per_hari'])
        self.assertIsNone(rows[3]['male']);self.assertEqual(rows[0]['disability'],0)
        for row in rows:
            if row['male'] is not None:self.assertEqual(row['male']+row['female'],row['total_people'])

    def test_seed_backups_preserves_source_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'output/testing') as folder:
            folder=Path(folder);generate_pack(folder/'pack','2026-10-25')
            source=folder/'old.sqlite3'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE example(value)');db.execute("INSERT INTO example VALUES ('preserve')");db.commit()
            before=source.read_bytes();dest=folder/'run'/'rekap.sqlite3'
            dry=seed_database(folder/'pack/baseline.json',dest,source)
            self.assertFalse(dry['applied']);self.assertFalse(dest.exists())
            result=seed_database(folder/'pack/baseline.json',dest,source,True)
            self.assertTrue(result['applied']);self.assertEqual(read_sqlite(dest)['count'],8)
            self.assertEqual(source.read_bytes(),before)
            with closing(sqlite3.connect(result['backup'])) as db:self.assertEqual(db.execute('SELECT value FROM example').fetchone()[0],'preserve')
            with self.assertRaisesRegex(ValueError,'sudah ada'):seed_database(folder/'pack/baseline.json',dest,source,True)
            self.assertEqual(read_sqlite(dest)['count'],8)

    def test_seed_requires_explicit_synthetic_fixture(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'output/testing') as folder:
            folder=Path(folder);fixture=folder/'input.json';fixture.write_text(json.dumps({'records':[{'total_people':1}]}))
            with self.assertRaisesRegex(ValueError,'sintetis'):seed_database(fixture,folder/'bad.sqlite3',apply=True)
            self.assertFalse((folder/'bad.sqlite3').exists())


if __name__=='__main__':unittest.main()
