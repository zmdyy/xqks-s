'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];let workers=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('worker',w=>{if(w.url().endsWith('seating-search-worker.js'))workers++;});page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!dataOperationBusy);
  await page.evaluate(async()=>{
   window.showAlert=()=>{};
   allSubjectHeaders=[{name:'总分'},{name:'数学'},{name:'物理'}];
   combinedStudentData=Array.from({length:8},(_,i)=>({name:'学生'+i,class:'01班',subjects:{总分:{score:100-i,gradeRank:10+i*2},数学:{score:i===0?0:i*10,gradeRank:(i+1)*10},物理:{score:80-i*10,gradeRank:(8-i)*10}}}));
   const a=DataPool.addBatch('考试A',{combinedStudentData:AppCore.clone(combinedStudentData),allSubjectHeaders});a.id='examA';DataPool.currentBatchId=a.id;
   const history=AppCore.clone(combinedStudentData);history.forEach((s,i)=>{s.subjects.总分.gradeRank=40+i*4;s.subjects.数学.gradeRank=(i+1)*20;s.subjects.物理.gradeRank=(8-i)*20;});history[0].subjects.物理.score='缺考';
   const b=DataPool.addBatch('考试B',{combinedStudentData:history,allSubjectHeaders});b.id='examB';DataPool.currentBatchId='examA';await persistBatches();
  });
  await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===8);
  await page.selectOption('#sm-currentExam','examA');await page.selectOption('#sm-compareExam','examB');await page.selectOption('#sm-academicScope','grade');
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('学生0').compositeRank),null,'missing grade denominators must be visible');
  await page.click('#sm-btnAdvanced');
  await page.fill('[data-sm-population-exam="examA"][data-sm-population-subject="*"]','100');
  await page.fill('[data-sm-population-exam="examB"][data-sm-population-subject="*"]','200');
  await page.evaluate(()=>seatingModuleInstance.applyAdvancedSettings());
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('学生0').compositeRank),15);
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('学生0').subjects.物理.sampleCount),1);
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getAcademicContext().pairs.length),28);
  assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance,c=m.getAcademicContext(),a=m.seatMap.indexOf('学生1'),b=m.seatMap.indexOf('学生2');[m.seatMap[a],m.seatMap[b]]=[m.seatMap[b],m.seatMap[a]];m.saveAndRender('测试复用缓存');return c.allowed===m.getAcademicContext().allowed;}),true);
  await page.evaluate(async()=>{seatingModuleInstance.getStudent('学生0').status='fixed';await seatingModuleInstance.saveAndRender('固定座位');await seatingStore.flush();});
  const fixed=await page.evaluate(()=>seatingModuleInstance.seatMap.indexOf('学生0'));
  await page.reload();await page.waitForFunction(()=>!dataOperationBusy);await page.evaluate(()=>window.showAlert=()=>{});await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===8);
  assert.equal(await page.locator('#sm-currentExam').inputValue(),'examA');assert.equal(await page.locator('#sm-compareExam').inputValue(),'examB');
  assert.equal(await page.evaluate(()=>seatingModuleInstance.advancedSettings.academic.populations.examB['*']),200);
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('学生0').compositeRank),15);
  // Restore a placement made before exam selection: current academic settings remain selected.
  await page.evaluate(async()=>{await seatingModuleInstance.loadSnapshot(0);await seatingStore.flush();});
  assert.equal(await page.evaluate(()=>seatingModuleInstance.advancedSettings.academic.currentExam),'examA');
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('学生0').compositeRank),15);
  await page.evaluate(()=>{const m=seatingModuleInstance;m.getStudent('学生0').status='fixed';m.saveAndRender('再次固定');m.advancedSettings.searchBudgetMs=300;window.uiTicks=0;window.tickTimer=setInterval(()=>uiTicks++,10);window.searchDone=false;m.runOptimization('academic').then(()=>searchDone=true);});
  await page.waitForFunction(()=>searchDone);await page.evaluate(()=>clearInterval(tickTimer));
  assert.ok(workers>0,'search must run in a real worker');assert.ok(await page.evaluate(()=>uiTicks)>5,'UI timers must keep running during search');
  assert.ok(await page.evaluate(()=>seatingModuleInstance.lastOptimization?.evaluations)>0);
  assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance,c=m.getAcademicContext();return SeatingEngine.valid(c,c.original)}),true);
  assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap.indexOf('学生0')),fixed);
  assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance,r=buildSeatingReadableData('01班');return r.scopeLabel==='年级位置'&&r.metrics.dual===m.lastOptimization.metrics.dual&&r.students.find(s=>s.name==='学生0').percentile===15;}),true);
  assert.equal(await page.evaluate(()=>{const links=seatingModuleInstance.buildRecommendedHelpLinks();return links.length>0&&links.every(edge=>SeatingData.complementDetails(seatingModuleInstance.getStudent(edge.source),seatingModuleInstance.getStudent(edge.target)).some(d=>d.helper===edge.source&&d.recipient===edge.target));}),true);
  await page.click('#sm-btnHelpGraph');await page.waitForFunction(()=>!!echarts.getInstanceByDom(document.getElementById('sm-helpGraphChart')));await page.click('#sm-btnCloseHelpGraph');
  assert.match(await page.evaluate(()=>generateSeatingReport('01班')),/年级位置/);
  // A later edit cancels and cannot be overwritten by an old worker's reply.
  await page.evaluate(()=>{const m=seatingModuleInstance;m.advancedSettings.searchBudgetMs=5000;window.cancelDone=false;m.runOptimization('academic').then(()=>cancelDone=true);m.getStudent('学生1').tags=['取消后保留'];m.saveAndRender('计算期间修改');window.afterCancel=m.seatMap.slice();});
  await page.waitForFunction(()=>cancelDone);assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),await page.evaluate(()=>afterCancel));
  assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.getStudent('学生1').tags),['取消后保留']);
  // The cooperative fallback keeps the page responsive as well.
  await page.evaluate(()=>{window.originalWorker=window.Worker;window.Worker=undefined;const m=seatingModuleInstance;m.advancedSettings.searchBudgetMs=120;window.fallbackDone=false;window.uiTicks=0;window.tickTimer=setInterval(()=>uiTicks++,10);m.runOptimization('academic').then(()=>fallbackDone=true);});
  await page.waitForFunction(()=>fallbackDone);await page.evaluate(()=>{clearInterval(tickTimer);window.Worker=originalWorker;});assert.ok(await page.evaluate(()=>uiTicks)>1);
  // Removing a selected comparison is explicit; it never selects an unrelated history exam.
  await page.evaluate(()=>{DataPool.batches=DataPool.batches.filter(b=>b.id!=='examB');});await page.click('#seatingRefreshBtn');
  assert.match(await page.locator('#sm-compareExam').textContent(),/已删除/);assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('学生0').sampleCount),1);
  assert.deepEqual(errors,[]);
  console.log('PASS seating search browser: exam selectors, grade populations, cached pairs, reload/restore, real worker responsiveness, fixed seats, stale-result cancellation and cooperative fallback');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
