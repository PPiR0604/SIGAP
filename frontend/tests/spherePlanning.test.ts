import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storedRows,previewRows,mergeCandidateOntoStored,retainUnchangedCalculations} from '../src/backendPreview.ts';
import {applyCalculations} from '../src/needs.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/spherePlanning.json',import.meta.url),'utf8'));
test('server planning detail is carried unchanged; legacy output does not invent nutrient figures',()=>{
 const rows=storedRows([fixture.record]);const result=applyCalculations(rows,{shelters:[fixture.calculation]});
 assert.deepEqual(result[0].planning,fixture.calculation.planning);
 const legacy={...fixture.calculation};delete legacy.planning;
 assert.equal(applyCalculations(result,{shelters:[legacy]})[0].planning,undefined);
});
test('age corrections invalidate planning only for that shelter, including when population stays the same',()=>{
 const other={...fixture.record,batch_id:'sphere-b',shelter_name:'Posko B',village:'Desa B'};
 const old=applyCalculations(storedRows([fixture.record,other]),{shelters:[fixture.calculation,{...fixture.calculation,shelter_name:other.shelter_name,village:other.village}]});
 const candidate=previewRows({records:[{...fixture.record,children:22,update_target:{batch_id:fixture.record.batch_id,report_id:fixture.record.report_id}}]});
 const merged=retainUnchangedCalculations(old,mergeCandidateOntoStored(old,candidate));
 assert.equal(merged[0].planning,undefined);assert.deepEqual(merged[1].planning,old[1].planning);
});
