// DOM interaction + actual PDF rendering. Chromium is optional; this test uses happy-dom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Window}=await import(process.env.HAPPY_DOM_PATH||'happy-dom');
const {PDFDocument,StandardFonts,rgb}=require('pdf-lib');
const napi=require('@napi-rs/canvas');
globalThis.DOMMatrix=napi.DOMMatrix;globalThis.Path2D=napi.Path2D;globalThis.ImageData=napi.ImageData;
const pdfjs=await import('file://'+require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const sourcePdf=await PDFDocument.create(),font=await sourcePdf.embedFont(StandardFonts.Helvetica);
for(let n=0;n<2;n++){const p=sourcePdf.addPage([600,800]);p.drawText(n===0?'17. Question one':'Continuation of question 18',{x:30,y:700,font,size:14});if(n===0)p.drawText('18. Question two',{x:30,y:400,font,size:14});else p.drawText('19. Question three',{x:30,y:400,font,size:14});p.drawRectangle({x:50,y:500,width:100,height:100,color:rgb(.2,.5,.8)});}
const bytes=await sourcePdf.save();
const w=new Window({url:'http://localhost/'});w.console=console;w.atob=t=>Buffer.from(t,'base64').toString('binary');w.confirm=()=>true;w.alert=m=>{throw Error(m);};
function surface(c){if(!c._surface||c._surface.width!==c.width||c._surface.height!==c.height)c._surface=napi.createCanvas(Math.max(1,c.width),Math.max(1,c.height));return c._surface;}
w.HTMLCanvasElement.prototype.getContext=function(){const ctx=surface(this).getContext('2d');if(!ctx._patched){const original=ctx.drawImage.bind(ctx);ctx.drawImage=(img,...a)=>original(img instanceof w.HTMLCanvasElement?surface(img):img,...a);ctx._patched=true;}return ctx;};
w.HTMLCanvasElement.prototype.toDataURL=function(){return surface(this).toDataURL('image/png');};
w.HTMLCanvasElement.prototype.setPointerCapture=function(){};
w.HTMLCanvasElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:this.width,height:this.height};};
w.pdfjsLib={getDocument:opts=>pdfjs.getDocument({...opts,useSystemFonts:true,disableFontFace:true})};
w.notebookPdfBytes=p=>p.fileData || new Uint8Array(Buffer.from(p.fileDataB64,'base64'));
w.pdfBytesToBase64=b=>Buffer.from(b).toString('base64');
w.notebookMajorFromItem=t=>String(t).match(/\d+/)?.[0];w.notebookLineMajor=t=>String(t).match(/^(\d+)[.、]/)?.[1];w.notebookPdfLineGeometry=()=>[];
w.showAlert=async m=>{throw Error(m);};
const layout={pdf_info:[{page_idx:0,page_size:[600,800],para_blocks:[{type:'text',bbox:[30,80,550,120],lines:[{spans:[{content:'17. Question one'}]}]},{type:'image',bbox:[50,200,150,300]},{type:'text',bbox:[30,380,550,420],lines:[{spans:[{content:'18. Question two'}]}]}]},{page_idx:1,page_size:[600,800],para_blocks:[{type:'text',bbox:[30,80,550,120],lines:[{spans:[{content:'continuation'}]}]},{type:'image',bbox:[50,200,150,300]},{type:'text',bbox:[30,380,550,420],lines:[{spans:[{content:'19. Question three'}]}]}]}]};
const batch={id:'exam',label:'Shared paper',uploadedPdfs:[{id:'pdf',fileName:'physics.pdf',fileData:bytes,mineruLayout:layout}],combinedStudentData:[{name:'A',subjects:{物理:{subScores:{'17':{score:0,maxScore:2},'18(1)':{score:1,maxScore:2},'19':{score:2,maxScore:2}}}}}]};
w.DataPool={batches:[batch],getCurrentBatch:()=>batch};let saved='',fail=false;w.persistBatches=async()=>{if(fail)return false;saved=JSON.stringify(batch);return true;};
w.eval(fs.readFileSync('paper-crop-engine.js','utf8'));w.eval(fs.readFileSync('notebook-crop-review.js','utf8'));
await w.openPaperCropWorkspace();
const $=s=>w.document.querySelector('#paperCropWorkspace '+s);const click=async name=>{await $('[data-a="'+name+'"]').onclick();};
assert.match($('[data-message]').textContent,/已使用 MinerU 坐标/);assert.equal(w.document.querySelectorAll('[data-question]').length,3);
assert.match($('[data-progress]').textContent,/0 \/ 3/);
assert.equal(w.document.querySelectorAll('[data-paper-page]').length,2,'both pages remain mounted for continuous scrolling');
await w.document.querySelector('[data-question="19"]').onclick();assert.equal(w.document.querySelector('#paperCropWorkspace').dataset.currentPage,'2');
assert.equal(w.document.querySelectorAll('[data-paper-page]').length,2,'navigation must not replace pages');await w.document.querySelector('[data-question="17"]').onclick();

await click('confirm');assert.equal(batch.notebookCropReviews['["物理","17"]'].confirmed,true);assert.match($('[data-title]').textContent,/18/);assert.equal($('[data-regions]').children.length,2,'cross-page regions');
await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["物理","18"]'].confirmed,false);
// Edit the second page directly in the continuous document, keeping its real page number.
await click('add');
const second=w.document.querySelector('[data-draw="2"]');
second.onpointerdown({clientX:second.width*.8,clientY:second.height*.8,pointerId:1});
second.onpointerup({clientX:second.width*.9,clientY:second.height*.9,pointerId:1});
await w.flushPaperCropDraft();assert.equal(batch.notebookCropReviews['["物理","18"]'].regions.at(-1).page,2);
await click('undo');

