import type {ReviewItem,ReviewKind} from './reviewIndicators';
const groups:{kind:ReviewKind;title:string}[]=[{kind:'clarification',title:'Perlu klarifikasi'},{kind:'missing',title:'Data belum dilaporkan'},{kind:'decision',title:'Perlu keputusan petugas'},{kind:'stock',title:'Kelengkapan data stok'}];
export function ReviewChecklist({items=[]}:{items?:ReviewItem[]}){
  if(!items.length)return null;
  return <section className="review-indicators" aria-label="Rincian pemeriksaan data"><h3>Yang perlu diperiksa <span className="review-count">{items.length}</span></h3><p>Lengkapi dari informasi lapangan yang terkonfirmasi. Nilai kosong tetap berarti belum diketahui.</p>
    {groups.map(group=>{const matches=items.filter(item=>item.kind===group.kind);return matches.length?<div className={`review-group ${group.kind}`} key={group.kind}><h4>{group.title}</h4><ul>{matches.map((item,index)=><li key={`${item.field}:${index}`}>{item.text}</li>)}</ul></div>:null;})}
  </section>;
}
