// Live read-only probe: synthetic data only; never prints credentials or user data.
import '../src/config.js';
import {createWatsonxClient,loadWatsonxSettings} from '../src/watsonx/runtime.js';
import {extractionPrompt} from '../src/gemini/extractionPrompt.js';
import {parseExtraction} from '../src/gemini/extraction.js';

const client=createWatsonxClient(loadWatsonxSettings());
const signal=AbortSignal.timeout(120000);
try {
  const extraction=await client.generate([{role:'user',parts:[{text:'Ekstrak laporan sintetis: Posko Melati memiliki 75 pengungsi; stok air belum dilaporkan. Jawab dalam JSON dengan kunci posko, pengungsi, stok_air. Isi null untuk stok yang belum diketahui.'}]}],[],'Jawab singkat dan jangan mengarang data.',signal);
  console.log('Ekstraksi sintetis:',JSON.stringify(extraction.parts));
  const realistic=await client.generate([{role:'user',parts:[{text:'[R001] Posko Melati di Desa Cisarua memiliki 75 pengungsi. Stok air belum dilaporkan.'}]}],[],extractionPrompt,signal);
  const content=realistic.parts.map(p=>typeof p.text==='string'?p.text:'').join('\n');
  const records=parseExtraction(content,new Set(['R001']),200000);
  if(records[0].total_people!==75 || records[0].report_id!=='R001')throw new Error('Ekstraksi tidak mempertahankan angka atau ID laporan sintetis.');
  const stock=records[0].stock as Record<string,unknown>|null|undefined;
  if(stock?.air_liter_per_hari!=null)throw new Error('Stok yang tidak dilaporkan tidak boleh menjadi angka.');
  console.log('Prompt dan validator ekstraksi SIGAP: berhasil.');
  const prompt={role:'user' as const,parts:[{text:'Gunakan tool read_shelter untuk mengambil data posko sintetis dengan id MELATI.'}]};
  const tools=[{name:'read_shelter',description:'Membaca data posko sintetis berdasarkan ID.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}}];
  const call=await client.generate([prompt],tools,'Panggil tool yang diminta pengguna.',signal);
  const functionCall=call.parts.find(p=>p.functionCall)?.functionCall as {id?:string;name?:string;args?:{id?:string}}|undefined;
  if(functionCall?.name!=='read_shelter'||functionCall.args?.id!=='MELATI'||!functionCall.id)throw new Error('Model tidak menghasilkan pemanggilan tool yang diharapkan.');
  const result={role:'user' as const,parts:[{functionResponse:{id:functionCall.id,name:functionCall.name,response:{result:{posko:'Melati',total_people:75}}}}]};
  const answer=await client.generate([prompt,call,result],tools,'Gunakan hasil tool untuk menjawab pengguna.',signal);
  const answerText=answer.parts.map(p=>typeof p.text==='string'?p.text:'').join(' ');
  if(!answerText.includes('75'))throw new Error('Model tidak menyampaikan jumlah dari respons tool sintetis.');
  console.log('Siklus tool sintetis: berhasil; tool nyata tidak dijalankan.');
} catch (error) {
  console.error('Uji watsonx gagal:',error instanceof Error?error.message:'kesalahan tidak diketahui');
  process.exitCode=1;
}
