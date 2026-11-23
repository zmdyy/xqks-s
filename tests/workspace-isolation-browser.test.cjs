'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):['--no-sandbox']});
 try{
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage(),errors=[];
  a.on('pageerror',e=>errors.push('A: '+e.message));b.on('pageerror',e=>errors.push('B: '+e.message));
  const base='http://127.0.0.1:'+server.address().port;
  await Promise.all([a.goto(base+'/?workspace=parallel-grade8'),b.goto(base+'/?workspace=parallel-grade9')]);
  await Promise.all([a.waitForFunction(()=>!dataOperationBusy),b.waitForFunction(()=>!dataOperationBusy)]);
  await a.evaluate(async()=>{const students=[{name:'八年级专属学生',class:'801',subjects:{总分:{score:88}}}];DataPool.addBatch('八年级期中',{combinedStudentData:students,allSubjectHeaders:[{name:'总分'}]});await persistBatches();});
  await b.evaluate(async()=>{const students=[{name:'九年级专属学生',class:'901',subjects:{总分:{score:99}}}];DataPool.addBatch('九年级期中',{combinedStudentData:students,allSubjectHeaders:[{name:'总分'}]});await persistBatches();});
  assert.equal(await a.evaluate(()=>DataPool.batches[0].combinedStudentData[0].name),'八年级专属学生');
  assert.equal(await b.evaluate(()=>DataPool.batches[0].combinedStudentData[0].name),'九年级专属学生');
  const dbNames=await Promise.all([a.evaluate(()=>AppCore.storage.databaseName()),b.evaluate(()=>AppCore.storage.databaseName())]);assert.notEqual(dbNames[0],dbNames[1]);
  await Promise.all([a.reload(),b.reload()]);
  await Promise.all([a.waitForFunction(()=>!dataOperationBusy),b.waitForFunction(()=>!dataOperationBusy)]);
  assert.equal(await a.evaluate(()=>DataPool.batches.length),1);assert.equal(await b.evaluate(()=>DataPool.batches.length),1);
  assert.equal(await a.evaluate(()=>DataPool.batches[0].combinedStudentData[0].name),'八年级专属学生');
  assert.equal(await b.evaluate(()=>DataPool.batches[0].combinedStudentData[0].name),'九年级专属学生');
  assert.deepEqual(errors,[]);
  await context.close();
  const lockContext=await browser.newContext(),first=await lockContext.newPage(),second=await lockContext.newPage();
  await first.goto(base+'/?workspace=single-editor');await first.waitForFunction(()=>!dataOperationBusy);
  await second.goto(base+'/?workspace=single-editor');await second.waitForSelector('.workspace-dialog-backdrop');
  assert.match(await second.locator('.workspace-lock-note').textContent(),/另一个页面打开/);
  await lockContext.close();
  console.log('PASS browser workspace isolation: parallel grades, reload persistence and duplicate-editor guard');
 }finally{await browser.close().catch(()=>{});server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
