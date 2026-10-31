import {useEffect,useRef,useState} from 'react';
import {Copy,Printer,ShieldCheck,ArrowUpRight} from 'lucide-react';
import {BrandLogo} from './BrandLogo';
import {PublicBulletinContent,type PublicBulletinData} from './PublicBulletinContent';
import './public-bulletin.css';

export function PublicBulletin(){
 const [data,setData]=useState<PublicBulletinData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0),[copied,setCopied]=useState(false);
 const heading=useRef<HTMLHeadingElement>(null);
 const token=/^\/publikasi\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname)?.[1];
 useEffect(()=>{let active=true;const controller=new AbortController();setLoading(true);setError('');
  (async()=>{try{
   if(!token)throw new Error('Tautan tidak tersedia. Minta tautan publikasi terbaru dari pengirim.');
   const response=await fetch(`/api/public/bulletins/${token}`,{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   if(response.status===404)throw new Error('Tautan tidak tersedia atau sudah dinonaktifkan. Minta tautan terbaru dari pengirim.');
   if(!response.ok)throw new Error(response.status===429?'Terlalu sering memuat halaman. Tunggu sebentar, lalu coba lagi.':'Publikasi belum dapat dimuat. Coba lagi sebentar.');
   const value=await response.json();if(value.schema_version!=='sigap-public-bulletin-v1'||!Array.isArray(value.records))throw new Error('Publikasi belum dapat dibaca.');
   if(active){setData(value);document.title=`Buletin ${value.context_name} — SIGAP`;}
  }catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Publikasi belum dapat dimuat.');}
  finally{if(active){setLoading(false);window.dispatchEvent(new Event('sigap-ready'));}}
  })();return()=>{active=false;controller.abort();};
 },[token,reload]);
 useEffect(()=>{if(!loading)heading.current?.focus({preventScroll:true});},[loading]);
 async function copy(){try{await navigator.clipboard.writeText(location.href);setCopied(true);}catch{setError('Salin tautan dari bilah alamat browser Anda.');}}
 return <div className="public-bulletin-page"><a className="skip-link" href="#public-main">Langsung ke buletin</a>
  <header className="public-site-header"><a className="public-brand" href="/" aria-label="SIGAP beranda"><BrandLogo/><strong>SIGAP<span>Publikasi kebutuhan posko</span></strong></a><span className="badge success"><ShieldCheck size={15} aria-hidden="true"/>Akses publik</span></header>
  <main id="public-main" className="public-main">
   <div className="public-page-heading"><div><p className="location">BULETIN LOGISTIK</p><h1 ref={heading} tabIndex={-1}>{data?.context_name||'Publikasi SIGAP'}</h1><p>{data?'Versi publikasi yang disetujui admin.':'Baca buletin tanpa masuk atau membuat akun.'}</p></div>{data&&<div className="public-page-actions"><button className="button secondary" onClick={()=>void copy()}><Copy size={16} aria-hidden="true"/>{copied?'Tautan disalin':'Salin tautan'}</button><button className="button secondary" onClick={()=>window.print()}><Printer size={16} aria-hidden="true"/>Cetak</button></div>}</div>
   {loading&&<section className="card" role="status">Memuat publikasi…</section>}
   {error&&<section className="card public-error" role="alert"><h2>{data?'Tautan publikasi':'Publikasi belum tersedia'}</h2><p>{error}</p>{!data&&token&&<button className="button secondary" onClick={()=>setReload(n=>n+1)}>Coba lagi</button>}</section>}
   {data&&<PublicBulletinContent data={data}/>}
   <footer className="public-footer"><span>Data mengikuti versi saat diterbitkan.</span><a href="/">Ruang kerja petugas <ArrowUpRight size={14} aria-hidden="true"/></a></footer>
  </main>
 </div>;
}
