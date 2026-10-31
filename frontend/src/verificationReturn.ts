/** Old email links are cleaned without granting access or offering the removed resend flow. */
export function verificationReturn(href:string):{error:string;message:string;isCallback:boolean}{
 const hash=new URLSearchParams(new URL(href).hash.slice(1));
 const isCallback=['error','error_code','access_token','refresh_token'].some(key=>hash.has(key));
 return {isCallback,error:'',message:isCallback?'Tautan email lama tidak diperlukan. Silakan masuk dengan email dan kata sandi akun Anda.':''};
}

// Clean credential fragments once, before rendering or starting network requests.
export function consumeRecoveryReturn(){
  const url=new URL(window.location.href),hash=new URLSearchParams(url.hash.slice(1));
  const isCallback=url.searchParams.get('auth')==='recovery'||hash.get('type')==='recovery';
  if(!isCallback)return {isCallback:false,token:'',error:''};
  const value=hash.get('access_token')||'';
  const token=!hash.has('error')&&!hash.has('error_code')&&hash.get('type')==='recovery'&&/^[A-Za-z0-9._-]{20,8192}$/.test(value)?value:'';
  url.searchParams.delete('auth');
  window.history.replaceState(window.history.state,'',url.pathname+url.search);
  return {isCallback:true,token,error:token?'':'Tautan pemulihan tidak valid atau sudah kedaluwarsa. Minta tautan baru dengan email pendaftaran Anda.'};
}

export function consumeVerificationReturn(){
  const result=verificationReturn(window.location.href);
  if(result.isCallback)window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
  return result;
}
