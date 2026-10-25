/** Parse a bounded CSV without evaluating formulas. Every cell remains untrusted source text. */
export function csvReports(text:string,maxBytes=204800):{text:string;rows:number} {
  const source=text.replace(/^\uFEFF/,'');
  const first=source.split(/\r?\n/,1)[0];
  const delimiter=[',',';','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const pushCell=()=>{row.push(cell);cell='';closed=false;};
  const pushRow=()=>{pushCell();if(row.some(v=>v.trim()))rows.push(row);row=[];};
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
    if(ch===delimiter){pushCell();continue;}
    if(ch==='\n'||ch==='\r'){if(ch==='\r'&&source[i+1]==='\n')i++;pushRow();continue;}
    if(ch==='"'){if(cell||closed)throw new Error('Tanda kutip CSV tidak valid.');quoted=true;continue;}
    if(closed){if(!/\s/.test(ch))throw new Error('Karakter setelah kutip CSV tidak valid.');continue;}
    cell+=ch;
  }
  if(quoted)throw new Error('Tanda kutip CSV belum ditutup.');
  if(cell||row.length||closed)pushRow();
  const header=rows.shift()?.map(v=>v.trim())||[];
  if(header.length<2||header.length>64||header.some(v=>!v||v.length>128)||new Set(header.map(v=>v.toLowerCase())).size!==header.length)throw new Error('CSV memerlukan 2–64 kolom dengan judul unik, tidak kosong, dan maksimal 128 karakter.');
  if(!rows.length||rows.length>100)throw new Error('Impor CSV memerlukan 1–100 baris data per batch.');
  const aliases:Record<string,string>={shelter_name:'posko',nama_posko:'posko',village:'desa',total_people:'jumlah jiwa',jumlah_jiwa:'jumlah jiwa',jiwa:'jumlah jiwa',male:'laki-laki',laki_laki:'laki-laki',pria:'laki-laki',female:'perempuan',wanita:'perempuan',elderly:'lansia',disability:'disabilitas',urgent_needs:'kebutuhan',kebutuhan_mendesak:'kebutuhan',reported_at:'waktu laporan',waktu_laporan:'waktu laporan'};
  const clean=(value:string)=>value.replace(/[\r\n]+/g,' / ');
  const reports=rows.map((values,index)=>{
    if(values.length!==header.length)throw new Error(`Jumlah kolom CSV baris ${index+2} tidak sesuai judul.`);
    const items=header.map((name,i)=>[aliases[name.toLowerCase().replace(/\s+/g,'_')]||name,values[i]]);
    const date=items.find(([label])=>label==='waktu laporan')?.[1];
    const match=date&&/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::00)?$/.exec(date.trim());
    const body=items.filter(([,v])=>v.trim()).map(([label,value])=>`${clean(label)}: ${clean(value)}`).join('. ')+'.';
    return match?`${match[3]}/${match[2]}/${match[1]} ${match[4]}.${match[5]} - Impor CSV baris ${index+2}: ${body}`:`Impor CSV baris ${index+2}: ${body}`;
  });
  // Plain and timestamped rows are sent separately with an explicit boundary recognized by prepare_needs.
  // Use one consistently plain source when dates are mixed, preserving all rows for the LLM.
  const allDated=reports.every(r=>/^\d{2}\//.test(r));
  const normalized=allDated?reports.join('\n'):reports.map(r=>r.replace(/^(\d{2}\/\d{2}\/\d{4} \d{2}\.\d{2}) - /,'Waktu laporan $1; ')).join('\n\n---\n\n');
  if(Buffer.byteLength(normalized,'utf8')>maxBytes)throw new Error('Hasil normalisasi CSV terlalu besar. Bagi menjadi beberapa batch.');
  return {text:normalized,rows:rows.length};
}
