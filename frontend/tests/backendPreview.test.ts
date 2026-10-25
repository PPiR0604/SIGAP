import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewRows, storedRows, mergeCandidateOntoStored, retainUnchangedCalculations, pendingClearFields,matchesClarificationTarget } from '../src/backendPreview.ts';
import { applyCalculations,metricValue } from '../src/needs.ts';

test('server candidate controls displayed IDs, unknown values and pending decisions', () => {
  const candidate = { records: [{ report_id: 'R777', shelter_name: 'Posko Baru', village: 'Desa A', total_people: 0, male: null, pending_clear_fields: ['disability', 'notes'] }] };
  const rows = previewRows(candidate);
  assert.equal(rows[0].id, 'R777');
  assert.equal(rows[0].people, 0);
  assert.equal(rows[0].male, null);
  assert.equal(rows[0].water, null);
  assert.deepEqual(pendingClearFields(candidate), [{ reportId: 'R777', field: 'disability' }, { reportId: 'R777', field: 'notes' }]);
});

test('stored rekap rows map common sheet columns, keep unknowns null and never create approvals', () => {
  const rows = storedRows([
    { shelter_name: 'Posko Cibening', village: 'Cibening', total_people: 91, male: 46, female: 45, urgent_needs: 'Air bersih, Beras' },
    { posko: 'Posko Melati', desa: 'Cisarua', jumlah_jiwa: '63', kebutuhan: ['Selimut'] },
    { shelter_name: 'Posko Kosong' }
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].needs, ['Air bersih', 'Beras']);
  assert.equal(rows[0].people, 91);
  assert.equal(rows[1].name, 'Posko Melati');
  assert.equal(rows[1].people, 63);
  assert.equal(rows[2].people, null);
  assert.equal(rows[2].status, 'Parsial');
  assert.ok(rows.every(r => r.source.includes('rekap yang sudah tersimpan')));
  assert.deepEqual(storedRows(undefined), []);
});

test('a correction is merged onto stored rows instead of replacing the whole recap', () => {
  const base = storedRows([
    { report_id: 'R001', shelter_name: 'Posko Cibening', village: 'Cibening', total_people: 91, male: 46, female: 45, elderly: 7, disability: 0 },
    { report_id: 'R002', shelter_name: 'Posko Harapan', village: 'Sukamaju', total_people: 98, male: 45, female: 55, elderly: 12, disability: 2 }
  ]);
  const candidate = previewRows({ records: [{ report_id: 'R001', shelter_name: 'Posko Harapan', female: 43, elderly: 16 }] });
  const merged = mergeCandidateOntoStored(base, candidate);
  assert.equal(merged.length, 2, 'posko lain tidak hilang');
  assert.equal(merged[0].name, 'Posko Cibening', 'ID laporan yang bertabrakan tidak dipakai untuk mencocokkan');
  assert.deepEqual(merged[0].changes ?? [], []);
  const harapan = merged[1];
  assert.equal(harapan.people, 98, 'total tersimpan dipertahankan');
  assert.equal(harapan.village, 'Sukamaju');
  assert.equal(harapan.female, 43);
  assert.equal(harapan.elderly, 16);
  assert.deepEqual(harapan.changes, ['perempuan 55 → 43', 'lansia 12 → 16']);
  assert.equal(harapan.status, 'Perlu klarifikasi', '45 + 43 tidak sama dengan 98');
  assert.match(harapan.note, /berbeda dari total 98/);
});

test('a candidate for an unknown shelter is appended as new', () => {
  const base = storedRows([{ shelter_name: 'Posko Cibening', total_people: 91 }]);
  const merged = mergeCandidateOntoStored(base, previewRows({ records: [{ shelter_name: 'Posko Baru', total_people: 12 }] }));
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1].changes, ['baru']);
});

test('targeted correction keeps the original row identity when report IDs change', () => {
  const base=storedRows([
    {batch_id:'old',report_id:'R001',shelter_name:'Posko Cibening',total_people:91},
    {batch_id:'old',report_id:'R002',shelter_name:'Posko Harapan',total_people:98,male:45,female:55}
  ]);
  const candidate=previewRows({records:[{batch_id:'new',report_id:'R001',shelter_name:'Posko Harapan',total_people:98,male:43,female:55,update_target:{batch_id:'old',report_id:'R002'}}]});
  const merged=mergeCandidateOntoStored(base,candidate);
  assert.equal(merged.length,2);
  assert.equal(merged[1].id,'R002');
  assert.deepEqual(merged[1].correctionTarget,{batch_id:'old',report_id:'R002'});
  assert.equal(storedRows([{batch_id:'new',report_id:'R001',shelter_name:'Posko Harapan'}])[0].sourceBatchId,'new');
});

