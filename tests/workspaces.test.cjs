'use strict';
const assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
global.indexedDB=indexedDB;
global.localStorage={_data:new Map(),getItem(k){return this._data.has(k)?this._data.get(k):null;},setItem(k,v){this._data.set(k,String(v));},removeItem(k){this._data.delete(k);}};
const core=require('../app-core.js');
async function openLegacy(){return new Promise((resolve,reject)=>{const r=indexedDB.open('ScoreAnalysisDB',1);r.onupgradeneeded=()=>r.result.createObjectStore('batches',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function put(db,key,value){await new Promise((resolve,reject)=>{const tx=db.transaction('batches','readwrite');tx.objectStore('batches').put({key,value});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
(async()=>{
 const legacy=await openLegacy();await put(legacy,'scoreBatches',{batches:[{id:'old',combinedStudentData:[{name:'历史学生'}]}]});legacy.close();
 const archive=await core.workspaces.ensureLegacyArchive();assert.equal(archive.id,'legacy-archive');assert.equal(archive.legacyArchive,true);assert.equal(archive.legacyArchiveReady,true);assert.equal((await core.workspaces.ensureLegacyArchive()).id,'legacy-archive');
 await core.storage.setWorkspace(archive.id);const copied=await core.storage.read('scoreBatches');assert.equal(copied.batches[0].id,'old');
 const oldAgain=await openLegacy();const oldRows=await new Promise((resolve,reject)=>{const r=oldAgain.transaction('batches','readonly').objectStore('batches').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});assert.equal(oldRows[0].value.batches[0].id,'old');oldAgain.close();
 const a=await core.workspaces.create({academicYear:'2026—2027',grade:'八年级'}),b=await core.workspaces.create({academicYear:'2026—2027',grade:'九年级'});await assert.rejects(()=>core.workspaces.create({academicYear:'2026—2027',grade:'八年级'}),/工作区已存在/);
 await core.storage.setWorkspace(a.id);assert.equal(await core.storage.acquireLease(),true);await core.storage.write('scoreBatches',{batches:[{id:'a'}]});const queued=core.storage.write('queuedWrite',{value:'must-finish-before-switch'});
 await core.storage.setWorkspace(b.id);await queued;assert.equal(await core.storage.acquireLease(),true);assert.equal(await core.storage.read('scoreBatches'),undefined);await core.storage.write('scoreBatches',{batches:[{id:'b'}]});
 await core.storage.setWorkspace(a.id);assert.equal(await core.storage.acquireLease(),true);assert.equal((await core.storage.read('scoreBatches')).batches[0].id,'a');assert.equal((await core.storage.read('queuedWrite')).value,'must-finish-before-switch');
 const lockKey='xqks:workspace-lock:'+a.id;global.localStorage.setItem(lockKey,JSON.stringify({owner:'another-tab',expiresAt:Date.now()+120000}));assert.throws(()=>core.storage.write('scoreBatches',{batches:[{id:'should-not-write'}]}),/编辑锁已失效/);global.localStorage.removeItem(lockKey);assert.equal(await core.storage.acquireLease(),true);
 assert.notEqual(core.storage.databaseName(a.id),core.storage.databaseName(b.id));
 core.storage.workspaceLocalSet('seating:test','a');await core.storage.setWorkspace(b.id);assert.equal(core.storage.workspaceLocalGet('seating:test'),undefined);
 await core.storage.setWorkspace(a.id);assert.equal(core.storage.workspaceLocalGet('seating:test'),'a');
 const listed=await core.workspaces.list();assert.equal(listed.length,3);
 await core.storage.setWorkspace(b.id);assert.equal(await core.storage.acquireLease(),true);await core.workspaces.remove(a.id);assert.equal(await core.workspaces.get(a.id),null);
 await core.storage.close();const originalStorage=global.localStorage;Object.defineProperty(global,'localStorage',{configurable:true,get(){throw Error('blocked');}});await assert.rejects(()=>core.storage.acquireLease(),/无法提供可靠的工作区编辑锁/);Object.defineProperty(global,'localStorage',{configurable:true,writable:true,value:originalStorage});console.log('PASS workspaces: isolated databases, local keys, registry lifecycle and non-destructive legacy archive');
})().catch(e=>{console.error(e);process.exitCode=1;});
