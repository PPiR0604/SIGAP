const legacyFooter = 'Disusun dari laporan posko; persetujuan rekap tidak membuktikan kondisi lapangan terkini. Tidak memuat data pribadi pengungsi.';
export function hasBulletinContent(text:string){return !!text.trim()&&!/^Belum ada\b/i.test(text.trim());}

export function bulletinTable(text:string,records:Record<string,any>[]=[]){
 const original=text.split(/\r?\n/);
 const start=original.findIndex(line=>/^#{1,6}\s+Ringkasan per desa\s*$/i.test(line.trim()));
 if(start>=0){
  let end=start+1;while(end<original.length&&!/^#{1,6}\s/.test(original[end]))end++;
  const content=original.slice(start+1,end).filter(line=>line.trim());
  const parsed=content.map(line=>/^\s*[-*+]\s+\*\*(.+?)\*\*\s+—\s+(.+?)\.\s+Dibutuhkan:\s*(.+?)\.\s+Waktu sumber:\s*(.+?)\s+WIB\.(?:\s+Catatan:\s*(.+))?\s*$/.exec(line));
  if(parsed.length&&parsed.every(Boolean)){
   const esc=(value:string)=>value.replace(/\|/g,'\\|');
   original.splice(start+1,end-start-1,'','| Desa | Jiwa | Kebutuhan | Waktu sumber | Catatan |','| --- | --- | --- | --- | --- |',...parsed.map(m=>`| ${esc(m![1])} | ${esc(m![2])} | ${esc(m![3])} | ${esc(m![4])} WIB | ${esc(m![5]||'—')} |`),'');
   text=original.join('\n');
  }
 }
 const norm=(value:unknown)=>String(value??'').trim().toLocaleLowerCase('id-ID').replace(/\s+/g,' ');
 const amount=(name:string,count:number)=>{
  const grouped=new Map<string,{unit:string;total:number;covered:number}>();
  for(const record of records){
   const matches=(Array.isArray(record.urgent_needs)?record.urgent_needs:[]).filter((need:any)=>need&&typeof need==='object'&&norm(need.item||need.name||need.category)===norm(name));
   // Ambiguous repeated items in one report must not be added twice.
   if(matches.length!==1)continue;
   const need=matches[0],qty=need.qty,unit=typeof need.unit==='string'?need.unit.trim():'';
   if(typeof qty!=='number'||!Number.isFinite(qty)||qty<0||!unit)continue;
   const key=norm(unit),entry=grouped.get(key)||{unit,total:0,covered:0};entry.total+=qty;entry.covered++;grouped.set(key,entry);
  }
  if(!grouped.size)return 'Belum dilaporkan';
  return [...grouped.values()].map(entry=>`${entry.total.toLocaleString('id-ID',{maximumFractionDigits:2})} ${entry.unit.replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|')}${entry.covered!==count?` (${entry.covered} posko memiliki jumlah)`:''}`).join('; ');
 };
 return text.replace(/((?:^[ \t]*[-*+]\s+.+?\s+\(diminta\s+\d+\s+posko\)[ \t]*(?:\r?\n|$))+)/gm,block=>{
  const lines=block.trim().split(/\r?\n/).map(line=>/^\s*[-*+]\s+(.+?)\s+\(diminta\s+(\d+)\s+posko\)\s*$/.exec(line));
  if(lines.some(line=>!line))return block;
  return ['| Kebutuhan | Dilaporkan | Jumlah diketahui |','| --- | ---: | --- |',...lines.map(line=>`| ${line![1].replace(/\|/g,'\\|')} | ${line![2]} posko | ${amount(line![1],Number(line![2]))} |`),'',''].join('\n');
 });
}

/** Clean only a final attribution; keep the canonical server payload/hash intact. */
export function bulletinForReading(text: string): string {
  const lines = text.trimEnd().split(/\r?\n/);
  const last = (lines.at(-1) || '').trim().replace(/^[*_]+|[*_]+$/g, '').trim();
  const attribution = /^(?:buletin|draf(?: buletin)?|dokumen)(?: ini)?\s+(?:dibuat|disusun|dihasilkan)\b.*\b(?:oleh|otomatis)\b/i;
  if (last !== legacyFooter && !attribution.test(last)) return text;
  lines.pop();
  return lines.join('\n').trimEnd();
}
