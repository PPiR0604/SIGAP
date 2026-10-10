import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageLabel, isReportStage } from '../src/stageLabels.ts';

test('stage labels are friendly and only report tools count as the report flow', () => {
  assert.equal(stageLabel('tool:sigap_0_fetch_shelters'), 'Membaca rekap tersimpan');
  assert.equal(stageLabel('prepare_needs'), 'Mengekstrak data dari laporan');
  assert.equal(stageLabel('tool:tidak_dikenal'), '');
  assert.equal(isReportStage('tool:sigap_1_prepare_needs'), true);
  assert.equal(isReportStage('tool:sigap_0_fetch_shelters'), false);
  assert.equal(stageLabel('waiting_quota'), 'Menunggu kuota token per menit');
  assert.equal(isReportStage(undefined), false);
});
