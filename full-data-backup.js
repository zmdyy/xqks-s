/* Workspace-scoped full backup. Question bank remains independent. */
(function(root){
'use strict';
const allowedKey=k=>{
 const value=String(k||'').replace(/^xqks:[^:]+:/,'').replace(/^[^:]*:/,'');
 return /^(pku_|physicsDiagnostic|score|seating|knowledge)/i.test(value) || /(?:^|:)seating_/i.test(value) || value==='visionConfig';
};
const secretKey=k=>/api.?key|token|password|secret|authorization/i.test(k);
function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&!(value instanceof ArrayBuffer)&&!(value instanceof Blob)){
  const out={};for(const k of Object.keys(value))if(!secretKey(k)&&k!=='_qi')out[k]=clean(value[k]);return out;
 }
 return value;
}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
async function encode(v){
 if(v===undefined)return{$type:'undefined'};
 if(v instanceof Blob)return{$type:'blob',mime:v.type,data:b64(new Uint8Array(await v.arrayBuffer()))};
 if(v instanceof ArrayBuffer||ArrayBuffer.isView(v)){const a=v instanceof ArrayBuffer?new Uint8Array(v):new Uint8Array(v.buffer,v.byteOffset,v.byteLength);return{$type:'bytes',data:b64(a)};}
 if(v instanceof Date)return{$type:'date',data:v.toISOString()};
 if(Array.isArray(v))return Promise.all(v.map(encode));
 if(v&&typeof v==='object'){const out={};for(const k of Object.keys(v))out[k]=await encode(v[k]);return out;}
 return v;
}
function decode(v){
 if(Array.isArray(v))return v.map(decode);if(!v||typeof v!=='object')return v;
 if(v.$type==='undefined')return undefined;
 if(v.$type==='bytes'||v.$type==='blob'){const a=Uint8Array.from(atob(v.data),c=>c.charCodeAt(0));return v.$type==='blob'?new Blob([a],{type:v.mime}):a;}
 if(v.$type==='date')return new Date(v.data);
 const out={};for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k))throw Error('备份字段无效');out[k]=decode(v[k]);}return out;
}
function openDB(name,schema){
 return new Promise((resolve,reject)=>{
  let absent=false;const req=schema?indexedDB.open(name,schema.version):indexedDB.open(name);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!schema){absent=true;req.transaction.abort();return;}
   for(const st of schema.stores){
    if(!db.objectStoreNames.contains(st.name)){
     const store=db.createObjectStore(st.name,{keyPath:st.keyPath,autoIncrement:st.autoIncrement});
     for(const i of st.indexes)store.createIndex(i.name,i.keyPath,{unique:i.unique,multiEntry:i.multiEntry});
    }
   }
  };
  req.onerror=()=>absent?resolve(null):reject(req.error);
  req.onblocked=()=>reject(Error('数据库被占用，请关闭其他系统页面后重试'));
  req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};
 });
}
async function dumpDB(name){
 const db=await openDB(name);if(!db)return null;
 try{
  const names=Array.from(db.objectStoreNames);
  if(!names.length)return{name,version:db.version,stores:[]};
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(names,'readonly'),stores=[];
   for(const name of names){
    const store=tx.objectStore(name),st={name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:Array.from(store.indexNames).map(n=>{const i=store.index(n);return{name:n,keyPath:i.keyPath,unique:i.unique,multiEntry:i.multiEntry};}),rows:[]};
    stores.push(st);const r=store.openCursor();r.onsuccess=()=>{const c=r.result;if(c){st.rows.push({key:c.key,value:c.value});c.continue();}};
   }
   tx.oncomplete=()=>resolve({name,version:db.version,stores});
   tx.onabort=tx.onerror=()=>reject(tx.error||Error('读取数据库失败'));
  });
 }finally{db.close();}
}
async function putDB(data){
 const db=await openDB(data.name,data);
 try{
  if(!data.stores.length)return;
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(data.stores.map(s=>s.name),'readwrite');
   try{
    for(const st of data.stores){
     const store=tx.objectStore(st.name);
     if(JSON.stringify(store.keyPath)!==JSON.stringify(st.keyPath))throw Error('数据库结构不兼容：'+st.name);
     store.clear();
     for(const row of st.rows){if(store.keyPath!==null)store.put(row.value);else store.put(row.value,row.key);}
    }
   }catch(e){tx.abort();reject(e);}
   tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('数据库写入失败'));
  });
 }finally{db.close();}
}
function workspaceLocalPrefix(id){return 'xqks:'+id+':';}
function localData(workspaceId){
 const data={},prefix=workspaceLocalPrefix(workspaceId);
 for(let i=0;i<localStorage.length;i++){
  const k=localStorage.key(i);
  if(!k||!k.startsWith(prefix))continue;
  const suffix=k.slice(prefix.length);
  if(!allowedKey(suffix)||secretKey(suffix))continue;
  data[k]=localStorage.getItem(k);
 }
 return data;
}
function applyLocal(data,sourceWorkspaceId,targetWorkspaceId){
 for(const [k,v]of Object.entries(data||{})){
  if(!allowedKey(k)||secretKey(k)||typeof v!=='string')throw Error('备份配置格式异常');
 }
 const targetPrefix=workspaceLocalPrefix(targetWorkspaceId);
 for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k&&k.startsWith(targetPrefix))localStorage.removeItem(k);}
 for(const [key,value]of Object.entries(data||{})){
  if(key==='visionConfig')continue;
  let suffix=key;
  const scoped=key.match(/^xqks:([^:]+):(.*)$/);
  if(scoped){
   if(sourceWorkspaceId&&scoped[1]!==sourceWorkspaceId)throw Error('备份中的本地数据工作区编号不一致');
   suffix=scoped[2];
  }
  localStorage.setItem(targetPrefix+suffix,value);
 }
}
function workspaceState(){
 return{currentBatchId:DataPool.currentBatchId,batchName:document.getElementById('newBatchName')?.value||'',uploadedFilesData,uploadedPdfs,combinedStudentData,allSubjectHeaders,mainHeaderRows:document.getElementById('mainHeaderRows')?.value,subHeaderRows:document.getElementById('subHeaderRows')?.value};
}
function applyMemory(data){
 DataPool.batches=data.batches;const w=data.workspace;loadBatch(w.currentBatchId||null);
 uploadedFilesData=w.uploadedFilesData;uploadedPdfs=w.uploadedPdfs;combinedStudentData=w.combinedStudentData;allSubjectHeaders=w.allSubjectHeaders;
 refreshBatchList();document.getElementById('batchSelector').value=w.currentBatchId||'__new__';document.getElementById('newBatchName').value=w.batchName;
 for(const k of ['mainHeaderRows','subHeaderRows'])if(w[k])document.getElementById(k).value=w[k];
 renderFileList();renderPdfList();updateStudentNameList(combinedStudentData);updateBatchInfoBars();
 if(typeof loadVisionConfig==='function')loadVisionConfig();
}
async function capture(){
 if(typeof dataStartupPromise!=='undefined')await dataStartupPromise;
 if(typeof dataOperationBusy!=='undefined'&&dataOperationBusy)throw Error('请等待文件导入或保存完成');
 if(!AppCore.storage.workspaceId())throw Error('请先选择工作区');
 if(root.flushPaperCropDraft&&!(await root.flushPaperCropDraft()))throw Error('切题修改保存失败，请先重试');
 if(document.getElementById('paperCropWorkspace'))throw Error('请先关闭切题复核窗口，再备份或恢复');
 const id=AppCore.storage.workspaceId(),dbName=AppCore.storage.databaseName(),databases=[];
 const db=await dumpDB(dbName);if(db)databases.push(db);
 const meta=await AppCore.workspaces.get(id);
 return{format:'ScoreFullBackup',version:2,createdAt:new Date().toISOString(),source:location.pathname,sourceWorkspaceId:id,
  workspaceMeta:clean(meta||{id,name:'未命名工作区'}),batches:clean(DataPool.batches),workspace:clean(workspaceState()),databases:clean(databases),local:localData(id)};
}
function validate(data){
 if(data?.format!=='ScoreFullBackup'||![1,2].includes(data.version)||!Array.isArray(data.batches)||!data.workspace||!Array.isArray(data.databases)||!data.local)throw Error('不是受支持的完整备份');
 if(data.version===2&&(!data.workspaceMeta||!data.sourceWorkspaceId))throw Error('新版备份缺少工作区归属信息');
 data.databases=data.databases.filter(db=>db.name!=='PhysicsTrainingBankV1');
 for(const k of Object.keys(data.local))if(/^(question|bank|physicsBank)/i.test(k))delete data.local[k];
 const ids=new Set();
 for(const b of data.batches){if(!b?.id||ids.has(b.id)||!Array.isArray(b.combinedStudentData))throw Error('备份中的批次数据不完整');ids.add(b.id);}
 const w=data.workspace;
 if(w.currentBatchId&&!ids.has(w.currentBatchId))throw Error('当前批次不存在');
 for(const k of ['uploadedPdfs','combinedStudentData','allSubjectHeaders'])if(!Array.isArray(w[k]))throw Error('备份中的当前页面数据不完整');
 if(!w.uploadedFilesData||typeof w.uploadedFilesData!=='object')throw Error('缺少导入表格数据');
 const names=new Set();
 for(const db of data.databases){
  if(!(db.name==='ScoreAnalysisDB'||/^ScoreAnalysisDB_[A-Za-z0-9_-]{1,80}$/.test(db.name))||names.has(db.name)||!Number.isInteger(db.version)||db.version<1||!Array.isArray(db.stores))throw Error('数据库备份格式异常');
  names.add(db.name);for(const st of db.stores)if(!st.name||!Array.isArray(st.rows)||!Array.isArray(st.indexes))throw Error('数据库表格式异常');
 }
 for(const [k,v]of Object.entries(data.local))if(!allowedKey(k)||secretKey(k)||typeof v!=='string')throw Error('配置备份格式异常');
 return data;
}
async function digest(s){
 if(!root.crypto?.subtle)throw Error('请通过 localhost 或 HTTPS 打开系统以生成、校验备份');
 const a=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
 return Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');
}
async function createZip(data){
 validate(data);const text=JSON.stringify(await encode(data)),zip=new JSZip();zip.file('data.json',text);
 zip.file('manifest.json',JSON.stringify({format:'ScoreFullBackup',version:data.version,sha256:await digest(text),createdAt:data.createdAt,batches:data.batches.length}));
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:4}});
}
async function readZip(bytes){
 const zip=await JSZip.loadAsync(bytes),entry=zip.file('data.json'),manifest=zip.file('manifest.json');
 if(!entry||!manifest)throw Error('压缩包缺少备份数据');
 const m=JSON.parse(await manifest.async('string')),text=await entry.async('string');
 if(m.format!=='ScoreFullBackup'||![1,2].includes(m.version)||m.sha256!==await digest(text))throw Error('备份校验失败，文件可能不完整');
 const data=validate(decode(JSON.parse(text)));
 if(data.version!==m.version)throw Error('备份清单与数据版本不一致');
 return data;
}
async function writeAll(data,targetId){
 const saved=data.databases.find(d=>d.name==='ScoreAnalysisDB'||/^ScoreAnalysisDB_/.test(d.name));
 const targetName=AppCore.storage.databaseName(targetId);
 if(saved)await putDB(Object.assign({},saved,{name:targetName}));
 else{
  const existing=await dumpDB(targetName);
  if(existing){existing.stores.forEach(s=>s.rows=[]);await putDB(existing);}
 }
 applyLocal(data.local,data.sourceWorkspaceId||null,targetId);
 DataPool.batches=data.batches;
 if(!await persistBatches())throw Error('成绩及原卷保存失败');
 applyMemory(data);
}
async function restore(data,options){
 options=options||{};validate(data);
 const previousId=AppCore.storage.workspaceId(),createNew=options.createWorkspace!==false;
 let targetId=previousId,targetMeta=null,before=null;
 if(createNew){
  const source=options.workspaceMeta||data.workspaceMeta;
  if(!source||!source.academicYear||!source.grade)throw Error('备份缺少学年或年级信息，请先指定恢复归属');
  const baseName=source.name||[source.academicYear,source.grade].filter(Boolean).join(' · ');
  targetMeta=await AppCore.workspaces.create({academicYear:source.academicYear,grade:source.grade,name:(baseName||'恢复工作区')+'（恢复）',restoredFromWorkspaceId:data.sourceWorkspaceId||source.id||null});
  targetId=targetMeta.id;
 }else before=await capture();
 try{
  if(targetId!==previousId)await AppCore.storage.setWorkspace(targetId);
  if(!await AppCore.storage.acquireLease())throw Error('目标工作区已在另一个页面打开');
  await writeAll(data,targetId);
  if(createNew&&options.navigate!==false)root.location.replace(AppCore.workspaces.urlFor(targetId));
  return{workspace:targetMeta||await AppCore.workspaces.get(targetId),id:targetId};
 }catch(error){
  if(createNew){
   if(previousId){await AppCore.storage.setWorkspace(previousId);await AppCore.storage.acquireLease();}
   try{await AppCore.workspaces.remove(targetId);}catch(cleanup){throw Error(error.message+'；新工作区清理失败：'+cleanup.message);}
   throw error;
  }
  try{await writeAll(before,targetId);}catch(rollback){throw Error(error.message+'；回滚失败：'+rollback.message+'。请保留备份并重试恢复。');}
  throw Error(error.message+'；已恢复到操作前的数据。');
 }
}
function mount(){
 const nav=document.querySelector('.tab-nav');if(!nav||document.querySelector('.system-backup-tools'))return;
 if(!document.getElementById('score-backup-ui-style')){const style=document.createElement('style');style.id='score-backup-ui-style';style.textContent=
 '.system-tools-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 14px}'+
 '.system-backup-tools{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex:0 1 auto;min-width:0;margin-left:auto}'+
 '.system-backup-hint:empty{display:none}.system-backup-hint{font-size:12px;color:var(--text-tertiary,#64748b);line-height:1.5;max-width:500px;text-align:right;overflow-wrap:anywhere}'+
 '.system-backup-actions{display:flex;gap:8px;flex:none}'+
 '.system-backup-tools button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:8px 14px;border-radius:8px;border:1px solid var(--primary,#1c3d5c);font-family:inherit;font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap;cursor:pointer;transition:background .15s,box-shadow .15s,transform .15s}'+
 '.system-backup-tools [data-full-export]{background:var(--primary,#1c3d5c);color:#fff;box-shadow:0 2px 5px #1c3d5c18}.system-backup-tools [data-full-restore]{background:var(--surface,#fff);color:var(--primary,#1c3d5c)}'+
 '.system-backup-tools [data-full-export]:hover:not(:disabled){background:var(--primary-light,#2d5980);box-shadow:0 3px 8px #1c3d5c25}.system-backup-tools [data-full-restore]:hover:not(:disabled){background:var(--bg-card,#f1f5f9)}'+
 '.system-backup-tools button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.system-backup-tools button:disabled{opacity:.5;cursor:wait}.system-backup-tools svg{width:16px;height:16px;flex:none}'+
 '@media(max-width:760px){.system-backup-tools{width:100%;flex-wrap:wrap;gap:6px 10px}.system-backup-hint{flex:1;min-width:170px}}@media print{.system-backup-tools{display:none!important}}';
  document.head.appendChild(style);
 }
 const box=document.createElement('div');box.className='system-backup-tools';box.setAttribute('aria-label','当前工作区备份与恢复');
 const icon=path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
 box.innerHTML='<span class="system-backup-hint" data-backup-status role="status"></span><div class="system-backup-actions"><button type="button" data-full-export title="只备份当前工作区的考试批次、原卷及复核数据">'+icon('<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>')+'备份当前工作区</button><button type="button" data-full-restore title="校验备份并创建一个新的独立工作区">'+icon('<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>')+'恢复到新工作区</button></div><input type="file" accept=".zip" hidden>';
 let row=nav.previousElementSibling;
 if(!row?.querySelector('a[href^="question-bank/"]')){row=document.createElement('div');nav.before(row);}
 row.classList.add('system-tools-row');row.appendChild(box);
 const exp=box.querySelector('[data-full-export]'),res=box.querySelector('[data-full-restore]'),input=box.querySelector('input'),status=box.querySelector('[data-backup-status]');
 let working=false;
 async function run(fn){if(working)return;working=true;exp.disabled=res.disabled=true;try{await fn();}catch(e){status.textContent='操作失败：'+e.message;}finally{working=false;exp.disabled=res.disabled=false;}}
 exp.onclick=()=>run(async()=>{
  status.textContent='正在整理当前工作区并压缩…';
  const data=await capture(),bytes=await createZip(data),url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');
  a.href=url;a.download='学情工作区备份_'+(data.workspaceMeta.grade||'工作区')+'_'+new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).replace(/[: ]/g,'-')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  status.textContent='已生成当前工作区备份（'+data.batches.length+' 个考试批次）。其他年级的数据未包含在内。';
 });
 res.onclick=()=>input.click();
 input.onchange=()=>run(async()=>{
  const file=input.files[0];input.value='';if(!file)return;
  status.textContent='正在校验备份…';
  const data=await readZip(await file.arrayBuffer());
  let meta=data.workspaceMeta;
  if(!meta||!meta.academicYear||!meta.grade){
   meta=await root.WorkspaceUI.requestWorkspaceMeta({name:'旧版备份恢复',grade:'待整理'});
   if(!meta){status.textContent='已取消恢复';return;}
  }
  const label=(meta.name||[meta.academicYear,meta.grade].filter(Boolean).join(' · '))+'（恢复）';
  if(!await showConfirm('备份包含 '+data.batches.length+' 个批次，生成于 '+data.createdAt+'。系统将新建工作区“'+label+'”，恢复成绩、原卷、复核和座位数据；当前工作区及其他年级均不会被覆盖。是否继续？')){
   status.textContent='已取消恢复';return;
  }
  status.textContent='正在创建新工作区并恢复…';
  const result=await restore(data,{workspaceMeta:meta});
  status.textContent='已恢复到新工作区：'+result.workspace.name;
 });
}
root.FullDataBackup={capture,createZip,readZip,restore,validate,encode,decode,dumpDB};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(window);
