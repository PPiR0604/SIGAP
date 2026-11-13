type Context = {context_id:string};
const key=(userId:string,organizationId:string|null)=>`sigap:context:${JSON.stringify([organizationId,userId])}`;

/** A preference selects only among the assignments freshly returned by the server. */
export function preferredContext(userId:string,organizationId:string|null,available:Context[]):string {
  let saved:string|null=null;
  try { saved=sessionStorage.getItem(key(userId,organizationId)); } catch { /* Storage is optional. */ }
  return available.find(context=>context.context_id===saved)?.context_id||available[0]?.context_id||'';
}
export function rememberContext(userId:string,organizationId:string|null,contextId:string):void {
  try {
    if(contextId)sessionStorage.setItem(key(userId,organizationId),contextId);
    else sessionStorage.removeItem(key(userId,organizationId));
  } catch { /* A blocked preference must not prevent access to assigned operations. */ }
}
