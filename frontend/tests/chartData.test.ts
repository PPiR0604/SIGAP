import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryCounts,metricSummary,vulnerableGroups,groupByArea} from '../src/chartData.ts';
import {previewRows,mergeCandidateOntoStored} from '../src/backendPreview.ts';

const row=(extra:Record<string,unknown>={})=>previewRows({records:[{report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:100,...extra}]})[0];
test('category charts count shelters once and keep an empty report empty',()=>{
  const categories=categoryCounts([row({urgent_needs:['air bersih','air mineral','beras','pangan','selimut','kasur lipat']})]);
  assert.equal(categories.find(c=>c.key==='air')!.count,1);
  assert.equal(categories.find(c=>c.key==='pangan')!.count,1);
  assert.equal(categories.find(c=>c.key==='lainnya')!.count,1);
  assert.ok(Math.abs(categories.reduce((sum,c)=>sum+c.percent,0)-100)<.001);
  assert.ok(categoryCounts([]).every(c=>c.count===0&&c.percent===0));
});
test('coverage uses paired server calculations and never treats unknown stock as zero shortage',()=>{
  const a={...row(),requirements:{air_liter_per_hari:1500},shortages:{air_liter_per_hari:300}};
  const b={...row(),name:'Posko B',requirements:{air_liter_per_hari:600},shortages:{air_liter_per_hari:null}};
  const summary=metricSummary([a,b],'air_liter_per_hari');
  assert.equal(summary.required,2100);assert.equal(summary.calculated,2);
  assert.equal(summary.paired,1);assert.equal(summary.fulfillment,80);assert.equal(summary.shortage,300);
  assert.equal(metricSummary([b],'air_liter_per_hari').fulfillment,null);
  assert.equal(metricSummary([],'air_liter_per_hari').required,null);
});
test('vulnerable groups preserve known zeros, unknowns, overlap and corrections',()=>{
  const original=row({batch_id:'old',infants_toddlers:10,elderly:12,pregnant:4,disability:0});
  const groups=vulnerableGroups(original);
  assert.equal(groups[0].percent,10);assert.equal(groups[3].value,0);assert.equal(groups[3].percent,0);
  assert.equal(vulnerableGroups(row())[0].percent,null);
  assert.equal(vulnerableGroups(row({elderly:120}))[1].inconsistent,true);
  const changed=row({batch_id:'new',infants_toddlers:0,pregnant:2,update_target:{batch_id:'old',report_id:'R001'}});
  const merged=mergeCandidateOntoStored([original],[changed]);
  assert.equal(merged[0].toddler,0);assert.equal(merged[0].pregnant,2);
});
test('area diagrams prefer reported subdistricts and preserve shared village membership',()=>{
  const groups=groupByArea([row({subdistrict:'Kec. A'}),row({shelter_name:'Posko B',kecamatan:'Kec. A'}),row({shelter_name:'Posko C',village:''})]);
  assert.equal(groups.length,2);assert.equal(groups[0].name,'Kec. A');assert.equal(groups[0].rows.length,2);
  assert.equal(groups[1].name,'Desa belum diketahui');
});

test('overall quantities include every shelter regardless of reported category and distinguish zero from unknown',()=>{
 const a={...row({urgent_needs:['air bersih']}),requirements:{air_liter_per_hari:1500,kkal_per_hari:210000,jamban_unit:5,ruang_hunian_m2:350}};
 const b={...row({urgent_needs:['obat']}),requirements:{air_liter_per_hari:750,kkal_per_hari:105000,jamban_unit:3,ruang_hunian_m2:175}};
 assert.equal(metricSummary([a,b],'air_liter_per_hari').required,2250);
 assert.equal(metricSummary([a,b],'kkal_per_hari').required,315000);
 assert.equal(metricSummary([a,b],'jamban_unit').required,8);
 assert.equal(metricSummary([a,b],'ruang_hunian_m2').required,525);
 assert.equal(metricSummary([{...a,requirements:{jamban_unit:0}}],'jamban_unit').required,0);
 assert.equal(metricSummary([row()],'jamban_unit').required,null);
});
