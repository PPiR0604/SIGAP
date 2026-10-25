import {useEffect,useState,type ReactNode} from 'react';
import {BrandLogo} from './BrandLogo';
import './startup.css';

export function StartupScreen({children}:{children:ReactNode}){
  const [visible,setVisible]=useState(true);
  useEffect(()=>{
    // The app initializes underneath; provider/network failures never trap users here.
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer=window.setTimeout(()=>setVisible(false),reduced?600:1400);
    return()=>window.clearTimeout(timer);
  },[]);
  return <>
    <div inert={visible} aria-hidden={visible||undefined}>{children}</div>
    {visible&&<section className="startup-screen" aria-label="Selamat datang di SIGAP" aria-busy="true">
      <div className="startup-content"><BrandLogo full/>
        <p className="startup-name">Sistem Intelijen Logistik<br/>dan Asisten Posko</p>
        <div className="startup-status" role="status"><span className="startup-loader" aria-hidden="true"/><span>Menyiapkan ruang kerja…</span></div>
      </div>
      <p className="startup-caption">Informasi terarah. Respons lebih sigap.</p>
    </section>}
  </>;
}
