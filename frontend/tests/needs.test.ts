import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storedRows} from '../src/backendPreview.ts';
import {applyCalculations,metricValue,recapCsv} from '../src/needs.ts';

test('CSV export treats imported names and needs as text instead of spreadsheet formulas',()=>{
  const rows=storedRows([{shelter_name:'=1+1',village:'@SUM(1)',urgent_needs:['+malicious']}]);
  const exported=recapCsv(rows);
  assert.match(exported,/'=1\+1/);assert.match(exported,/'@SUM/);assert.match(exported,/'\+malicious/);
});

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

test('CSV has one header, complete demographics, source-bound calculations and clear missing and zero values',()=>{
 const rows=storedRows([{shelter_name:'Posko A',village:'Desa A',reported_at:'2026-10-30T08:00',total_people:10,total_families:3,male:4,female:6,infants_toddlers:0,children:2,elderly:1,pregnant:0,breastfeeding:1,disability:0}]);
 const result=applyCalculations(rows,{shelters:[{shelter_name:'Posko A',village:'Desa A',needs:{air_liter_per_hari:{value:150},kkal_per_hari:{value:21000},jamban_unit:{value:1},ruang_hunian_m2:{value:35}},gaps:{air_liter_per_hari:0},planning:{schema_version:'sphere2018-population-v1',complete_age_counts:true,nutrition:{energy_kcal:21000,protein_g:530,fat_g:400,carbohydrate_equivalent_g:3820},age_groups:[{key:'under5',people:0,water_l:0,energy_kcal:0},{key:'children',people:2,water_l:30,energy_kcal:4200},{key:'adults',people:7,water_l:105,energy_kcal:14700},{key:'elderly',people:1,water_l:15,energy_kcal:2100}],issues:[]}}]});
 const [header,line,...extra]=recapCsv(result,undefined,()=> 'Menunggu persetujuan').split('\r\n');const names=header.split(','),values=line.split(',');const get=(name:string)=>values[names.indexOf(name)];
 assert.deepEqual(extra,[]);assert.equal(names[0],'Posko');assert.equal(names.length,values.length);assert.equal(get('Jiwa'),'10');assert.equal(get('Balita 0–4 tahun'),'0');assert.equal(get('Ibu menyusui'),'1');assert.equal(get('Acuan kebutuhan Air bersih (L/hari)'),'150');assert.equal(get('Kekurangan Air bersih (L/hari)'),'0');assert.equal(get('Kekurangan Pangan (energi) (kkal/hari)'),'Belum diketahui');assert.equal(get('Acuan protein (g/hari)'),'530');assert.equal(get('Dewasa dalam alokasi (jiwa)'),'7');assert.equal(get('Status penyimpanan'),'Menunggu persetujuan');
 const empty=recapCsv(rows).split('\r\n')[1].split(',');assert.equal(empty[names.indexOf('Acuan protein (g/hari)')],'Belum diketahui');
});
