'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!dataOperationBusy);
  await page.evaluate(async()=>{
   window.showAlert=()=>{};
   allSubjectHeaders=[{name:'总分'},{name:'数学'},{name:'英语'},{name:'英语合'},{name:'英语听说'},{name:'英语笔试'}];
   combinedStudentData=Array.from({length:16},(_,i)=>({name:'学生'+i,class:'01班',subjects:{总分:{score:100},数学:{score:i*5},英语:{score:''},英语合:{score:100-i},英语听说:{score:20+i},英语笔试:{score:80-i}}}));
   DataPool.addBatch('布局测试',{combinedStudentData,allSubjectHeaders});await persistBatches();
  });
  await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===16);
  assert.doesNotMatch(await page.locator('#seating-module-root').textContent(),/两次总分有效|其余按单次有效记录|年级依据不足时|已准备 \d+ 对学生/);
  assert.equal(await page.locator('#sm-searchStatus').textContent(),'');assert.equal(await page.locator('#sm-searchStatus').isVisible(),false);
  async function settled(){await page.evaluate(async()=>{if(seatingModuleInstance.pendingSave)await seatingModuleInstance.pendingSave;await seatingStore.flush();});}
  const before=await page.evaluate(()=>{const m=seatingModuleInstance;return {map:m.seatMap.slice(),ids:m.seatIds.slice()};});
  const fixedName=before.map[0],fixedId=before.ids[0],waiting=before.map[1];
  await page.evaluate(({fixedName,waiting})=>{const m=seatingModuleInstance;m.getStudent(fixedName).status='fixed';m.seatMap[m.seatMap.indexOf(waiting)]=null;m.saveAndRender('固定与待分配');},{fixedName,waiting});await settled();
  const baseline=await page.evaluate(()=>seatingModuleInstance.historySnapshots.length-1);
  await page.evaluate(name=>seatingModuleInstance.openModal(name),fixedName);
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('sm-editModal')).right==='0px');
  const cells=await page.locator('#sm-analysisContent tbody tr').allTextContents();assert.equal(cells.length,3);assert.match(cells[0],/总分/);assert.ok(cells.some(s=>s.startsWith('英语')));assert.ok(cells.every(s=>!s.includes('本次')&&!s.includes('人数')));
  if(process.env.SEATING_POSITION_SCREENSHOT)await page.screenshot({path:process.env.SEATING_POSITION_SCREENSHOT});
  await page.click('#sm-btnCloseModal');
  assert.equal(await page.locator('.sm-add-seat:visible').count(),0);await page.click('#sm-btnAddSeats');assert.equal(await page.locator('.sm-add-edge').count(),16);
  await page.click('[data-sm-add-side="top"][data-sm-add-col="0"]');await settled();
  assert.equal(await page.locator('.seat').count(),17);assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap.length),24);
  assert.equal(await page.evaluate(({name,id})=>{const m=seatingModuleInstance;return m.seatIds[m.seatMap.indexOf(name)]===id;},{name:fixedName,id:fixedId}),true);
  const newId=await page.evaluate(()=>seatingModuleInstance.seatIds[0]);
  await page.click('[data-sm-add-index="1"]');await settled();assert.equal(await page.locator('.seat').count(),18);
  // Assign a waiting student through the actual drag/drop handlers.
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator('#sm-unseatedList .student-item').filter({hasText:waiting}).dispatchEvent('dragstart',{dataTransfer:transfer});
  await page.locator('[data-seat-id="'+newId+'"]').dispatchEvent('drop',{dataTransfer:transfer});await settled();
  assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap[0]),waiting);
  await page.click('[data-sm-add-row="bottom"]');await settled();assert.equal(await page.locator('.seat').count(),26);
  await page.click('[data-sm-add-side="bottom"][data-sm-add-col="7"]');await settled();assert.equal(await page.locator('.seat').count(),27);
  await page.click('#sm-btnAddSeats');assert.equal(await page.locator('.sm-add-seat:visible').count(),0);assert.equal(await page.locator('.sm-seat-spacer').count(),13);
  const layout=await page.evaluate(()=>{const m=seatingModuleInstance;return {map:m.seatMap.slice(),ids:m.seatIds.slice(),count:m.historySnapshots.length};});
  await page.reload();await page.waitForFunction(()=>!dataOperationBusy);await page.evaluate(()=>window.showAlert=()=>{});await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===16);await settled();
  assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatIds),layout.ids);assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),layout.map);assert.equal(await page.locator('.seat').count(),27);
  assert.equal(await page.evaluate(()=>seatingModuleInstance.getDeskPartner(0)),null,'an unoccupied new neighbor does not create a fictitious partner');
  assert.equal(await page.evaluate(()=>seatingModuleInstance.calculateSeatingStats()['空余座位'].value),11,'placeholder cells must not be counted as seats');
  for(const mode of ['shift','swap','serpentine','fullCycle']){
   await page.selectOption('#sm-rotationMode',mode);await page.click('#sm-btnRotate');await settled();
   assert.equal(await page.evaluate(({name,id})=>{const m=seatingModuleInstance;return m.seatIds[m.seatMap.indexOf(name)]===id;},{name:fixedName,id:fixedId}),true);
   assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance;return m.seatMap.every((n,i)=>m.seatIds[i]!==null || n===null)}),true);
  }
  await page.evaluate(async()=>{const m=seatingModuleInstance;m.advancedSettings.searchBudgetMs=200;await m.runOptimization('academic');});await settled();
  assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance,c=m.getAcademicContext();return SeatingEngine.valid(c,c.original)}),true);
  assert.equal(await page.evaluate(({name,id})=>{const m=seatingModuleInstance;return m.seatIds[m.seatMap.indexOf(name)]===id;},{name:fixedName,id:fixedId}),true);
  assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance,r=buildSeatingReadableData('01班');return r.seatMap.filter(s=>s?.absent).length===13&&r.metrics.dual===m.lastOptimization.metrics.dual}),true);
  assert.equal(await page.evaluate(()=>{
   const m=seatingModuleInstance,r=buildSeatingReadableData('01班'),stats=m.calculateSeatingStats(),pairs=[['单向帮助同桌','oneWay'],['无互补高高同桌','highCrowding'],['无互补低低同桌','lowCrowding'],['无互补混搭同桌','mixed'],['左右高分强化','horizontal'],['上下高分强化','vertical']];
   const write=XLSX.writeFile;let wb;XLSX.writeFile=value=>wb=value;try{m.exportData();}finally{XLSX.writeFile=write;}
   const rows=XLSX.utils.sheet_to_json(wb.Sheets['统计汇总'],{header:1});
   return pairs.every(([label,key])=>stats[label].value===r.metrics[key]&&r.metrics[key]===m.lastOptimization.metrics[key]&&rows.find(row=>row[0]===label)[1]===r.metrics[key]);
  }),true,'engine, report, page and Excel use identical dispersion/reinforcement metrics');
  assert.match(await page.evaluate(()=>generateSeatingReport('01班')),/—/);
  await page.evaluate(()=>renderSeatingReadableReport('01班'));assert.match(await page.locator('#comprehensiveReadableReportContent').textContent(),/左右高分强化/);
  assert.match(await page.evaluate(()=>generateSeatingReport('01班')),/无互补高＋高/);
  // Return to the seating tab after rendering the report view.
  await page.click('[data-tab="tab-seating"]');
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#sm-btnRecoveryExport')]);const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(backup.seatIds.filter(Boolean).length,27);
  await page.evaluate(async i=>{await seatingModuleInstance.loadSnapshot(i);await seatingStore.flush();},baseline);
  assert.equal(await page.locator('.seat').count(),16);assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatIds),before.ids);assert.ok(await page.evaluate(()=>seatingModuleInstance.historySnapshots.length)>layout.count);
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.click('#sm-btnImport')]);await chooser.setFiles({name:'layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>seatingModuleInstance.latestSnapshot?.reason==='导入复原JSON');await settled();
  assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatIds),backup.seatIds);assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),backup.seatMap);
  // Explicit reload fills waiting students; a browser reload still preserves manual waiting.
  const partial=await page.evaluate(()=>{
   const m=seatingModuleInstance,name=m.students.find(s=>s.status!=='fixed').name;
   const index=m.seatMap.indexOf(name);m.seatMap[index]=null;
   const blocked=m.seatMap.findIndex((n,i)=>n===null && m.seatIds[i]!==null && i!==index);
   m.seatMap[blocked]='🚫';m.saveAndRender('部分待分配与禁用');return {name,map:m.seatMap.slice(),ids:m.seatIds.slice(),blocked};
  });await settled();
  await page.reload();await page.waitForFunction(()=>!dataOperationBusy);await page.evaluate(()=>window.showAlert=()=>{});await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===16);await settled();
  assert.equal(await page.evaluate(name=>seatingModuleInstance.seatMap.includes(name),partial.name),false);
  await page.click('#seatingRefreshBtn');await page.waitForFunction(()=>seatingModuleInstance.students.every(s=>seatingModuleInstance.seatMap.includes(s.name)));await settled();
  assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatIds),partial.ids);
  const reloaded=await page.evaluate(()=>seatingModuleInstance.seatMap);
  partial.map.forEach((name,i)=>{if(name)assert.equal(reloaded[i],name,'reloading must not move existing students or blocked seats');});
  assert.equal(await page.evaluate(({name,id})=>{const m=seatingModuleInstance;return m.seatIds[m.seatMap.indexOf(name)]===id;},{name:fixedName,id:fixedId}),true);
  assert.equal(await page.evaluate(()=>seatingModuleInstance.latestSnapshot.reason),'重新加载学生，补齐空座');
  await page.click('#sm-btnClear');await settled();assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap.filter(n=>n && n!=='🚫').length),0);
  await page.reload();await page.waitForFunction(()=>!dataOperationBusy);await page.evaluate(()=>window.showAlert=()=>{});await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===16);await settled();
  assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap.filter(n=>n && n!=='🚫').length),0);
  await page.click('#sm-btnRefresh');await page.waitForFunction(()=>seatingModuleInstance.students.every(s=>seatingModuleInstance.seatMap.includes(s.name)));await settled();
  assert.equal(await page.locator('#sm-unseatedList .student-item').count(),0);assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatIds),partial.ids);
  assert.equal(await page.evaluate(i=>seatingModuleInstance.seatMap[i],partial.blocked),'🚫');
  assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance;return m.seatMap.every((n,i)=>m.seatIds[i]!==null || n===null)}),true);
  const complete=await page.evaluate(()=>seatingModuleInstance.seatMap.slice());
  await page.reload();await page.waitForFunction(()=>!dataOperationBusy);await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===16);await settled();
  assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),complete);
  assert.doesNotMatch(await page.locator('#seating-module-root').textContent(),/两次总分有效|其余按单次有效记录|年级依据不足时|已准备 \d+ 对学生/);
  if(process.env.SEATING_LAYOUT_SCREENSHOT){await page.click('#sm-btnAddSeats');await page.screenshot({path:process.env.SEATING_LAYOUT_SCREENSHOT,fullPage:true});}
  assert.deepEqual(errors,[]);console.log('PASS seating layout browser: compact subject averages, one English total, direct edge/row additions, drag/drop, stable fixed IDs, rotation, worker search, reports, snapshot/JSON recovery, both explicit reload buttons filling waiting/cleared seats and hidden academic/cache notes');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
