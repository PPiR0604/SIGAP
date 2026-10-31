import {useEffect,useState} from 'react';
export function useActivityClock(active:boolean){const [seconds,setSeconds]=useState(0);useEffect(()=>{setSeconds(0);if(!active)return;const start=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[active]);return seconds;}
