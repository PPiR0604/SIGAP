import React,{lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {StartupScreen} from './StartupScreen';
import '../styles/globals.css';
import './styles.css';
import './markdown.css';
import './chatDock.css';
import './ux-refresh.css';
import './boardui-sigap.css';
import {DirectionProvider} from '@/components/foundations/direction/direction';
import {OfflinePage} from './OfflineReports';

const AuthGate=lazy(()=>import('./AuthGate').then(module=>({default:module.AuthGate})));
const PublicBulletin=lazy(()=>import('./PublicBulletin').then(module=>({default:module.PublicBulletin})));
const publicPage=location.pathname.startsWith('/publikasi/');
const offlinePage=location.pathname==='/offline';
if(import.meta.env.PROD&&'serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{});});
createRoot(document.getElementById('root')!).render(<React.StrictMode><DirectionProvider locale="id-ID">{offlinePage?<OfflinePage/>:<StartupScreen><Suspense fallback={<p role="status">Memuat halaman…</p>}>{publicPage?<PublicBulletin/>:<AuthGate/>}</Suspense></StartupScreen>}</DirectionProvider></React.StrictMode>);
