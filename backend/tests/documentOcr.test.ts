import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {DocumentError,extractDocument,validateDocument,OCR_LIMITS,type OcrRunner} from '../src/documents/ocr.js';

function png(width=1600,height=1200){const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
const rejected=(code:string)=>(error:unknown)=>error instanceof DocumentError&&error.code===code;
test('OCR validates file bytes, extensions, dimensions and limits before invoking a parser',()=>{
 assert.equal(validateDocument(png(),'laporan.PNG'),'png');
 assert.throws(()=>validateDocument(Buffer.from('%PDF-1.7'),'foto.png'),rejected('INVALID_DOCUMENT'));
 assert.throws(()=>validateDocument(png(),'../laporan.png'),rejected('INVALID_DOCUMENT_NAME'));
 assert.throws(()=>validateDocument(png(),'laporan.docx'),rejected('UNSUPPORTED_DOCUMENT'));
 assert.throws(()=>validateDocument(Buffer.alloc(0),'laporan.png'),rejected('EMPTY_DOCUMENT'));
 assert.throws(()=>validateDocument(Buffer.alloc(OCR_LIMITS.bytes+1),'laporan.png'),rejected('DOCUMENT_TOO_LARGE'));
 assert.throws(()=>validateDocument(png(8000,8000),'laporan.png'),rejected('IMAGE_TOO_LARGE'));
 assert.throws(()=>validateDocument(png(10,10),'laporan.png'),rejected('INVALID_IMAGE'));
});
test('OCR uses fixed temporary filenames, returns a digest and cleans up files after success',async()=>{
 let input='';const bytes=png();
 const runner:OcrRunner=async(command,args,options)=>{assert.equal(command,'tesseract');input=args[0];assert.ok(!input.includes('untrusted'));assert.deepEqual(await readFile(input),bytes);assert.ok(options.timeoutMs<=75000);assert.deepEqual(args.slice(1),['stdout','-l','ind+eng','--psm','3']);return 'Posko Uji\nJumlah jiwa: 10\n';};
 const result=await extractDocument(bytes,'untrusted;name.png',{runner});
 assert.equal(result.text,'Posko Uji\nJumlah jiwa: 10');assert.equal(result.pages,1);assert.match(result.source_sha256,/^[a-f0-9]{64}$/);assert.match(result.warnings[0],/belum diverifikasi/);
 await assert.rejects(()=>access(dirname(input)));
});
test('PDF pages are bounded and OCR preserves page order without returning silent partial results',async()=>{
 const calls:string[][]=[];let current=0,input='';
 const runner:OcrRunner=async(command,args)=>{
  calls.push([command,...args]);if(command==='pdfinfo'){input=args[0];return 'Pages: 2\nEncrypted: no\n';}
  if(command==='pdftoppm'){current=Number(args[1]);await writeFile(args.at(-1)!+'.png',png());return '';}
  return current===1?'Posko A: 10 jiwa':'Posko B: 20 jiwa';
 };
 const result=await extractDocument(Buffer.from('%PDF-1.7'),'laporan.pdf',{runner});assert.equal(result.pages,2);assert.match(result.text,/Halaman 1.*\nPosko A: 10 jiwa.*\n\n--- Halaman 2 ---\nPosko B: 20 jiwa/);
 assert.equal(calls.filter(c=>c[0]==='tesseract').length,2);assert.ok(calls.filter(c=>c[0]==='pdftoppm').every(c=>c.includes('2400')));await assert.rejects(()=>access(dirname(input)));
 for(const [info,code]of [['Pages: 6\nEncrypted: no','TOO_MANY_PAGES'],['Pages: 1\nEncrypted: yes','ENCRYPTED_DOCUMENT']] as const){let renders=0;
  await assert.rejects(()=>extractDocument(Buffer.from('%PDF-1.7'),'laporan.pdf',{runner:async(command)=>{if(command==='pdfinfo')return info;renders++;return '';}}),rejected(code));assert.equal(renders,0);
 }
});
test('blank scans, oversized OCR, missing runtime, cancellation and parser errors have safe errors and cleanup',async()=>{
 for(const [failure,code]of [[{code:'ENOENT',message:'private-path'},'OCR_UNAVAILABLE'],[{killed:true,message:'private-document'},'OCR_TIMEOUT'],[{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'},'OCR_TEXT_TOO_LARGE'],[{message:'private-engine-stderr'},'OCR_FAILED']] as const){let path='';
  await assert.rejects(()=>extractDocument(png(),'scan.png',{runner:async(_command,args)=>{path=args[0];throw failure;}}),(error:unknown)=>rejected(code)(error)&&!String(error).includes('private-'));
  await assert.rejects(()=>access(dirname(path)));
 }
 await assert.rejects(()=>extractDocument(png(),'scan.png',{runner:async()=>''}),rejected('OCR_NO_TEXT'));
 await assert.rejects(()=>extractDocument(png(),'scan.png',{runner:async()=>'a'.repeat(204801)}),rejected('OCR_TEXT_TOO_LARGE'));
 let calls=0;await assert.rejects(()=>extractDocument(png(),'scan.png',{signal:AbortSignal.abort(),runner:async()=>{calls++;return '';}}),rejected('OCR_TIMEOUT'));assert.equal(calls,0);
});