test('targeted preview displays canonical replacement and cleared needs exactly',()=>{
  const base=storedRows([{batch_id:'old',report_id:'R002',shelter_name:'Harapan',total_people:98,urgent_needs:['air']}]);
  for(const needs of [[],['obat']]){
    const row=previewRows({records:[{report_id:'R001',batch_id:'new',shelter_name:'Harapan',total_people:98,urgent_needs:needs,missing_fields:['village'],update_target:{batch_id:'old',report_id:'R002'}}]});
    const result=mergeCandidateOntoStored(base,row)[0];
    assert.deepEqual(result.needs,needs);
    assert.equal(result.status,'Parsial');
  }
});

test('clarifying one village keeps calculations and reported needs in other villages',()=>{
  const source=[{report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:10,male:4,female:6,urgent_needs:['air']},
    {report_id:'R002',shelter_name:'Posko B',village:'Desa B',total_people:20,male:9,female:11,urgent_needs:['beras']}];
  const previous=applyCalculations(previewRows({records:source}),{shelters:source.map(r=>({...r,needs:{air_liter_per_hari:{value:r.total_people*15}},gaps:{air_liter_per_hari:0}}))});
  const next=retainUnchangedCalculations(previous,previewRows({records:[{...source[0],male:3,female:7},source[1]]}));
  assert.equal(metricValue(next[1],'air_liter_per_hari'),300);
  assert.equal(metricValue(next[1],'air_liter_per_hari',true),0);
  assert.deepEqual(next[1].needs,['beras']);
  assert.equal(metricValue(next[0],'air_liter_per_hari'),null,'Changed source is invalidated until recalculated');
});

test('stock changes invalidate cached gaps even when the population is unchanged',()=>{
  const source={shelter_name:'Posko A',village:'Desa A',total_people:10,stock:{air_liter_per_hari:20}};
  const previous=applyCalculations(previewRows({records:[source]}),{shelters:[{...source,needs:{air_liter_per_hari:{value:150}},gaps:{air_liter_per_hari:130}}]});
  const next=retainUnchangedCalculations(previous,previewRows({records:[{...source,stock:{air_liter_per_hari:100}}]}));
  assert.equal(next[0].gap,null);
});

test('valid correction awaits storage approval while genuine validation errors still need clarification',()=>{
  const original={batch_id:'old',report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98,male:45,female:55};
  const corrected={...original,batch_id:'new',report_id:'R001',male:43,update_target:{batch_id:'old',report_id:'R002'},storage_conflicts:[{field:'male',previous_value:45,incoming_value:43}],validation_issues:[{field:'storage_conflicts',reason:'Pilih nilai lama atau baru.'}]};
  const base=storedRows([original,{...original,village:'Sukamaju',male:43,urgent_needs:['air']}]);
  const merged=mergeCandidateOntoStored(base,previewRows({records:[corrected]}));
  assert.equal(merged[0].male,43);
  assert.equal(merged[0].status,'Menunggu persetujuan');
  assert.match(merged[0].note,/belum disimpan/);
  assert.doesNotMatch(merged[0].source,/Dibaca dari rekap yang sudah tersimpan/);
  assert.deepEqual(merged[1].needs,['air'],'different village record stays unchanged');
  assert.equal(previewRows({records:[{...corrected,male:44} ]})[0].status,'Perlu klarifikasi');
});

test('village changes follow source target and candidate lineage while rejecting another same-name target',()=>{
  const original=storedRows([{batch_id:'stored',report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98}])[0];
  const changed=previewRows({records:[{batch_id:'new',report_id:'R001',shelter_name:'Posko Harapan',village:'Cibineng',total_people:98,update_target:{batch_id:'stored',report_id:'R002'}}]})[0];
  assert.equal(matchesClarificationTarget(changed,original),true);
  assert.equal(matchesClarificationTarget({...changed,correctionTarget:{batch_id:'another',report_id:'R002'}},original),false);
  const pending=previewRows({records:[{batch_id:'pending',report_id:'R001',shelter_name:'Posko Harapan',village:''}]})[0];
  const continued={...changed,candidateLineage:[{batch_id:'pending',report_id:'R001'}]};
  assert.equal(matchesClarificationTarget(continued,pending),true);
  const merged=mergeCandidateOntoStored([original], [continued]);
  assert.equal(merged.length,1);assert.equal(merged[0].village,'Cibineng');
  assert.equal(matchesClarificationTarget(merged[0],pending),true);
});
