export interface HealthResponse {
  agent?: 'gemini' | 'openai' | 'bob' | 'mock';
  model?:string;
  provider_status?: 'configured' | 'unavailable' | 'simulated';
  status: string;
  backend: string;
  bob: string;
  storage: string;
  write_enabled: boolean;
  mode: 'live' | 'mock_mode' | 'degraded';
  session_token?: string;
}

export interface SessionResponse {
  session_id: string;
  context_id: string;
  created_at: string;
}

export interface MessageResponse {
  batch_id: string;
  status: string;
  filtered_text: string;
  pii_summary: {
    nikCount: number;
    phoneCount: number;
    emailCount: number;
    bankCount: number;
    totalRedacted: number;
  };
}

export interface BatchStateResponse {
  batch_id: string;
  session_id: string;
  context_id: string;
  status: string;
  latest_snapshot_id: string | null;
  latest_snapshot_sha256: string | null;
  quality_status: string | null;
  preview: any;
  gap: any;
  bulletin: any;
  created_at: string;
  updated_at: string;
}

export interface AuthProfile {user_id:string;display_name:string;organization_id:string|null;role:'admin'|'petugas'|'viewer'|null;status:'pending'|'active'|'disabled';scopes:string[]}
export interface AuthSession {access_token:string;refresh_token:string;expires_at?:number;expires_in?:number;profile:AuthProfile}
let activeSessionToken='';
let authSession:AuthSession|null=null;
let refreshPromise:Promise<string>|null=null;
const authKey='sigap_auth_session';
export function getSessionToken():string {return activeSessionToken;}
export function setSessionToken(token:string):void {activeSessionToken=token;try{if(token)localStorage.setItem('sigap_token',token);else localStorage.removeItem('sigap_token');}catch{/* Storage is optional. */}}
export function clearAuthSession(){authSession=null;setSessionToken('');try{sessionStorage.removeItem(authKey);for(const key of Object.keys(sessionStorage))if(key.startsWith('sigap:clarification:'))sessionStorage.removeItem(key);}catch{} }
function acceptSession(session:AuthSession){
  session.expires_at=session.expires_at??Math.floor(Date.now()/1000)+(session.expires_in??3600);
  authSession=session;activeSessionToken=session.access_token;
  try{sessionStorage.setItem(authKey,JSON.stringify(session));localStorage.removeItem('sigap_token');}catch{}
  return session;
}
export class HttpResponseError extends Error {constructor(message:string,public status:number){super(message);this.name='HttpResponseError';}}
async function parseResponse(res:Response):Promise<any>{
  if(res.status===204)return null;
  const body=await res.json().catch(()=>({}));
  if(!res.ok){const code=body?.error?.code;const messages:Record<string,string>={UNAUTHORIZED:'Sesi berakhir. Silakan masuk kembali.',SESSION_REVOKED:'Sesi dicabut. Silakan masuk kembali.',ACCOUNT_INACTIVE:'Akun belum aktif. Hubungi admin.',SCOPE_DENIED:'Anda belum ditugaskan ke pos komando ini.',READ_ONLY_ROLE:'Akun ini hanya dapat membaca publikasi.',RATE_LIMITED:'Terlalu banyak percobaan. Tunggu sebentar.'};throw new HttpResponseError(messages[code]||body?.error?.message||`Permintaan gagal (${res.status}${code?`: ${code}`:''}).`,res.status);}
  return body;
}
export async function login(email:string,password:string):Promise<AuthSession>{return acceptSession(await parseResponse(await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})})));}
export async function refreshAuthToken():Promise<string>{
  if(!authSession)return activeSessionToken;
  if(refreshPromise)return refreshPromise;
  const current=authSession;
  refreshPromise=(async()=>{
    const res=await fetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token})});
    if(!res.ok){if([400,401,403].includes(res.status)){clearAuthSession();window.dispatchEvent(new Event('sigap-auth-expired'));}await parseResponse(res);}
    const next=await res.json();if(authSession!==current)throw new Error('Sesi telah berubah.');acceptSession(next);return next.access_token;
  })().finally(()=>{refreshPromise=null;});return refreshPromise;
}
export async function restoreAuthSession():Promise<AuthSession|null>{
  try{const saved=sessionStorage.getItem(authKey);if(!saved)return null;const parsed=JSON.parse(saved);if(!parsed.access_token||!parsed.refresh_token)return null;authSession=parsed;activeSessionToken=parsed.access_token;
    await ensureSessionToken();const result=await authenticatedRequest('/api/auth/me');authSession!.profile=result.profile;return authSession;
  }catch(error){if(!authSession)return null;throw error;}
}
export async function logout(){try{await authenticatedRequest('/api/auth/logout',{method:'POST'});}finally{clearAuthSession();}}
export async function checkBackendHealth():Promise<HealthResponse|null>{try{const res=await fetch('/api/health');if(!res.ok)return null;const data=await res.json();if(data.session_token)setSessionToken(data.session_token);return data;}catch{return null;}}
export async function ensureSessionToken():Promise<string>{if(authSession){if((authSession.expires_at??0)*1000<=Date.now()+60000)return refreshAuthToken();return activeSessionToken;}return activeSessionToken;}
export async function fetchSessionToken():Promise<string>{await checkBackendHealth();return activeSessionToken;}
export async function authenticatedRequest(url:string,options:RequestInit={}):Promise<any>{
  let token=await ensureSessionToken();
  const request=()=>fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers,...(token?{Authorization:`Bearer ${token}`}:{})}});
  let res=await request();
  if(res.status===401&&authSession){token=await refreshAuthToken();res=await request();}
  if(res.status===401&&authSession){clearAuthSession();window.dispatchEvent(new Event('sigap-auth-expired'));}
  return parseResponse(res);
}
export async function createBackendSession(contextId='posko-sumedang'):Promise<SessionResponse>{return authenticatedRequest('/api/sessions',{method:'POST',body:JSON.stringify({context_id:contextId,resume:true})});}
export async function sendBackendMessage(sessionId:string,text:string,filename?:string,correction?:unknown):Promise<MessageResponse>{return authenticatedRequest(`/api/sessions/${sessionId}/messages`,{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),text,filename,...(correction?{correction}:{})})});}
export interface DocumentExtraction {text:string;filename:string;pages:number;engine:'tesseract';source_sha256:string;warnings:string[]}
export async function extractReportDocument(sessionId:string,file:File,signal:AbortSignal):Promise<DocumentExtraction>{
 return authenticatedRequest(`/api/sessions/${encodeURIComponent(sessionId)}/documents/extract`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Document-Name':encodeURIComponent(file.name)},body:file,signal});
}
export async function getBatchState(batchId:string):Promise<BatchStateResponse>{return authenticatedRequest(`/api/batches/${batchId}`);}
export async function submitBatchDecision(batchId:string,decision:{action:'approve_save'|'approve_partial_save'|'back_to_review';snapshot_id:string;partial_acknowledged:boolean;clear_decisions:Record<string,Record<string,'clear'|'keep'|'defer'>>;conflict_decisions?:Record<string,Record<string,'keep'|'incoming'>>}):Promise<{success:boolean;status:string}>{return authenticatedRequest(`/api/batches/${batchId}/decisions`,{method:'POST',body:JSON.stringify(decision)});}
