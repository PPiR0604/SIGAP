import {useId,useState} from 'react';
import {ChevronDown,Search} from 'lucide-react';
import type {Shelter} from './demo';
import {groupByArea,shelterKey} from './chartData';
import {StatusOverview} from './StatusOverview';

export function NeedMapping({shelters,onSelect}:{shelters:Shelter[];onSelect:(s:Shelter)=>void}){
  const [expanded,setExpanded]=useState('');
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const id=useId();
  const groups=groupByArea(shelters);
  const scale=Math.max(1,...groups.map(group=>group.rows.length));
  const filtered=groups.filter(group=>group.name.toLocaleLowerCase('id').includes(query.trim().toLocaleLowerCase('id')));
  const pageSize=4,pages=Math.max(1,Math.ceil(filtered.length/pageSize)),currentPage=Math.min(page,pages-1);
  const visible=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  return <section className="card mapping-bottom-card restored-mapping" aria-label="Pemetaan Kebutuhan per Wilayah">
    <div className="mapping-card-header"><div className="mapping-title-group"><h2 className="mapping-card-title">Pemetaan Kebutuhan per Wilayah</h2><p className="mapping-card-subtitle">Lihat berapa posko yang melaporkan setiap kategori kebutuhan di kecamatan atau desa.</p></div><span className="mapping-count-pill">{groups.length} wilayah terdata</span></div>
    <div className="mapping-two-col-layout"><div className="area-needs-column">
      <div className="area-needs-explainer"><strong>Cara membaca</strong><p>Angka menunjukkan jumlah posko yang melapor, bukan jumlah barang. Satu posko bisa masuk beberapa kategori.</p></div>
      {groups.length>0&&<><label className="area-search-label" htmlFor={`${id}-search`}>Cari wilayah</label><div className="area-search-input"><Search size={17} aria-hidden="true"/><input id={`${id}-search`} type="search" placeholder="Nama kecamatan atau desa" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></div>
        <p className="area-scale-note">Skala batang sama untuk semua wilayah: 0–{scale} posko.</p></>}
      {!groups.length&&<p className="empty">Belum ada laporan untuk mengisi diagram wilayah.</p>}
      {groups.length>0&&!filtered.length&&<p className="empty">Wilayah tidak ditemukan. Coba nama lain.</p>}
      {visible.map((group,index)=>{
        const reported=group.categories.filter(c=>c.count).sort((a,b)=>b.count-a.count);
        const detailsId=`${id}-posko-${currentPage*pageSize+index}`;
        return <article className="area-needs-card" key={group.name} aria-label={`Kebutuhan wilayah ${group.name}`}>
          <div className="area-needs-heading"><h3>{group.name}</h3><span>{group.rows.length} posko terdata</span></div>
          {reported.length?<ul className="area-needs-bars" aria-label={`Kebutuhan ${group.name}`}>
            {reported.map(c=><li className="area-need-line" key={c.key}>
              <span className="area-need-label">{c.label}</span>
              <span className="area-need-track" aria-hidden="true"><span style={{width:`${c.count/scale*100}%`,backgroundColor:c.color}}/></span>
              <span className="area-need-count">{c.count} dari {group.rows.length} posko</span>
            </li>)}
          </ul>:<p className="area-no-needs">Belum ada kebutuhan yang dilaporkan.</p>}
          <button className="area-detail-toggle" onClick={()=>setExpanded(expanded===group.name?'':group.name)} aria-expanded={expanded===group.name} aria-controls={detailsId} aria-label={`Lihat posko di ${group.name}`}>{expanded===group.name?'Tutup daftar posko':'Lihat daftar posko'}<ChevronDown size={16} aria-hidden="true"/></button>
          <div id={detailsId} hidden={expanded!==group.name} className="area-shelter-list">{group.rows.map(s=><button className="button secondary" key={shelterKey(s)} onClick={()=>onSelect(s)}>{s.name} · {s.people===null?'Jiwa belum diketahui':`${s.people} jiwa`}</button>)}</div>
        </article>;
      })}
      {filtered.length>0&&<div className="area-pagination"><p aria-live="polite">Menampilkan {currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,filtered.length)} dari {filtered.length} wilayah</p>{pages>1&&<div role="group" aria-label="Halaman kebutuhan wilayah"><button className="button secondary" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Sebelumnya</button><button className="button secondary" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}>Berikutnya</button></div>}</div>}
    </div><StatusOverview shelters={shelters} onSelect={onSelect}/></div>
  </section>;
}
