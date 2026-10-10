export interface McpTool {name:string; description?:string; inputSchema:Record<string,unknown>}
export interface McpToolResult {content:Array<{type:string;text?:string}>;isError?:boolean;structuredContent?:unknown}
export interface McpHttpSettings {url:string;headers:Record<string,string>;timeoutMs?:number}

export class McpHttpClient {
  private id=0;
  private session='';
  private protocol='';
  private lifetime=new AbortController();
  private url:URL;
  constructor(private settings:McpHttpSettings){
    this.url=new URL(settings.url);
    if(!['http:','https:'].includes(this.url.protocol)||!['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(this.url.hostname)||this.url.username||this.url.password)throw new Error('MCP URL harus loopback HTTP.');
  }
  async initialize(signal?:AbortSignal):Promise<void>{
    const result=await this.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'sigap-backend',version:'0.1.0'}},signal);
    if(typeof result?.protocolVersion!=='string')throw new Error('MCP initialize: protocol tidak valid.');
    this.protocol=result.protocolVersion;
    await this.request('notifications/initialized',{},signal,true);
  }
  async listTools(signal?:AbortSignal):Promise<McpTool[]>{
    const tools:McpTool[]=[];const seen=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<10;page++){
      const result=await this.request('tools/list',cursor?{cursor}:{},signal);
      if(!Array.isArray(result?.tools))throw new Error('MCP tools/list: schema tidak valid.');
      for(const tool of result.tools){
        if(typeof tool?.name!=='string'||!tool.inputSchema||typeof tool.inputSchema!=='object'||Array.isArray(tool.inputSchema)||tools.some(t=>t.name===tool.name))throw new Error('MCP tools/list: tool tidak valid.');
        tools.push(tool);
      }
      cursor=result.nextCursor;
      if(!cursor)return tools;
      if(typeof cursor!=='string'||seen.has(cursor))throw new Error('MCP pagination tidak valid.');
      seen.add(cursor);
    }
    throw new Error('MCP pagination melebihi batas.');
  }
  async callTool(name:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<McpToolResult>{
    const result=await this.request('tools/call',{name,arguments:args},signal);
    if(!Array.isArray(result?.content))throw new Error('MCP tools/call: hasil tidak valid.');
    return result;
  }
  async close():Promise<void>{this.lifetime.abort();}

  private async request(method:string,params:unknown,signal?:AbortSignal,notification=false):Promise<any>{
    const id=++this.id;
    const headers={...this.settings.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream',
      ...(this.session?{'Mcp-Session-Id':this.session}:{}),...(this.protocol?{'MCP-Protocol-Version':this.protocol}:{})};
    const combined=AbortSignal.any([this.lifetime.signal,AbortSignal.timeout(this.settings.timeoutMs??120000),...(signal?[signal]:[])]);
    try{
      const response=await fetch(this.url,{method:'POST',redirect:'error',headers,signal:combined,body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id}:{}),method,params})});
      if(!response.ok){await response.body?.cancel();throw new Error(`MCP ${method}: HTTP ${response.status}.`);}
      if(method==='initialize')this.session=response.headers.get('mcp-session-id')||'';
      if(notification){await response.body?.cancel();return;}
      if(!response.body)throw new Error(`MCP ${method}: respons kosong.`);
      const sse=response.headers.get('content-type')?.includes('text/event-stream');
      if(!sse&&!response.headers.get('content-type')?.includes('application/json'))throw new Error(`MCP ${method}: content type tidak valid.`);
      const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',bytes=0;
      const result=(message:any)=>{
        if(!message||message.id!==id)throw new Error(`MCP ${method}: ID respons tidak sesuai.`);
        if(message.error)throw new Error(`MCP ${method}: JSON-RPC gagal.`);
        if(!Object.hasOwn(message,'result'))throw new Error(`MCP ${method}: hasil kosong.`);
        return message.result;
      };
      try{
        while(true){
          const {value,done}=await reader.read();bytes+=value?.byteLength??0;
          if(bytes>2*1024*1024)throw new Error(`MCP ${method}: respons melebihi batas.`);
          buffer+=decoder.decode(value,{stream:!done});
          if(sse){
            let separator:RegExpExecArray|null;
            while((separator=/\r?\n\r?\n/.exec(buffer))){
              const frame=buffer.slice(0,separator.index);buffer=buffer.slice(separator.index+separator[0].length);
              const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
              if(!data)continue;
              const message=JSON.parse(data);
              if(message?.id===id)return result(message);
            }
          }
          if(done){if(!sse)return result(JSON.parse(buffer));throw new Error(`MCP ${method}: respons SSE belum lengkap.`);}
        }
      }finally{await reader.cancel().catch(()=>{});}
    }catch(error){
      if(error instanceof Error&&/^MCP [a-z/]+:|^MCP pagination/.test(error.message))throw error;
      throw new Error(`MCP ${method}: request gagal atau timeout.`);
    }
  }
}
