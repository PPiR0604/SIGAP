import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storedRows} from '../src/backendPreview.ts';
import {applyCalculations,metricValue,recapCsv} from '../src/needs.ts';

test('all four server needs and shortages attach even when village is unknown',()=>{
  const rows=storedRows([{report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98,urgent_needs:['popok','obat']}]);
  const calculated=applyCalculations(rows,{shelters:[{shelter_name:'Posko Harapan',village:'',needs:{air_liter_per_hari:{value:1470},kkal_per_hari:{value:205800},jamban_unit:{value:5},ruang_hunian_m2:{value:343}},gaps:{air_liter_per_hari:0,jamban_unit:2}}]});
  assert.equal(metricValue(calculated[0],'kkal_per_hari'),205800);
  assert.equal(metricValue(calculated[0],'jamban_unit'),5);
  assert.equal(metricValue(calculated[0],'ruang_hunian_m2'),343);
  assert.equal(metricValue(calculated[0],'air_liter_per_hari',true),0);
  assert.equal(metricValue(calculated[0],'kkal_per_hari',true),null);
  assert.deepEqual(calculated[0].needs,['popok','obat']);
});

test('needs CSV includes reported items and the selected non-water metric without inventing stock gaps',()=>{
  const rows=storedRows([{shelter_name:'Posko A',total_people:10,urgent_needs:['beras, minyak','obat']}]);
  const data=applyCalculations(rows,{shelters:[{shelter_name:'Posko A',needs:{kkal_per_hari:{value:21000}},gaps:{}}]});
  const csv=recapCsv(data,'kkal_per_hari');
  assert.match(csv,/Kebutuhan dilaporkan/);
  assert.match(csv,/Pangan.*kkal/);
  assert.ok(csv.includes('"beras, minyak; obat"'));
  assert.ok(csv.includes('21000,Belum diketahui'));
});
