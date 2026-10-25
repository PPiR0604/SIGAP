import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadGeminiSettings} from '../src/gemini/config.js';
import {loadOpenAISettings} from '../src/openai/config.js';

function withEnv(values:Record<string,string|undefined>,run:()=>void){
  const previous=Object.fromEntries(Object.keys(values).map(name=>[name,process.env[name]]));
  try{for(const [name,value] of Object.entries(values))if(value===undefined)delete process.env[name];else process.env[name]=value;run();}
  finally{for(const [name,value] of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
test('Gemini settings use environment only, including an explicitly empty key and zero quota limit',()=>withEnv({GEMINI_API_KEY:' synthetic-test-key ',GEMINI_MODEL:'gemini-3.8-flash',SIGAP_GEMINI_TPM_LIMIT:'120000',SIGAP_GEMINI_CONFIG_PATH:'ignored-legacy.json',SIGAP_DOCKER:'1'},()=>{
  assert.deepEqual(loadGeminiSettings(),{apiKey:'synthetic-test-key',model:'gemini-3.8-flash',tpmLimit:120000});
  process.env.GEMINI_API_KEY='';assert.equal(loadGeminiSettings().apiKey,'');
  process.env.SIGAP_GEMINI_TPM_LIMIT='0';assert.equal(loadGeminiSettings().tpmLimit,0);
  process.env.SIGAP_GEMINI_TPM_LIMIT='-1';assert.throws(()=>loadGeminiSettings());
  process.env.SIGAP_GEMINI_TPM_LIMIT='200000';process.env.GEMINI_MODEL='invalid-private-value';
  assert.throws(()=>loadGeminiSettings(),error=>!String(error).includes('invalid-private-value'));
}));
test('proxy settings use environment only and remap localhost for Docker without changing credentials',()=>withEnv({SIGAP_OPENAI_BASE_URL:'http://localhost:20128/v1/',SIGAP_OPENAI_MODEL:'ag/gemini-3.8-flash-high',SIGAP_OPENAI_API_KEY:' synthetic-proxy-key ',SIGAP_OPENAI_CONFIG_PATH:'ignored-legacy.json',SIGAP_DOCKER:'1'},()=>{
  assert.deepEqual(loadOpenAISettings(),{baseUrl:'http://host.docker.internal:20128/v1',model:'ag/gemini-3.8-flash-high',apiKey:'synthetic-proxy-key'});
  process.env.SIGAP_OPENAI_API_KEY='';assert.equal(loadOpenAISettings().apiKey,'');
  process.env.SIGAP_DOCKER='0';assert.equal(loadOpenAISettings().baseUrl,'http://localhost:20128/v1');
  process.env.SIGAP_OPENAI_BASE_URL='http://private:secret@localhost:20128/v1';
  assert.throws(()=>loadOpenAISettings(),error=>!String(error).includes('secret'));
}));
