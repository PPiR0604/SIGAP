import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GapResultSchema} from '../../src/pipeline/toolResults.js';
const fixture=JSON.parse(readFileSync(new URL('../../../frontend/tests/fixtures/spherePlanning.json',import.meta.url),'utf8'));
const payload=()=>({shelters:[structuredClone(fixture.calculation)],totals:{total_people:100,air_liter_per_hari:1500,kkal_per_hari:210000}});
test('Sphere detail from the actual Python calculator survives the compatible tool contract',()=>{
 const result=GapResultSchema.parse(payload());assert.deepEqual(result.shelters[0].planning,fixture.calculation.planning);
 const legacy=payload();delete legacy.shelters[0].planning;assert.equal(GapResultSchema.safeParse(legacy).success,true);
});
test('malformed or contradictory nutrient detail is rejected before reaching the interface',()=>{
 for(const change of [(p:any)=>{p.nutrition.protein_g=-1;},(p:any)=>{p.age_groups[0].key='adults';},(p:any)=>{p.age_groups[2].people=null;}]){
  const data=payload();change(data.shelters[0].planning);assert.equal(GapResultSchema.safeParse(data).success,false);
 }
});
