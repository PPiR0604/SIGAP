export class ToolValidationError extends Error {
  readonly reason:string;
  constructor(reason:string){
    const bounded=reason.slice(0,1000);
    super('Tool MCP validasi gagal: '+bounded);
    this.name='ToolValidationError';
    this.reason=bounded;
  }
}
