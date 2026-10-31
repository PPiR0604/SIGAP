import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryEstimate} from '../src/NeedsCategoryTable.tsx';
import {storedRows} from '../src/backendPreview.ts';

const shelter=(needs:string[],requirements:Record<string,number|null>={})=>({...storedRows([{shelter_name:'Posko Uji',total_people:100,urgent_needs:needs}])[0],requirements});
test('estimates aggregate only reporting shelters and count a shelter once per category',()=>{
 const rows=[shelter(['air bersih','air mineral'],{air_liter_per_hari:1500}),shelter(['air bersih'],{air_liter_per_hari:750}),shelter(['obat'],{air_liter_per_hari:9000})];
 const result=categoryEstimate(rows,'air');assert.equal(result.required,2250);assert.equal(result.total,2);assert.equal(result.calculated,2);assert.equal(result.unit,'L/hari');
});
test('partial, unknown and explicit zero values remain distinct without inventing estimates from population',()=>{
 const result=categoryEstimate([shelter(['beras'],{kkal_per_hari:210000}),shelter(['beras'])],'pangan');assert.equal(result.required,210000);assert.equal(result.calculated,1);assert.equal(result.total,2);
 assert.equal(categoryEstimate([shelter(['air bersih'])],'air').required,null);
 const zero=categoryEstimate([shelter(['air bersih'],{air_liter_per_hari:0})],'air');assert.equal(zero.required,0);assert.equal(zero.calculated,1);
});
test('sanitation and shelter use explicit server metrics; medical and other items need item details',()=>{
 const rows=[shelter(['sabun','terpal','obat','genset'],{jamban_unit:5,ruang_hunian_m2:350})];
 assert.equal(categoryEstimate(rows,'sanitasi').required,5);assert.equal(categoryEstimate(rows,'sanitasi').label,'Jamban');assert.equal(categoryEstimate(rows,'hunian').unit,'m²');assert.equal(categoryEstimate(rows,'hunian').required,350);
 for(const category of ['medis','lainnya'] as const){const result=categoryEstimate(rows,category);assert.equal(result.required,null);assert.equal(result.label,'');}
});