// Delete a region, undo/redo and restore it.
$('[data-regions] button:last-child').click();assert.equal($('[data-regions]').children.length,1);await click('undo');assert.equal($('[data-regions]').children.length,2);await click('redo');assert.equal($('[data-regions]').children.length,1);await click('undo');
await click('confirm');assert.match($('[data-title]').textContent,/19/);await click('confirm');await click('finish');assert.equal(batch.paperReviewStates['["物理","pdf"]'].completed,true);
const shots=await w.notebookReviewedSnapshots({batchId:'exam',subjectName:'物理',itemName:'18(1)'});assert.equal(shots.length,2);assert(shots.every(s=>s.startsWith('data:image/png;base64,')));
// Reserializing a saved batch keeps the public mapping and original paper bytes.
const restored=JSON.parse(saved);assert.equal(restored.notebookCropReviews['["物理","18"]'].confirmed,true);
// Save failure must roll back persisted records, keeping the editor draft.
await w.document.querySelector('[data-question="18"]').onclick();$('[data-regions] button:last-child').click();fail=true;await w.flushPaperCropDraft();assert.match($('[data-message]').textContent,/保存失败/);assert.equal(batch.notebookCropReviews['["物理","18"]'].regions.length,2);fail=false;
// Standalone system backup is covered by full-data-backup.test.mjs.
await click('undo');await w.flushPaperCropDraft();
// Actual DOCX packaging uses the confirmed PNG slices.
w.JSZip=require('../jszip.min.js');
w.eval(fs.readFileSync('notebook-docx.js','utf8'));
// Bridge VM typed arrays into the host JSZip realm, retaining production data URI parsing.
const parseUri=w.dataUriToBytes;w.dataUriToBytes=src=>{const d=parseUri(src);if(d)d.bytes=Buffer.from(d.bytes);return d;};
w.probeImageSize=async(bytes)=>{const img=await napi.loadImage(Buffer.from(bytes));return {w:img.width,h:img.height};};
let exported;
w.URL.createObjectURL=blob=>{exported=blob;return 'blob:test';};w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=function(){};
w.lastErrorNotebookExport={studentName:'A',studentClass:'801',totalErrors:1,subjectCount:1,batchCount:1,subjects:[{name:'物理',items:[{batchId:'exam',batchLabel:'Shared paper',subjectName:'物理',itemName:'18(1)',detailItemNames:['18(1)'],score:1,maxScore:2,rate:.5,stemMarkdown:'',parseSource:'mineru_precise',studentAnswer:'',correctAnswer:''}]}]};
w.getErrorNotebookQuestionSnapshots=w.notebookReviewedSnapshots;
await w.exportErrorNotebookWord();
const zip=await w.JSZip.loadAsync(await exported.arrayBuffer());
const xml=await zip.file('word/document.xml').async('string');
assert.equal(Object.keys(zip.files).filter(n=>/^word\/media\/image/.test(n)).length,2);
assert(xml.includes('需订正：18(1)'));assert(!xml.includes('我的答案'));assert(!xml.includes('原卷未复核'));
// Shared material is a reviewable warning; explicit approval is persisted.
await click('close');
batch.notebookCropReviews['["物理","17"]'].regions=structuredClone(batch.notebookCropReviews['["物理","18"]'].regions);
await w.openPaperCropWorkspace();await click('finish');assert.match($('[data-message]').textContent,/重叠提醒/);
w.prompt=()=> '两题共享材料，人工核对';
const approve=[...$('[data-overlaps]').querySelectorAll('button')].find(b=>b.textContent==='允许此处重叠');assert(approve);approve.click();
await click('finish');assert.equal(batch.paperReviewStates['["物理","pdf"]'].completed,true);assert(batch.notebookCropReviews['["物理","17"]'].overlapApprovals.length);
// Reproduce the screenshot: paper 01/02 metadata must never become question 1/2.
await click('close');
const html=fs.readFileSync('index.html','utf8');
for(const name of ['parseCompositeQuestionRef','normalizeItemName','getCanonicalQuestionRefInfo','getErrorMajorKey','notebookMajorFromItem']){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);w.eval(html.slice(start,end));}
batch.combinedStudentData[0].subjects.物理.subScores={'0)物理1卷':{score:5,maxScore:10},'01卷物理单选15':{score:0,maxScore:2},'01卷物理单选16':{score:1,maxScore:2},'02卷物理23-1':{score:0,maxScore:2}};
batch.notebookCropReviews={'["物理","1"]':{fileId:'pdf',fileName:'physics.pdf',confirmed:true,scoreColumns:['01卷物理单选15'],regions:[{page:1,x:.05,y:.1,w:.5,h:.1}]}};
assert.equal(w.notebookReviewStatus({batchId:'exam',subjectName:'物理',itemName:'1'}),false);
layout.pdf_info[0].para_blocks[0].lines[0].spans[0].content='15. Question';layout.pdf_info[0].para_blocks[2].lines[0].spans[0].content='16. Question';layout.pdf_info[1].para_blocks[2].lines[0].spans[0].content='23. Question';
await w.openPaperCropWorkspace();
assert.deepEqual([...w.document.querySelectorAll('[data-question]')].map(b=>b.dataset.question),['15','16','23']);
assert.match($('[data-title]').textContent,/15/);assert.match($('[data-progress]').textContent,/0 \/ 3/);
assert.match($('[data-message]').textContent,/已使用 MinerU 坐标/);
console.log('PASS workspace: real two-page PDF/MinerU layout, all-score list, confirm-next, draft, undo/redo, complete, shared PNG crops, rollback, real DOCX image packaging, automatic open, paper-header regression, continuous multi-page editing and reviewed overlap approvals');
await w.happyDOM.close();

