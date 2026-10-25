/** Consistent portable backup, including committed WAL data. Never copy just the hot .db file. */
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const source=resolve(process.argv[2]||'data/sigap.db');
const destination=resolve(process.argv[3]||'');
if(!process.argv[3]||source===destination||existsSync(destination))throw new Error('Pilih file tujuan backup baru; sumber tidak boleh ditimpa.');
mkdirSync(dirname(destination),{recursive:true});
const db=new DatabaseSync(source,{readOnly:true});
try{
  const integrity=db.prepare('PRAGMA quick_check').all();
  if(integrity.some(row=>Object.values(row)[0]!=='ok'))throw new Error('Integritas database sumber perlu diperiksa; tidak melakukan migrasi.');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>String(row.name));
  const counts=(connection:DatabaseSync)=>Object.fromEntries(tables.map(name=>[name,connection.prepare('SELECT COUNT(*) AS n FROM "'+name.replaceAll('"','""')+'"').get()!.n]));
  const before=counts(db);
  await backup(db,destination);
  const copy=new DatabaseSync(destination);
  try{
    // A backup for transfer must not depend on source-OS WAL/shared-memory sidecars.
    copy.exec('PRAGMA journal_mode=DELETE');
    if(JSON.stringify(before)!==JSON.stringify(counts(copy)))throw new Error('Jumlah baris berubah selama backup; hentikan penulis lalu ulangi ke tujuan baru.');
    if(copy.prepare('PRAGMA integrity_check').all().some(row=>Object.values(row)[0]!=='ok'))throw new Error('Backup gagal pemeriksaan integritas.');
  }finally{copy.close();}
  const summary={source,destination,integrity:'ok',tables:before};
  writeFileSync(destination+'.summary.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
}finally{db.close();}
