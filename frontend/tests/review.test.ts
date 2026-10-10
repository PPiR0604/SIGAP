import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReportFile, approveDemoReview} from '../src/review.ts';

test('rejects a changed candidate even when a previous version was approved', () => {
  assert.throws(() => approveDemoReview({version:2, reviewedVersion:1, confirmed:true, partial:true, clearDecision:'keep'}), /berubah/);
});
test('requires explicit acceptance of unresolved partial data', () => {
  assert.throws(() => approveDemoReview({version:1, reviewedVersion:1, confirmed:true, partial:false, clearDecision:'keep'}), /parsial/);
});
test('requires a clear decision and explicit confirmation', () => {
  assert.throws(() => approveDemoReview({version:1, reviewedVersion:1, confirmed:true, partial:true, clearDecision:''}), /pengosongan/);
  assert.throws(() => approveDemoReview({version:1, reviewedVersion:1, confirmed:false, partial:true, clearDecision:'defer'}), /persetujuan/);
});
test('valid review records a demo decision without claiming storage verification', () => {
  const result = approveDemoReview({version:1, reviewedVersion:1, confirmed:true, partial:true, clearDecision:'keep'});
  assert.equal(result.storageVerified, false);
  assert.equal(result.mode, 'demo');
});
test('rejects unsupported and oversized uploads', () => {
  assert.throws(() => validateReportFile('laporan.pdf',100), /\.txt/);
  assert.throws(() => validateReportFile('laporan.txt',205000), /200 KiB/);
  assert.doesNotThrow(() => validateReportFile('laporan.TXT',204800));
});
