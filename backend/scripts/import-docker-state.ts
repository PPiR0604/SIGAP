/** One-time import into an empty Linux volume. Never overwrites an existing database. */
import {DatabaseSync} from 'node:sqlite';
import {constants,copyFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
const source=resolve(process.argv[2]||'');
const target=resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3]||source===target||existsSync(target))throw new Error('Volume tujuan harus belum berisi database; tidak menimpa data.');
const inspect=(path:string)=>{
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    if(db.prepare('PRAGMA integrity_check').all().some(row=>Object.values(row)[0]!=='ok'))throw new Error('Integritas database gagal.');
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,db.prepare('SELECT COUNT(*) AS n FROM "'+name.replaceAll('"','""')+'"').get()!.n];}));
  }finally{db.close();}
};
const before=inspect(source);
mkdirSync(dirname(target),{recursive:true});
copyFileSync(source,target,constants.COPYFILE_EXCL);
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
if(digest(source)!==digest(target)||JSON.stringify(before)!==JSON.stringify(inspect(target)))throw new Error('Verifikasi salinan database gagal; jangan jalankan server.');
const tokenSource=process.argv[4];
const tokenTarget=join(dirname(target),'session-token.txt');
if(tokenSource&&existsSync(tokenSource)&&!existsSync(tokenTarget))copyFileSync(tokenSource,tokenTarget,constants.COPYFILE_EXCL);
console.log(JSON.stringify({imported:true,integrity:'ok',target,tables:before,session_token_preserved:!!tokenSource&&existsSync(tokenTarget)}));
