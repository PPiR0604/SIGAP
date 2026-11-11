import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';

const root=resolve('dist');
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())result.push(...await files(path));else result.push('/'+relative(root,path).split(sep).join('/'));}return result;}
const assets=(await files(resolve(root,'assets'))).sort();
const precache=['/index.html',...assets];
const version=createHash('sha256').update(await readFile(resolve(root,'index.html'))).update(JSON.stringify(assets)).digest('hex').slice(0,16);
const source=`const CACHE=${JSON.stringify('sigap-static-'+version)};
const ASSETS=${JSON.stringify(precache)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sigap-static-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/publikasi/'))return;if(request.mode==='navigate'){event.respondWith((async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch(request,{signal:controller.signal});if(response.ok)return response;return await caches.match('/index.html')||response;}catch{const cached=await caches.match('/index.html');return cached||Response.error();}finally{clearTimeout(timer);}})());return;}if(!ASSETS.includes(url.pathname))return;event.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(request)));});
`;
await writeFile(resolve(root,'sw.js'),source);
console.log(`Offline shell: ${precache.length} static assets`);
