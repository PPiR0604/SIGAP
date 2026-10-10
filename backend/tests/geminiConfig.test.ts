import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {loadGeminiSettings} from '../src/gemini/config.js';
test('Gemini local key is backend-only and environment values override it',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sigap-gemini-')),file=join(dir,'config.json');
  const previous={tpm:process.env.SIGAP_GEMINI_TPM_LIMIT,key:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL,path:process.env.SIGAP_GEMINI_CONFIG_PATH};
  try{
    process.env.SIGAP_GEMINI_CONFIG_PATH=file;delete process.env.GEMINI_API_KEY;delete process.env.GEMINI_MODEL;
    assert.equal(loadGeminiSettings().apiKey,'');
    writeFileSync(file,JSON.stringify({apiKey:'local-test-key',model:'gemini-3.8-flash'}));
    assert.equal(loadGeminiSettings().apiKey,'local-test-key');
    process.env.GEMINI_API_KEY='env-test-key';process.env.GEMINI_MODEL='gemini-3.5-flash-lite';
    assert.deepEqual(loadGeminiSettings(),{apiKey:'env-test-key',model:'gemini-3.5-flash-lite',tpmLimit:200000});
    process.env.SIGAP_GEMINI_TPM_LIMIT='120000';assert.equal(loadGeminiSettings().tpmLimit,120000);
    process.env.SIGAP_GEMINI_TPM_LIMIT='-5';assert.throws(()=>loadGeminiSettings());
    delete process.env.SIGAP_GEMINI_TPM_LIMIT;
    writeFileSync(file,'{ secret invalid');assert.throws(()=>loadGeminiSettings(),error=>!String(error).includes('secret'));
  }finally{
    for(const [name,value] of Object.entries({GEMINI_API_KEY:previous.key,GEMINI_MODEL:previous.model,SIGAP_GEMINI_CONFIG_PATH:previous.path,SIGAP_GEMINI_TPM_LIMIT:previous.tpm}))if(value===undefined)delete process.env[name];else process.env[name]=value;
    rmSync(dir,{recursive:true,force:true});
  }
});
