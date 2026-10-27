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
assert.equal($('[data-mode]'),null);assert.equal($('[data-a="import"]'),null);assert.equal($('[data-a="backup"]'),null);
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
await w.openPaperCropWorkspace();assert.equal($('[data-questions] [data-question="15"]').textContent,'第15题 · 待复核');await $('[data-a="close"]').onclick();await w.happyDOM.close();console.log('Review interactions, autosave, failure/retry and reopen passed.');
