"""Regression for multi-message report cards and source-bound validation."""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'langflow/lib'))
from sigap_preprocess import parse_reports, preprocess


def card(package, task):
    text = (ROOT / f'data/synthetic/comparison-paper-sigap/PAKET-{package}.md').read_text(encoding='utf8')
    section = re.search(r'^## ' + task + r'[^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)[1].strip()
    return 'Tanggal acuan seluruh laporan: 10 November 2026, WIB.\n\n' + section


class ReportCardsTests(unittest.TestCase):
    def test_update_keeps_explicit_earlier_stock_clock_in_the_same_report_day(self):
        from shelter_report_validator import validate
        source = preprocess(card('B', 'T02'))[0]
        for stamp, valid in [('2026-11-10 08:00',True),('2026-11-10 08:01',False),('2026-11-09 08:00',False)]:
            with self.subTest(stamp=stamp):
                record = {'report_id':'R001','shelter_name':'Sejahtera','village':'Karangmulya','total_people':52,
                          'stock':{'air_liter_per_hari':360},'stock_context':{'air_liter_per_hari':{'unit':'L','recorded_at':stamp,'horizon_hours':24}}}
                result = validate(json.dumps({'records':[record]}), source)['records'][0]
                self.assertEqual(result['reported_at'],'2026-11-10 08:20')
                self.assertEqual(result['stock_context']['air_liter_per_hari'].get('recorded_at'),stamp if valid else None)
        source = source.replace('hasil cek jam', 'hasil cek kemarin jam')
        record['stock_context']['air_liter_per_hari']['recorded_at'] = '2026-11-10 08:00'
        result = validate(json.dumps({'records':[record]}),source)['records'][0]
        self.assertIsNone(result['stock_context']['air_liter_per_hari'].get('recorded_at'))

    def test_local_exports_embed_compilable_current_preprocessor_and_validator(self):
        sys.path.insert(0, str(ROOT / 'langflow/scripts'))
        from sync_storage_flows import embedded
        for flow_name in ('prepare_needs', 'validate_needs'):
            flow = json.loads((ROOT / f'langflow/flows/{flow_name}.json').read_text(encoding='utf8'))
            for node in flow['data']['nodes']:
                config = node['data']['node']
                module = {'Posko Report Preprocessor':'posko_report_preprocessor',
                          'Shelter Report Validator':'shelter_report_validator'}.get(config.get('display_name'))
                if module:
                    code = config['template']['code']['value']
                    self.assertEqual(code, embedded(module))
                    compile(code, module + '.py', 'exec')

    def test_both_packages_keep_three_distinct_source_reports(self):
        for package in ('A', 'B'):
            with self.subTest(package=package):
                reports = parse_reports(card(package, 'T01'))
                self.assertEqual([r['report_id'] for r in reports], ['R001', 'R002', 'R003'])
                self.assertEqual([r['timestamp'] for r in reports],
                                 ['2026-11-10 08:00', '2026-11-10 08:02', '2026-11-10 08:04'])
        reports = parse_reports(card('B', 'T01'))
        for report, village in zip(reports, ('Karangmulya', 'Cibening', 'Mekarsari')):
            self.assertIn(village, report['text'])
            for other in {'Karangmulya', 'Cibening', 'Mekarsari'} - {village}:
                self.assertNotIn(other, report['text'])

    def test_forwarded_message_has_own_id_and_original_time(self):
        reports = parse_reports(card('B', 'T03'))
        self.assertEqual(len(reports), 2)
        self.assertEqual([r['timestamp'] for r in reports], ['2026-11-10 08:30', '2026-11-10 08:02'])
        self.assertIn('diteruskan ulang', reports[1]['text'])
        self.assertNotIn('Cibening', reports[0]['text'])

    def test_plain_and_markdown_headers_preserve_paragraphs_and_source_evidence(self):
        text = card('B', 'T01').replace('**', '').replace('—', '-')
        reports = parse_reports(text.replace('\n', '\r\n'))
        self.assertEqual(len(reports), 3)
        self.assertIn('Stok air bersih dicek jam 08.00', reports[0]['text'])
        self.assertIn('Tanggal acuan', reports[0]['text'])
        self.assertIn('08.00 - Petugas', reports[0]['text'])

    def test_unknown_invalid_and_ambiguous_dates_are_not_invented(self):
        text = card('B', 'T01')
        for modified in (text.split('\n\n', 1)[1], text.replace('10 November', '31 November'),
                         'Tanggal acuan: 11 November 2026, WIB.\n' + text):
            with self.subTest(prefix=modified[:80]):
                reports = parse_reports(modified)
                self.assertEqual(len(reports), 3)
                self.assertTrue(all(r['timestamp'] is None for r in reports))

    def test_inline_measurements_and_single_blank_lines_do_not_split_messages(self):
        raw = 'Posko Uji 10 jiwa.\n\nStok dicek jam 08.00 - air 0 liter.\n\nButuh air.'
        self.assertEqual(len(parse_reports(raw)), 1)

    def test_unrecognized_preamble_is_not_silently_lost(self):
        raw = 'Posko Awal 12 jiwa.\n\n' + card('B', 'T01')
        reports = parse_reports(raw)
        self.assertEqual(len(reports), 4)
        self.assertIn('Posko Awal 12 jiwa.', reports[0]['text'])
        self.assertNotIn('Karangmulya', reports[0]['text'])
        self.assertIn('Karangmulya', reports[1]['text'])
        self.assertNotIn('Cibening', reports[1]['text'])

    def test_extra_preamble_does_not_merge_card_ids_or_invent_reference_date(self):
        body = ('18.00 — Petugas Posko Uji Sejahtera\nPosko Uji Sejahtera, Desa Uji Utara. Jumlah jiwa: 10.\n\n'
                '18.02 — Petugas Posko Uji Sejahtera\nPosko Uji Sejahtera, Desa Uji Selatan. Jumlah jiwa: 12.')
        for prefix, expected_time in (
            ('Tanggal acuan: 13 November 2026. Data sintetis diagnostik.', None),
            ('Tanggal acuan: 13 November 2026.\nData sintetis diagnostik.', '2026-11-13 18:00'),
        ):
            with self.subTest(prefix=prefix):
                reports = parse_reports(prefix + '\n\n' + body)
                self.assertEqual([r['report_id'] for r in reports], ['R001', 'R002', 'R003'])
                self.assertEqual(reports[0]['text'], prefix)
                self.assertEqual(reports[1]['timestamp'], expected_time)
                self.assertIn('Uji Utara', reports[1]['text'])
                self.assertNotIn('Uji Selatan', reports[1]['text'])
                self.assertIn('Uji Selatan', reports[2]['text'])

    def test_whatsapp_and_plain_separator_formats_still_work(self):
        reports = parse_reports('10/11/2026 08.00 - Petugas: Posko A 10 jiwa.\nBaris lanjutan.\n10/11/2026 08.02 - Petugas: Posko B 12 jiwa.')
        self.assertEqual([r['timestamp'] for r in reports], ['2026-11-10 08:00', '2026-11-10 08:02'])
        self.assertIn('Baris lanjutan.', reports[0]['text'])
        self.assertEqual(len(parse_reports('Posko A 10 jiwa.\n---\nPosko B 12 jiwa.')), 2)
        self.assertEqual(len(parse_reports('Posko A 10 jiwa.\n\n\nPosko B 12 jiwa.')), 2)

    def test_redaction_still_runs_before_source_is_published(self):
        text, reports, _ = preprocess(card('B', 'T01') + '\nKontak 081234567890.')
        self.assertEqual(len(reports), 3)
        self.assertNotIn('081234567890', text)
        self.assertIn('[NO_HP]', text)


if __name__ == '__main__':
    unittest.main()
