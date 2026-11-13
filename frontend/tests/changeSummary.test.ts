import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changesFor} from '../src/ChangeSummary.tsx';
import {storedRows,previewRows} from '../src/backendPreview.ts';

test('before/after includes renamed locations, numbers and needs while keeping unknown distinct from zero',()=>{
 const old=storedRows([{shelter_name:'Posko Lama',village:'Desa Lama',total_people:98,male:43,disability:null,urgent_needs:['Air bersih']}])[0];
 const next={...old,name:'Posko Baru',village:'Cibening',people:100,disability:0,needs:['Air bersih','Beras']};
 const changes=changesFor(old,next);
 assert.deepEqual(changes.map(c=>c.label),['Nama posko','Desa','Jumlah jiwa','Disabilitas','Kebutuhan dilaporkan']);
 assert.deepEqual(changes.find(c=>c.label==='Disabilitas'),{label:'Disabilitas',before:'Belum diketahui',after:'0'});
 assert.equal(old.people,98);assert.deepEqual(old.needs,['Air bersih']);assert.deepEqual(changesFor(old,{...old}),[]);
});

test('note-only changes remain visible for approval and reordered stock does not create false changes',()=>{
 const record={shelter_name:'Posko Sejahtera',village:'Cibening',total_people:12,notes:'Catatan lama',
   stock:{air_liter_per_hari:0,jamban_unit:null},stock_context:{air_liter_per_hari:{horizon_hours:24},jamban_unit:{}}};
 const old=storedRows([record])[0];
 const next=previewRows({records:[{...record,notes:'Stok nol sudah dikonfirmasi.',
   stock:{jamban_unit:null,air_liter_per_hari:0},stock_context:{jamban_unit:{},air_liter_per_hari:{horizon_hours:24}}}]})[0];
 assert.deepEqual(changesFor(old,next),[{label:'Catatan laporan',before:'Catatan lama',after:'Stok nol sudah dikonfirmasi.'}]);
 assert.equal(next.people,old.people);
});
