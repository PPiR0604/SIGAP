import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StructuredCorrectionSchema,structuredCorrection,correctionBaseKey} from '../../src/pipeline/structuredCorrection.js';
const target={report_id:'R002',batch_id:'source-a',name:'Posko A',village:'Desa A'};
test('extended structured corrections preserve explicit zero, stock period and source evidence',()=>{
 const input=StructuredCorrectionSchema.parse({target,base_key:'{}',changes:{totalFamilies:4,toddler:0,children:3,pregnant:1,breastfeeding:0,reportedAt:'2026-10-29 08:15',stock:{air_liter_per_hari:0},stockContext:{air_liter_per_hari:{unit:'L',recorded_at:'2026-10-29 08:15',horizon_hours:48}},clearFields:['disability']}});
 const {record,text}=structuredCorrection(input);assert.equal(record.total_families,4);assert.equal(record.infants_toddlers,0);assert.match(text,/0 L untuk 48 jam dicatat 29\/10\/2026 08:15/);assert.match(text,/Usulkan pengosongan field: disability/);assert.equal(record.disability,undefined,'proposing clear never directly clears the record');
});
test('identity cannot be cleared and invalid counts/periods are rejected',()=>{
 for(const changes of [{clearFields:['shelter_name']},{children:-1},{children:1.5},{stock:{evil:3}},{stockContext:{air_liter_per_hari:{unit:'L',horizon_hours:0}}},{stockContext:{air_liter_per_hari:{unit:'L',horizon_hours:24}}},{stock:{jamban_unit:1.5}},{stock:{air_liter_per_hari:10},stockContext:{air_liter_per_hari:{unit:'kkal'}}},{people:20,clearFields:['total_people']},{reportedAt:'2026-02-30 08:00'}])assert.equal(StructuredCorrectionSchema.safeParse({target,base_key:'{}',changes}).success,false,JSON.stringify(changes));
});
test('number of families participates in stale correction detection',()=>assert.notEqual(correctionBaseKey({total_families:2}),correctionBaseKey({total_families:3})));
