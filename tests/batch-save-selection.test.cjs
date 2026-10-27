'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const html=fs.readFileSync('index.html','utf8');
function source(name){
 const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(m,name);const rest=html.slice(m.index);
 for(let end=rest.indexOf('\n');end>=0;end=rest.indexOf('\n',end+1)){const code=rest.slice(0,end);try{new vm.Script(code);return code;}catch(_){}}
 throw Error('Cannot extract '+name);
}
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{id,value:'',style:{},textContent:'',children:[],handlers:{},classes:new Set(),
  set innerHTML(value){this.children=[];this._html=value;},get innerHTML(){return this._html||'';},
  appendChild(node){this.children.push(node);},addEventListener(type,fn){this.handlers[type]=fn;},
  classList:{add(){},remove(){}}});return elements.get(id);
}
const events=[];let serial=1000,fail=false,persisted;
const c={console,Uint8Array,ArrayBuffer,DataView,crypto:crypto.webcrypto,structuredClone,
 Date:class extends Date{static now(){return ++serial;}},setTimeout(){},clearTimeout(){},
 document:{getElementById:element,createElement:()=>element('node-'+(++serial)),querySelector:()=>null,querySelectorAll:()=>[]},
 combinedStudentData:[],allSubjectHeaders:[],uploadedFilesData:{},uploadedPdfs:[],dataEpoch:0,dataOperationBusy:false,
 renderCrossExamBatchPicker(){},fillCriticalBatchSelects(){},renderFileList(){},renderPdfList(){},updateStudentNameList(){},
 applyDuplicateDisplayNames(){},repairImportedBatchData:()=>false,localizeExistingMineruMarkdownAssets:async()=>{},
 showAlert:async msg=>events.push(['alert',msg]),setDataControlsBusy(value){c.dataOperationBusy=value;},
 updateAnalysisBackToTop(){},persistBatches:async()=>{if(fail)return false;persisted=structuredClone(c.pool.batches);return true;}};
c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('app-core.js','utf8'),c);
const poolStart=html.indexOf('const DataPool = {'),poolEnd=html.indexOf('\n};',poolStart)+3;
assert(poolStart>=0&&poolEnd>poolStart);vm.runInContext(html.slice(poolStart,poolEnd)+'\nglobalThis.pool=DataPool;',c);
for(const name of ['deepClone','normalizePdfBytes','cloneUploadedPdfsForMemory','refreshBatchList','renderSavedBatchTags','loadBatch','updateBatchInfoBars','switchTab']){
 if(new RegExp('^(?:async )?function '+name+'\\(','m').test(html))vm.runInContext(source(name),c);
}
for(const [name,tab] of [['displayPersonalResults','personal'],['renderCollectiveAll','collective'],['refreshTrendTab','trend'],['refreshComprehensiveTab','comprehensive'],['renderClassDiffAll','class-diff'],['refreshSeatingTab','seating'],['refreshSmartTab','smart']])c[name]=()=>events.push([tab,c.pool.currentBatchId,c.combinedStudentData.length]);
const changeStart=html.indexOf("document.getElementById('batchSelector').addEventListener('change'"),saveStart=html.indexOf("document.getElementById('saveBatchBtn').addEventListener('click'"),saveEnd=html.indexOf("document.getElementById('deleteBatchBtn').addEventListener",saveStart);
vm.runInContext(html.slice(changeStart,saveEnd),c);
const save=()=>element('saveBatchBtn').handlers.click();
function select(value){const el=element('batchSelector');el.value=value;el.handlers.change.call(el);}
function active(id,label,count){assert.equal(c.pool.currentBatchId,id);assert.equal(element('batchSelector').value,id);assert.equal(c.combinedStudentData.length,count);for(const suffix of ['Personal','Collective','ClassDiff','Trend','Comprehensive','Smart'])assert.equal(element('batchLabel'+suffix).textContent,label);}
function visit(id,count){for(const tab of ['personal','class-diff','collective','trend','smart','comprehensive','seating'])c.switchTab('tab-'+tab);assert(events.slice(-7).every(e=>e[1]===id&&e[2]===count),'all analysis routes must retain the selected data');}
(async()=>{
 await save();assert.equal(c.pool.batches.length,0);assert.equal(c.dataOperationBusy,false);
 const old={id:'old',label:'历史考试',combinedStudentData:[{name:'历史学生',subjects:{}}],allSubjectHeaders:[],uploadedPdfs:[],uploadedFilesData:{}};c.pool.batches=[old];
 c.combinedStudentData=[{name:'甲',subjects:{}},{name:'乙',subjects:{}}];c.uploadedPdfs=[{id:'paper',fileName:'物理.pdf',fileData:new Uint8Array([37,80,68,70]),mineruLayout:{format:'middle_json'}}];element('newBatchName').value='本次考试';
 await save();const first=c.pool.currentBatchId;assert(first&&first!=='old');active(first,'本次考试',2);visit(first,2);assert.equal(c.pool.batches.length,2);assert.equal(c.uploadedPdfs[0].mineruLayout.format,'middle_json');assert.match(element('batchStatus').textContent,/当前已选中/);assert.equal(element('saveBatchBtn').textContent,'更新批次');
 c.combinedStudentData.push({name:'丙',subjects:{}});element('newBatchName').value='本次考试修订';await save();active(first,'本次考试修订',3);assert.equal(c.pool.batches.length,2);assert.equal(persisted.find(b=>b.id===first).combinedStudentData.length,3);assert.equal(old.combinedStudentData.length,1);
 select('old');active('old','历史考试',1);visit('old',1);await save();active('old','历史考试',1);assert.equal(c.pool.batches.length,2,'updating a historical batch must not select the newest one');
 select('__new__');assert.equal(c.pool.currentBatchId,null);assert.equal(c.combinedStudentData.length,0);assert.equal(c.uploadedPdfs.length,0);visit(null,0);assert.equal(c.pool.batches.length,2);
 c.combinedStudentData=[{name:'新考试学生',subjects:{}}];element('newBatchName').value='下一次考试';await save();const next=c.pool.currentBatchId;assert(next&&next!==first&&next!=='old');active(next,'下一次考试',1);assert.equal(c.pool.batches.length,3);
 fail=true;c.combinedStudentData.push({name:'尚未写入',subjects:{}});await save();active(next,'下一次考试',2);assert.equal(c.dataOperationBusy,false);assert.equal(persisted.find(b=>b.id===next).combinedStudentData.length,1,'failed save must not clear or pretend to persist working data');
 console.log('PASS batch selection: new/update save stays selected, all analysis routes retain data, manual history/new selection and failed save preserve intent');
})().catch(e=>{console.error(e);process.exitCode=1;});
