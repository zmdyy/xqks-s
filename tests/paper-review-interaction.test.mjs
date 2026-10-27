import {Window} from 'happy-dom';
import fs from 'node:fs';import assert from 'node:assert/strict';
const w=new Window({url:'http://localhost:5500/'});w.console=console;
const cproto=w.HTMLCanvasElement.prototype;cproto.getContext=()=>new Proxy({measureText:t=>({width:t.length*8})},{get:(t,k)=>t[k]||(()=>{})});
w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:1000,bottom:1000});w.HTMLElement.prototype.scrollTo=()=>{};w.HTMLElement.prototype.setPointerCapture=()=>{};w.HTMLElement.prototype.releasePointerCapture=()=>{};
let writes=0,fail=false;const batch={id:'b1',label:'模拟考试',uploadedPdfs:[{id:'p1',fileName:'空白.pdf',detectedSubject:'物理',fileData:new Uint8Array([1,2])}],combinedStudentData:[{subjects:{物理:{subScores:{'15':0,'16':1}}}}],notebookCropReviews:{'["物理","15"]':{fileId:'p1',fileName:'空白.pdf',scoreColumns:['15'],confirmed:true,regions:[{page:1,x:.1,y:.1,w:.3,h:.2}]},'["物理","16"]':{fileId:'p1',fileName:'空白.pdf',scoreColumns:['16'],confirmed:true,regions:[{page:2,x:.1,y:.1,w:.3,h:.2}]}}};
w.eval(fs.readFileSync('paper-crop-engine.js','utf8'));Object.assign(w,{DataPool:{batches:[batch],getCurrentBatch:()=>batch,currentBatchId:'b1'},showAlert:async s=>{throw Error(s)},notebookPdfBytes:p=>p.fileData,notebookMajorFromItem:x=>x,getCanonicalQuestionRefInfo:x=>({major:x}),pdfjsLib:{getDocument:()=>({promise:Promise.resolve({numPages:2,getPage:async()=>({getViewport:()=>({width:1000,height:1000,convertToViewportPoint:(x,y)=>[x,y]}),getTextContent:async()=>({items:[]}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{}})})},persistBatches:async()=>{writes++;return !fail;}});
w.eval(fs.readFileSync('notebook-crop-review.js','utf8'));await w.openPaperCropWorkspace();
const $=s=>w.document.querySelector(s);const el=$('[data-draw="1"]');
function drag(a,b){el.onpointerdown({clientX:a[0],clientY:a[1],button:0,pointerId:1});el.onpointermove({clientX:b[0],clientY:b[1],pointerId:1});el.onpointerup({clientX:b[0],clientY:b[1],pointerId:1});}
assert.ok($('.paper-toolbar'));assert.equal($('[data-a="close"]').textContent,'× 关闭');assert.equal($('[data-a="close"]').closest('.paper-toolbar-main'),null,'close stays outside scrolling toolbar');assert.equal($('[data-mode]'),null);assert.equal($('[data-a="import"]'),null);assert.equal($('[data-a="backup"]'),null);
// Blank area adds without mode changes and binds to 15.
drag([600,500],[800,700]);await new Promise(resolve=>setTimeout(resolve,480));assert.ok(writes>0,'edits save automatically without clicking any save button');assert.equal(await w.flushPaperCropDraft(),true);assert.equal(batch.notebookCropReviews['["物理","15"]'].regions.length,2);assert.equal(batch.notebookCropReviews['["物理","15"]'].confirmed,false);
// Selecting alone neither dirties nor saves.
const count=writes;drag([200,150],[200,150]);await w.flushPaperCropDraft();assert.equal(writes,count);
// Moving and top-left resize.
drag([200,150],[230,170]);await w.flushPaperCropDraft();assert.ok(Math.abs(batch.notebookCropReviews['["物理","15"]'].regions[0].x-.13)<.001);
drag([130,120],[100,100]);await w.flushPaperCropDraft();assert.ok(Math.abs(batch.notebookCropReviews['["物理","15"]'].regions[0].x-.1)<.001);
// Forced new overlaps existing; resets after one region.
$('[data-a="add"]').click();drag([150,140],[220,190]);await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["物理","15"]'].regions.length,3);assert.equal($('[data-a="add"]').getAttribute('aria-pressed'),'false');
// Rebind entire set to 16 and undo/redo preserves it across persistence.
$('[data-target]').value='16';w.confirm=()=>true;await $('[data-a="rebind"]').onclick();await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["物理","15"]'].regions.length,0);assert.equal(batch.notebookCropReviews['["物理","16"]'].regions.length,4);
$('[data-a="undo"]').click();await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["物理","15"]'].regions.length,3);
$('[data-a="redo"]').click();await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["物理","16"]'].regions.length,4);
// Failure does not discard local edits, claim saved or close. Retry works.
await $('[data-questions] [data-question="15"]').onclick();fail=true;drag([600,750],[800,900]);assert.equal(await w.flushPaperCropDraft(),false);assert.match($('[data-save]').textContent,/失败/);await $('[data-a="close"]').onclick();assert.ok($('#paperCropWorkspace'));fail=false;assert.equal(await w.flushPaperCropDraft(),true);await $('[data-a="close"]').onclick();assert.equal($('#paperCropWorkspace'),null);
await w.openPaperCropWorkspace();assert.equal($('[data-questions] [data-question="15"]').textContent,'第15题 · 待复核');await $('[data-a="close"]').onclick();// Switching a PDF must also switch score-column subject, list and binding targets.
batch.combinedStudentData[0].subjects.化学={subScores:{'1':0,'2':1,'3':0}};
batch.combinedStudentData[0].subjects.数学={subScores:{'7':0,'8':1}};
batch.uploadedPdfs.push({id:'p2',fileName:'化学.pdf',detectedSubject:'化学',fileData:new Uint8Array([3,4])},{id:'p3',fileName:'生物.pdf',detectedSubject:'生物',fileData:new Uint8Array([5,6])},{id:'p4',fileName:'数学试卷.pdf',fileData:new Uint8Array([7,8])},{id:'p5',fileName:'材料.pdf',fileData:new Uint8Array([9,10])},{id:'bad',fileName:'损坏化学.pdf',detectedSubject:'化学',fileData:new Uint8Array([0])});
batch.notebookCropReviews['["化学","2"]']={fileId:'p2',fileName:'化学.pdf',scoreColumns:['2'],confirmed:true,regions:[{page:1,x:.1,y:.1,w:.3,h:.2}]};
batch.paperReviewStates['["物理","p2"]']={updatedAt:'9999-01-01',completed:true}; // Old crossed pairing must not be restored.
w.detectSubjectByFileName=name=>name.includes('数学')?'数学':null;
const getDocument=w.pdfjsLib.getDocument;w.pdfjsLib.getDocument=opts=>opts.data[0]===0?{promise:Promise.reject(Error('测试：PDF 损坏'))}:getDocument(opts);
await w.openPaperCropWorkspace();assert.equal($('#paperCropWorkspace').dataset.reviewSubject,'物理');
const questions=()=>Array.from(w.document.querySelectorAll('[data-question]'),b=>b.dataset.question);
const changePdf=async id=>{$('[data-pdf]').value=id;await $('[data-pdf]').onchange();};
const drawCurrent=(a,b)=>{const layer=$('[data-draw="1"]');layer.onpointerdown({clientX:a[0],clientY:a[1],pointerId:1,button:0});layer.onpointerup({clientX:b[0],clientY:b[1],pointerId:1});};
$('[data-filter]').value='missing';$('[data-filter]').onchange();
await changePdf('p2');assert.equal($('[data-subject]').value,'化学');assert.deepEqual(questions(),['1','2','3']);assert.equal($('[data-filter]').value,'all');assert.deepEqual(Array.from($('[data-target]').options,o=>o.value),['1','2','3']);
assert.match($('[data-question="2"]').textContent,/已确认/);assert.equal($('#paperCropWorkspace').dataset.pdfId,'p2');
drawCurrent([600,500],[800,700]);await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["化学","1"]'].fileId,'p2');assert.equal(batch.notebookCropReviews['["物理","1"]'],undefined);
const physicsBefore=JSON.stringify(batch.notebookCropReviews['["物理","15"]']);
// A failed save cancels switching and keeps the draft associated with chemistry.
drawCurrent([600,750],[800,900]);fail=true;await changePdf('p1');assert.equal($('[data-subject]').value,'化学');assert.equal($('[data-pdf]').value,'p2');assert.deepEqual(questions(),['1','2','3']);fail=false;await w.flushPaperCropDraft();
await changePdf('p1');assert.equal($('[data-subject]').value,'物理');assert.deepEqual(questions(),['15','16']);assert.equal(JSON.stringify(batch.notebookCropReviews['["物理","15"]']),physicsBefore);
$('[data-subject]').value='化学';await $('[data-subject]').onchange();assert.equal($('[data-pdf]').value,'p2');assert.deepEqual(questions(),['1','2','3']);
await changePdf('p3');assert.equal($('[data-pdf]').value,'p2');assert.deepEqual(questions(),['1','2','3']);assert.match($('[data-message]').textContent,/生物.*小题分/);
await changePdf('bad');assert.equal($('[data-pdf]').value,'p2');assert.equal($('[data-subject]').value,'化学');assert.match($('[data-message]').textContent,/打开失败/);
await changePdf('p4');assert.equal($('[data-subject]').value,'数学');assert.deepEqual(questions(),['7','8']);
await changePdf('p5');assert.equal($('[data-subject]').value,'数学');assert.match($('[data-message]').textContent,/未识别到原卷科目/);
await $('[data-a="close"]').onclick();
await w.happyDOM.close();console.log('Review interactions, autosave, failure/retry, reopen and cross-subject PDF switching passed.');
