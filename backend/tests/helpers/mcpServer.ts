import { createServer, type IncomingMessage } from 'node:http';
export async function mcpServer(handler?: (request:any, response:any, http:IncomingMessage)=>void){
  const requests:any[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const message=JSON.parse(body);requests.push({...message,headers:req.headers});
    if(handler){handler(message,res,req);return;}
    res.setHeader('content-type','application/json');
    if(message.method==='initialize'){
      res.setHeader('mcp-session-id','session-one');
      res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}}));
    }else if(message.method==='notifications/initialized'){res.writeHead(202);res.end();}
    else if(message.method==='tools/list')res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'sigap_1_prepare_needs',inputSchema:{type:'object',properties:{input_value:{type:'string'}}}}]}}));
    else res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'ok'}]}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};
  return {url:`http://127.0.0.1:${address.port}/mcp`,requests,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
