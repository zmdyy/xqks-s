const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('notebook-crop-review.js', 'utf8');
const canvases = [];
const batch = {id:'exam-1',uploadedPdfs:[{id:'pdf-1',fileName:'paper.pdf',fileData:new Uint8Array([1,2,3])}],notebookCropReviews:{}};
const context = {window:{}, DataPool:{batches:[batch]}, notebookMajorFromItem:s=>String(s).match(/\d+/)?.[0], notebookPdfBytes:p=>p.fileData,
 pdfjsLib:{getDocument:()=>({promise:Promise.resolve({getPage:async n=>({getViewport:()=>({width:100,height:200}),render:()=>({promise:Promise.resolve()})})})})},
 document:{createElement(){const c={width:0,height:0,getContext(){return {fillRect(){},drawImage(){}}},toDataURL(){return `data:image/png,${this.width}x${this.height}`}};canvases.push(c);return c;}}};
vm.createContext(context);vm.runInContext(source,context);
(async()=>{
 const item={batchId:'exam-1',subjectName:'物理',itemName:'14(1)'};
 assert.equal(await context.window.notebookReviewedSnapshots(item),null);
 batch.notebookCropReviews[JSON.stringify(['物理','14'])]={scoreColumns:['14(1)','14(2)'],fileId:'pdf-1',fileName:'paper.pdf',confirmed:true,regions:[{page:1,x:.1,y:.2,w:.5,h:.25},{page:2,x:.2,y:.1,w:.4,h:.3}]};
 const first=await context.window.notebookReviewedSnapshots(item);
 const second=await context.window.notebookReviewedSnapshots({...item,itemName:'14(2)'});
 assert.deepEqual(Array.from(first),['data:image/png,50x50','data:image/png,40x60']);
 assert.deepEqual(Array.from(second),Array.from(first));
 assert.equal(await context.window.notebookReviewedSnapshots({...item,subjectName:'数学'}),null);
 batch.notebookCropReviews[JSON.stringify(['物理','14'])].confirmed=false;
 assert.equal(await context.window.notebookReviewedSnapshots(item),null);
 batch.notebookCropReviews[JSON.stringify(['物理','14'])].confirmed=true;
 batch.uploadedPdfs[0].id='replacement';
 assert.equal(await context.window.notebookReviewedSnapshots(item),null);
 console.log('Shared crop tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
