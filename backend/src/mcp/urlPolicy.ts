const localHosts=new Set(['localhost','127.0.0.1','[::1]','host.docker.internal']);

/** Connection targets come from operator configuration, never model/tool arguments. */
export function validateMcpUrl(value:string,allowlist=process.env.SIGAP_MCP_ALLOWED_ORIGINS||''):URL {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('MCP URL harus loopback atau origin HTTPS yang diizinkan, tanpa credential, query atau fragment.');
  const allowed=allowlist.split(',').map(s=>s.trim()).filter(Boolean).map(value=>{
    const origin=new URL(value);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('SIGAP_MCP_ALLOWED_ORIGINS harus berupa origin HTTPS lengkap.');
    return origin.origin;
  });
  if(localHosts.has(url.hostname))return url;
  if(url.protocol!=='https:'||!allowed.includes(url.origin))throw new Error('MCP URL harus loopback atau origin HTTPS yang tercantum di SIGAP_MCP_ALLOWED_ORIGINS.');
  return url;
}
