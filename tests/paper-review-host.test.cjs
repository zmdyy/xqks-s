'use strict';
// Exercise the host integration: actual persistence, PDF byte format and MinerU transport.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function source(name){
 const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(match,name);
 const text=html.slice(match.index);
 for(let end=text.indexOf('\n');end>=0;end=text.indexOf('\n',end+1)){
  const code=text.slice(0,end);try{new vm.Script(code);return code;}catch(_){}
 }
 throw Error('Cannot extract '+name);
}
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(m[1]))new vm.Script(m[2]);
assert.match(html,/onclick="openPaperCropWorkspace\(\)"/);
const values=new Map(),elements=new Map(),storage=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},querySelector:()=>({})});return elements.get(id);};
const clone=structuredClone;
const indexedDB={open(){const r={};queueMicrotask(()=>{r.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={};tx.objectStore=()=>({put(value){values.set(value.key,clone(value.value));queueMicrotask(()=>tx.oncomplete?.());},get(key){const req={};queueMicrotask(()=>{req.result={key,value:clone(values.get(key))};req.onsuccess?.();tx.oncomplete?.();});return req;}});return tx;}};r.onsuccess?.({target:r});});return r;}};
const c={console,indexedDB,queueMicrotask,setTimeout,clearTimeout,structuredClone,Uint8Array,ArrayBuffer,DataView,TextEncoder,FormData,AbortController,URL,location:{hostname:'127.0.0.1',protocol:'http:',origin:'http://127.0.0.1:5500'},
 btoa:t=>Buffer.from(t,'binary').toString('base64'),atob:t=>Buffer.from(t,'base64').toString('binary'),
 document:{getElementById:el},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},DataPool:{batches:[]},
 updateVisionModelList(){},updateVisionModeBadge(){},DEFAULT_VISION_CONFIG:{provider:'test',model:'test',apiKey:''},VISION_PROVIDERS:{test:{}}};
c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('app-core.js','utf8'),c);
for(const n of ['normalizePdfBytes','pdfBytesToBase64','notebookPdfBytes','persistBatches','restoreBatches','saveVisionConfig','loadVisionConfig','getVisionConfig','createPdfFileFromEntry','reparsePdfFromDataMinerU','findMineruProxyBase','mineruSafeJson','parsePdfToMarkdown_MinerUPreciseProxy']){
 if(new RegExp('^(?:async )?function '+n+'\\(','m').test(html))vm.runInContext(source(n),c);
}
const bytes=new Uint8Array([37,80,68,70,45,49]);
const rec={confirmed:true,scoreColumns:['23(1)'],fileId:'pdf',fileName:'物理.pdf',regions:[{page:2,x:.1,y:.2,w:.3,h:.4}],overlapApprovals:[{signature:'geometry',reason:'共享材料'}]};
const layout={format:'middle_json',data:{pdf_info:[{page_idx:0,page_size:[600,800]}]}};
(async()=>{
 c.DataPool.batches=[{id:'exam',label:'Exam',combinedStudentData:[],uploadedPdfs:[{id:'pdf',fileName:'物理.pdf',fileData:bytes,mineruLayout:layout}],notebookCropReviews:{'["物理","23"]':rec},paperReviewStates:{'["物理","pdf"]':{completed:true}}}];
 assert.equal(await c.persistBatches(),true);c.DataPool.batches=[];await c.restoreBatches();
 const batch=c.DataPool.batches[0];assert.deepEqual(clone(batch.notebookCropReviews),{'["物理","23"]':rec});assert.equal(batch.paperReviewStates['["物理","pdf"]'].completed,true);
 assert.deepEqual(clone(batch.uploadedPdfs[0].mineruLayout),layout);assert.deepEqual(c.notebookPdfBytes(batch.uploadedPdfs[0]),bytes);
 assert.equal(c.pdfBytesToBase64(c.notebookPdfBytes(batch.uploadedPdfs[0])),Buffer.from(bytes).toString('base64'));
 const padded=new Uint8Array([9,...bytes,9]);
 for(const entry of [{fileData:bytes},{fileData:bytes.buffer},{fileData:Array.from(bytes)},{fileData:JSON.parse(JSON.stringify(bytes))},{fileDataB64:Buffer.from(bytes).toString('base64')},{fileData:new DataView(padded.buffer,1,bytes.length)}])assert.deepEqual(c.notebookPdfBytes(entry),bytes);
 el('visionProvider').value='test';el('visionModel').value='test';el('visionApiKey').value='';el('mineruToken').value='dummy-user-token';el('pdfParseMode').value='mineru_pipeline';
 c.saveVisionConfig();el('mineruToken').value='';c.loadVisionConfig();assert.equal(c.getVisionConfig().mineruToken,'dummy-user-token');assert.equal(c.getVisionConfig().mode,'mineru_pipeline');
 const urls=[];c.MINERU_API_BASE='http://127.0.0.1:8765';c.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>({ok:true,service:'xqksh-mineru-proxy'})};};
 assert.equal(await c.findMineruProxyBase(),'http://127.0.0.1:5500');assert.deepEqual(urls,['http://127.0.0.1:5500/health']);
 const calls=[];c.mineruSleep=async()=>{};c.buildQuestionIndexFromMarkdown=()=>[];c.detectSubjectByFileName=()=> '物理';
 c.fetch=async(url,opts)=>{calls.push([url,opts]);return {ok:true,text:async()=>JSON.stringify(url.endsWith('/start')?{ok:true,batch_id:'task'}:{ok:true,state:'done',markdown:'23. 题干',layout})};};
 const file=new Blob([bytes]);file.name='物理.pdf';const result=await c.parsePdfToMarkdown_MinerUPreciseProxy(file,()=>{},'http://127.0.0.1:5500','pipeline');
 assert.deepEqual(clone(result.mineruLayout),layout);assert.equal(result.mineruModel,'pipeline');assert.equal(calls[0][1].body.get('mineru_token'),'dummy-user-token');assert.equal(calls[0][1].body.get('model_version'),'pipeline');assert(calls[1][0].endsWith('/status'));
 c.createPdfFileFromEntry=()=>file;c.parsePdfToMarkdown_AutoFallback=async()=>result;
 const entry={fileName:'物理.pdf'};await c.reparsePdfFromDataMinerU(entry,'pipeline');assert.deepEqual(clone(entry.mineruLayout),layout);
 c.parsePdfToMarkdown_AutoFallback=async()=>({markdown:'fallback',questionIndex:[],source:'local'});await c.reparsePdfFromDataMinerU(entry,false);assert.equal(entry.mineruLayout,null,'old coordinates cannot survive a different parse');
 if(html.includes('async function handleDocumentFiles(')){
  vm.runInContext(source('handleDocumentFiles'),c);c.dataEpoch=0;c.uploadedPdfs=[];c.renderPdfList=()=>{};c.DataPool.syncFromGlobalsIfEditing=async()=>true;
  let selectedModel;c.parsePdfToMarkdown_AutoFallback=async(_file,_progress,model)=>{selectedModel=model;return result;};
  await c.handleDocumentFiles([file],0);assert.equal(selectedModel,'pipeline');assert.deepEqual(clone(c.uploadedPdfs[0].mineruLayout),layout);assert.deepEqual(c.uploadedPdfs[0].fileData,bytes);
 }
 console.log('PASS host: inline syntax, real storage round-trip, shared review metadata, PDF bytes, Token reload, same-origin proxy, task layout and reparse replacement');
})().catch(e=>{console.error(e);process.exitCode=1;});
