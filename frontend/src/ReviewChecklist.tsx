import type {CSSProperties} from 'react';
import { AlertTriangle, ClipboardList, PackageSearch, Scale, ChevronDown } from 'lucide-react';
import type {ReviewItem,ReviewKind} from './reviewIndicators';
const groups:{kind:ReviewKind;title:string}[]=[{kind:'clarification',title:'Perlu klarifikasi'},{kind:'missing',title:'Data belum dilaporkan'},{kind:'decision',title:'Perlu keputusan petugas'},{kind:'stock',title:'Kelengkapan data stok'}];
const icons = { clarification: AlertTriangle, missing: ClipboardList, decision: Scale, stock: PackageSearch };
const missingStock = (item:ReviewItem) => /^Stok (.+) belum dilaporkan; kekurangan belum dapat dipastikan\.$/.exec(item.text)?.[1];
export function ReviewChecklist({items=[],onResolve}:{items?:ReviewItem[];onResolve?:(field:string)=>void}){
  if(!items.length)return null;
  return <section className="review-indicators" aria-label="Rincian pemeriksaan data"><details open><summary className="review-heading"><span className="review-heading-title">Yang perlu diperiksa <span className="review-count">{items.length} catatan</span></span><span className="review-disclosure-label"><span className="review-show">Lihat</span><span className="review-hide">Ciutkan</span> <ChevronDown size={15} className="review-chevron" aria-hidden="true"/></span></summary>
    <div className="review-content-body">
    {groups.map((group,gIdx)=>{
      const matches=items.filter(item=>item.kind===group.kind);
      if(!matches.length)return null;
      const Icon=icons[group.kind];
      const compact=matches.filter(item=>group.kind==='missing' || (group.kind==='stock' && missingStock(item)));
      const details=matches.filter(item=>!compact.includes(item));
      return <div className={`review-group ${group.kind}`} key={group.kind} style={{'--group-idx':gIdx} as CSSProperties}>
        <h4><Icon size={17} aria-hidden="true"/><span>{group.title}</span><span className="review-group-count">{matches.length}</span></h4>
        {compact.length>0 && <>
          {group.kind==='stock' && <p className="review-group-caption">Stok belum dilaporkan</p>}
          <ul className="review-tags">{compact.map((item,index)=><li key={`${item.field}:${index}`}>{onResolve?<button type="button" onClick={()=>onResolve(item.field)}>{group.kind==='stock'?missingStock(item):item.text.replace(/ belum dilaporkan\.$/,'')} · Lengkapi</button>:group.kind==='stock' ? missingStock(item) : item.text.replace(/ belum dilaporkan\.$/,'')}</li>)}</ul>
          {group.kind==='stock' && <p className="review-group-help">Kekurangan belum dapat dipastikan tanpa data stok.</p>}
        </>}
        {details.length>0 && <ul className="review-details">{details.map((item,index)=><li key={`${item.field}:${index}`}>{item.text}{onResolve&&<button className="button quiet" type="button" onClick={()=>onResolve(item.field)}>Periksa data</button>}</li>)}</ul>}
      </div>;
    })}
    </div>
  </details></section>;
}
