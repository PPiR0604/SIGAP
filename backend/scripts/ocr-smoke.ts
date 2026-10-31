// Run inside the OCR Docker image, without network or production environment variables.
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {extractDocument,DocumentError} from '../src/documents/ocr.js';

const root=resolve(process.argv[2]||'../data/synthetic/ocr');
for(const filename of ['laporan-posko.png','laporan-posko.jpg','laporan-dua-halaman.pdf']){
 const result=await extractDocument(await readFile(join(root,filename)),filename);
 assert.match(result.text,/Posko Harapan/i);assert.match(result.text,/Jumlah jiwa:\s*100/i);assert.match(result.text,/Laki.laki:\s*40/i);assert.match(result.text,/Perempuan:\s*60/i);
 if(filename.endsWith('.pdf')){assert.equal(result.pages,2);assert.match(result.text,/Posko Melati/i);assert.match(result.text,/Jumlah jiwa:\s*80/i);}
 console.log(`PASS ${filename}: ${result.pages} page(s), ${result.text.length} characters, expected shelter names and counts.`);
}
for(const [filename,code]of [['gambar-kosong.png','OCR_NO_TEXT'],['enam-halaman-ditolak.pdf','TOO_MANY_PAGES']] as const){
 await assert.rejects(()=>readFile(join(root,filename)).then(bytes=>extractDocument(bytes,filename)),(error:unknown)=>error instanceof DocumentError&&error.code===code);
 console.log(`PASS ${filename}: rejected with ${code}.`);
}
