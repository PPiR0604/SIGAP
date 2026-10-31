import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export const OCR_LIMITS={bytes:5*1024*1024,pages:5,pixels:24_000_000,timeoutMs:75_000,textBytes:204800} as const;
export class DocumentError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message);}}
export interface DocumentExtraction {text:string;filename:string;pages:number;engine:'tesseract';source_sha256:string;warnings:string[]}
export type OcrRunner=(command:string,args:string[],options:{timeoutMs:number;signal?:AbortSignal})=>Promise<string>;
export const runOcrCommand:OcrRunner=(command,args,{timeoutMs,signal})=>new Promise((resolve,reject)=>{
 execFile(command,args,{encoding:'utf8',windowsHide:true,timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:512*1024,signal,env:{...process.env,LC_ALL:'C',OMP_THREAD_LIMIT:'1'}},(error,stdout)=>error?reject(error):resolve(stdout));
});

function imageDimensions(bytes:Buffer,kind:'png'|'jpg'):{width:number;height:number}|null{
 if(kind==='png')return bytes.length>=24&&bytes.toString('ascii',12,16)==='IHDR'?{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}:null;
 let offset=2;
 const frames=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==0xff)return null;
  while(bytes[offset]===0xff)offset++;
  const marker=bytes[offset++];if(marker===0xd9||marker===0xda)return null;
  if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
  if(offset+2>bytes.length)return null;
  const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)return null;
  if(frames.has(marker))return length>=8?{height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)}:null;
  offset+=length;
 }
 return null;
}

export function validateDocument(bytes:Buffer,filename:string):'pdf'|'png'|'jpg'{
 if(!filename||filename.length>200||/[\x00-\x1f\x7f/\\]/.test(filename))throw new DocumentError(422,'INVALID_DOCUMENT_NAME','Nama berkas tidak valid atau terlalu panjang.');
 if(!bytes.length)throw new DocumentError(422,'EMPTY_DOCUMENT','Dokumen kosong. Pilih berkas yang berisi laporan.');
 if(bytes.length>OCR_LIMITS.bytes)throw new DocumentError(413,'DOCUMENT_TOO_LARGE','Ukuran dokumen OCR maksimal 5 MiB.');
 const extension=filename.split('.').at(-1)?.toLowerCase();
 const kind=extension==='pdf'?'pdf':extension==='png'?'png':['jpg','jpeg'].includes(extension||'')?'jpg':null;
 if(!kind)throw new DocumentError(422,'UNSUPPORTED_DOCUMENT','OCR mendukung PDF, JPG, JPEG, dan PNG.');
 const valid=kind==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':kind==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(!valid)throw new DocumentError(422,'INVALID_DOCUMENT','Isi berkas tidak cocok dengan format dokumennya.');
 if(kind!=='pdf'){
  const dimensions=imageDimensions(bytes,kind);
  if(!dimensions||dimensions.width<32||dimensions.height<32)throw new DocumentError(422,'INVALID_IMAGE','Gambar rusak atau terlalu kecil untuk dibaca.');
  if(dimensions.width>8000||dimensions.height>8000||dimensions.width*dimensions.height>OCR_LIMITS.pixels)throw new DocumentError(413,'IMAGE_TOO_LARGE','Resolusi gambar terlalu besar. Perkecil hingga maksimal 24 megapiksel dan 8000 piksel per sisi.');
 }
 return kind;
}

