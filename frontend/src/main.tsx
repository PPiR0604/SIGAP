import React,{lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {StartupScreen} from './StartupScreen';
import './styles.css';
import './markdown.css';
import './chatDock.css';
import './ux-refresh.css';

const AuthGate=lazy(()=>import('./AuthGate').then(module=>({default:module.AuthGate})));
const PublicBulletin=lazy(()=>import('./PublicBulletin').then(module=>({default:module.PublicBulletin})));
const publicPage=location.pathname.startsWith('/publikasi/');
createRoot(document.getElementById('root')!).render(<React.StrictMode><StartupScreen><Suspense fallback={<p role="status">Memuat halaman…</p>}>{publicPage?<PublicBulletin/>:<AuthGate/>}</Suspense></StartupScreen></React.StrictMode>);
