import {useCallback,useEffect,useState} from 'react';
type MainPage='Tugas'|'Laporan'|'Rekap'|'Buletin';
export type Page=MainPage|'Klarifikasi';
export const pages:MainPage[]=['Tugas','Laporan','Rekap','Buletin'];
const read=()=>{const url=new URL(location.href),value=url.searchParams.get('view');return {page:(value==='Klarifikasi'||pages.includes(value as MainPage)?value:'Tugas') as Page,shelterKey:url.searchParams.get('posko')};};
export function useWorkspaceNavigation(){
 const [route,update]=useState(read);
 useEffect(()=>{const changed=()=>{update(read());window.dispatchEvent(new Event('sigap-page-changed'));};window.addEventListener('popstate',changed);return()=>window.removeEventListener('popstate',changed);},[]);
 const navigate=useCallback((next:Page,options?:{shelterKey?:string;replace?:boolean})=>{
  const url=new URL(location.href),previous=url.searchParams.get('view');url.searchParams.set('view',next);
  if(next==='Klarifikasi'&&options?.shelterKey)url.searchParams.set('posko',options.shelterKey);else url.searchParams.delete('posko');
  if(url.href!==location.href){
   const state=next==='Klarifikasi'?{sigapClarification:true,returnTo:history.state?.returnTo||(previous&&previous!=='Klarifikasi'?previous:'Rekap')}:null;
   if(options?.replace)history.replaceState(state,'',url);else history.pushState(state,'',url);
   window.dispatchEvent(new Event('sigap-page-changed'));
  }
  update(read());
 },[]);
 const backFromClarification=useCallback(()=>{if(history.state?.sigapClarification)history.back();else navigate('Rekap');},[navigate]);
 return [route.page,navigate,route.shelterKey,backFromClarification] as const;
}
