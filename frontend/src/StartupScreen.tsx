import { useEffect, useState, type ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';
import './startup.css';

export function StartupScreen({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const ready = () => setVisible(false);
    window.addEventListener('sigap-ready', ready);
    // A failed connection must never trap the operator behind the splash.
    const timer = window.setTimeout(ready, 5000);
    return () => { window.clearTimeout(timer); window.removeEventListener('sigap-ready', ready); };
  }, []);
  return <>
    <div inert={visible} aria-hidden={visible || undefined}>{children}</div>
    {visible && <section className="startup-screen" aria-label="Selamat datang di SIGAP" aria-busy="true">
      <div className="startup-content"><BrandLogo full />
        <p className="startup-name">Sistem Intelijen Logistik<br />dan Asisten Posko</p>
        <div className="startup-status" role="status"><span className="startup-loader" aria-hidden="true" /><span>Menyiapkan ruang kerja…</span></div>
      </div>
      <p className="startup-caption">Informasi terarah. Respons lebih sigap.</p>
    </section>}
  </>;
}
