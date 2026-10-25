export class ModelProviderError extends Error {
  constructor(readonly code:string,message:string,readonly temporary=false){super(message);this.name='ModelProviderError';}
}
