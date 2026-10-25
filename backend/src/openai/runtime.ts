import {GeminiAgentRuntime,type GeminiRuntimeLimits} from '../gemini/runtime.js';
import type {GeminiModelClient} from '../gemini/client.js';
import {OpenAIChatClient} from './client.js';
import type {OpenAISettings} from './config.js';

/** Reuse the audited MCP, source-binding and approval loop with a different transport. */
export class OpenAICompatibleRuntime extends GeminiAgentRuntime {
  override readonly provider='openai' as const;
  constructor(settings:OpenAISettings,client?:GeminiModelClient,limits:Partial<GeminiRuntimeLimits>={}){
    super({apiKey:settings.apiKey||'local-no-auth',model:settings.model,tpmLimit:0},client??new OpenAIChatClient(settings),limits);
  }
}
