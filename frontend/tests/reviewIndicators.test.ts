import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewIndicators} from '../src/reviewIndicators.ts';
import {storedRows,previewRows,mergeCandidateOntoStored} from '../src/backendPreview.ts';

test('stored partial data explains missing fields, stock periods and invalid stock metadata',()=>{
  const record={shelter_name:'Nusa Sukamaju',village:'',total_people:120,male:59,female:61,total_families:null,children:null,disability:null,missing_fields:['village','infants_toddlers','pregnant','breastfeeding','disability'],stock:{air_liter_per_hari:2000},stock_context:{air_liter_per_hari:{recorded_at:'2026-10-02 08:25',horizon_hours:48}},stock_issues:['Key stok tidak dikenal: kkal_per_horizontal.']};
  const row=storedRows([record])[0];
  assert.equal(row.status,'Perlu klarifikasi');
  assert.ok(row.reviewItems?.some(i=>i.text==='Desa belum dilaporkan.'));
  assert.ok(row.reviewItems?.some(i=>i.text==='Jumlah KK belum dilaporkan.'));
  assert.ok(row.reviewItems?.some(i=>i.text.includes('48 jam')));
  assert.ok(row.reviewItems?.some(i=>i.kind==='clarification'&&i.text.includes('jenis stok yang belum dikenali')));
});
test('known zeros and an explicit empty needs list have distinct meanings',()=>{
  const items=reviewIndicators({shelter_name:'A',village:'Desa A',total_people:0,male:0,female:0,elderly:0,disability:0,urgent_needs:[],stock:{air_liter_per_hari:0,jamban_unit:0,kkal_per_hari:0,ruang_hunian_m2:0},stock_context:{air_liter_per_hari:{recorded_at:'2026-10-22',horizon_hours:24},kkal_per_hari:{recorded_at:'2026-10-22',horizon_hours:24},jamban_unit:{recorded_at:'2026-10-22'},ruang_hunian_m2:{recorded_at:'2026-10-22'}}});
  assert.deepEqual(items,[{kind:'missing',field:'urgent_needs',text:'Kebutuhan posko belum dilaporkan.'}]);
});
test('correction removes resolved mismatch and preserves missing fields and unrelated villages',()=>{
  const base=storedRows([{batch_id:'old',report_id:'R002',shelter_name:'A',village:'',total_people:98,male:45,female:55,disability:null},{shelter_name:'B',village:'Desa B',total_people:10,missing_fields:['elderly']}]);
  const next=mergeCandidateOntoStored(base,previewRows({records:[{batch_id:'new',report_id:'R001',shelter_name:'A',village:'',total_people:98,male:43,female:55,disability:null,missing_fields:['village','disability'],update_target:{batch_id:'old',report_id:'R002'},storage_conflicts:[{field:'male',previous_value:45,incoming_value:43}]}]}));
  assert.ok(base[0].reviewItems?.some(i=>i.field==='male+female'));
  assert.equal(next[0].reviewItems?.some(i=>i.field==='male+female'),false);
  assert.ok(next[0].reviewItems?.some(i=>i.kind==='decision'&&i.field==='male'));
  assert.ok(next[0].reviewItems?.some(i=>i.kind==='missing'&&i.field==='disability'));
  assert.deepEqual(next[1].reviewItems,base[1].reviewItems);
});