/** Local preprocessing only: no LLM, persistence, publication or operational database writes. */
export async function extractDocument(bytes:Buffer,filename:string,options:{signal?:AbortSignal;runner?:OcrRunner}={}):Promise<DocumentExtraction>{
 const kind=validateDocument(bytes,filename),runner=options.runner||runOcrCommand;
 const deadline=Date.now()+OCR_LIMITS.timeoutMs;
 let directory:string|undefined;
 const command=async(name:string,args:string[])=>{
  if(options.signal?.aborted||Date.now()>=deadline)throw new DocumentError(408,'OCR_TIMEOUT','Pembacaan dokumen dibatalkan atau melewati batas waktu. Coba berkas yang lebih kecil.');
  return runner(name,args,{timeoutMs:Math.max(1,deadline-Date.now()),signal:options.signal});
 };
 try{
  directory=await mkdtemp(join(tmpdir(),'sigap-ocr-'));
  const input=join(directory,`source.${kind}`);await writeFile(input,bytes,{mode:0o600});
  let pages=1;
  if(kind==='pdf'){
   const info=await command('pdfinfo',[input]);
   if(/Encrypted:\s+yes/i.test(info))throw new DocumentError(422,'ENCRYPTED_DOCUMENT','PDF dilindungi kata sandi. Unggah salinan yang dapat dibuka tanpa kata sandi.');
   pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
   if(!Number.isSafeInteger(pages)||pages<1)throw new DocumentError(422,'INVALID_PDF','Jumlah halaman PDF tidak dapat dibaca.');
   if(pages>OCR_LIMITS.pages)throw new DocumentError(413,'TOO_MANY_PAGES','OCR mendukung maksimal 5 halaman PDF per unggahan. Bagi dokumen menjadi beberapa berkas.');
  }
  const texts:string[]=[],warnings=['Hasil OCR belum diverifikasi. Periksa ulang angka, nama posko/desa, dan susunan tabel sebelum mengirim.'];
  for(let page=1;page<=pages;page++){
   let image=input;
   if(kind==='pdf'){
    const prefix=join(directory,`page-${page}`);
    await command('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','2400','-png',input,prefix]);image=prefix+'.png';
   }
   const text=(await command('tesseract',[image,'stdout','-l','ind+eng','--psm','3'])).replace(/\u0000/g,'').trim();
   texts.push(text);
   if(!text)warnings.push(`Tidak ada teks yang terbaca pada halaman ${page}. Periksa halaman aslinya.`);
  }
  if(!texts.some(text=>text.trim()))throw new DocumentError(422,'OCR_NO_TEXT','Tidak ditemukan teks yang terbaca. Gunakan foto lebih jelas, tegak, dan cukup cahaya.');
  const text=texts.map((text,index)=>pages>1?`--- Halaman ${index+1} ---\n${text||'[Tidak ada teks yang terbaca]'}`:text).join('\n\n');
  if(Buffer.byteLength(text,'utf8')>OCR_LIMITS.textBytes)throw new DocumentError(413,'OCR_TEXT_TOO_LARGE','Teks hasil OCR melebihi 200 KiB. Bagi dokumen menjadi beberapa berkas.');
  return {text,filename,pages,engine:'tesseract',source_sha256:createHash('sha256').update(bytes).digest('hex'),warnings};
 }catch(error){
  if(error instanceof DocumentError)throw error;
  const failure=error as NodeJS.ErrnoException&{killed?:boolean};
  if(failure.code==='ENOENT')throw new DocumentError(503,'OCR_UNAVAILABLE','Layanan OCR belum tersedia. Jalankan backend melalui Docker yang sudah diperbarui.');
  if(options.signal?.aborted||failure.name==='AbortError'||failure.killed||failure.code==='ETIMEDOUT')throw new DocumentError(408,'OCR_TIMEOUT','Pembacaan dokumen dibatalkan atau melewati batas waktu. Coba berkas yang lebih kecil.');
  if(failure.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw new DocumentError(413,'OCR_TEXT_TOO_LARGE','Hasil dokumen terlalu besar. Bagi dokumen menjadi beberapa berkas.');
  throw new DocumentError(422,'OCR_FAILED','Dokumen tidak dapat dibaca. Pastikan PDF tidak terkunci, gambar tidak rusak, dan teks cukup jelas.');
 }finally{
  // This exact directory was created by mkdtemp; filenames from users never form filesystem paths.
  if(directory)await rm(directory,{recursive:true,force:true});
 }
}
