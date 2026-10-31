import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportTime} from '../src/StaleReports.tsx';
import {storedRows} from '../src/backendPreview.ts';

test('report age uses actual report time, WIB for local timestamps and rejects invalid dates',()=>{
 assert.equal(reportTime('2026-10-29 12:30'),Date.parse('2026-10-29T05:30:00Z'));
 assert.equal(reportTime('2026-10-29T12:30:00Z'),Date.parse('2026-10-29T12:30:00Z'));
 for(const invalid of [null,'2026-02-30 12:00','2026-10-29','waktu belum diketahui'])assert.equal(reportTime(invalid),null);
 const [without,withReport]=storedRows([{shelter_name:'A',updated_at:'2026-10-01 08:00'},{shelter_name:'B',reported_at:'2026-10-02 09:00',updated_at:'2026-10-30 08:00'}]);
 assert.equal(without.lastReportedAt,null);assert.equal(withReport.lastReportedAt,'2026-10-02 09:00');
});
