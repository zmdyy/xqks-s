'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
    const server=http.createServer((req,res)=>{
        const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url='http://127.0.0.1:'+server.address().port,dir=fs.mkdtempSync(path.join(os.tmpdir(),'seating-regression-'));
    const launch=()=>chromium.launchPersistentContext(dir,{headless:true,viewport:{width:1600,height:1100},...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):['--no-sandbox']});
    let context=await launch();const errors=[];
    async function open(){const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);await page.waitForFunction(()=>!dataOperationBusy);return page;}
    async function settled(page){await page.evaluate(async()=>{if(seatingModuleInstance?.pendingSave)await seatingModuleInstance.pendingSave;await seatingStore.flush().catch(()=>{})});}
    try {
        let page=await open();
        await page.evaluate(async()=>{
            window.showAlert=()=>{};
            const students=Array.from({length:16},(_,i)=>({name:i<10?'一班学生'+i:'二班学生'+i,class:i<10?'01班':'02班',subjects:{总分:{score:100-i,gradeRank:100+i},物理:{score:i===3?'':100-i*5,gradeRank:500+i},数学:{score:i*5,gradeRank:900+i}}}));
            combinedStudentData=students;allSubjectHeaders=[{name:'总分',scoreIndex:2},{name:'物理',scoreIndex:3},{name:'数学',scoreIndex:4}];
            DataPool.addBatch('座位测试',{combinedStudentData:students,allSubjectHeaders,uploadedFilesData:{},uploadedPdfs:[]});await persistBatches();
        });
        await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.className==='01班' && seatingModuleInstance.students.length===10);await settled(page);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.students.find(s=>s.name==='一班学生3').subjects.物理.percentile),null);
        assert.ok(await page.evaluate(()=>seatingModuleInstance.students.every(s=>s.compositeRank>=0 && s.compositeRank<=100)));
        await page.evaluate(()=>seatingModuleInstance.openModal('一班学生0'));
        await page.click('[data-sm-status="fixed"]');await settled(page);await page.click('[data-sm-tag="自律"]');await settled(page);await page.click('#sm-btnCloseModal');
        const fixedIndex=await page.evaluate(()=>seatingModuleInstance.seatMap.indexOf('一班学生0'));
        await page.evaluate(()=>{const m=seatingModuleInstance;m.moveStudent('一班学生1',m.seatMap.indexOf('一班学生2'));m.seatMap[15]='🚫';m.saveAndRender('设置禁用空位')});await settled(page);
        const arranged=await page.evaluate(()=>seatingModuleInstance.seatMap.slice());
        // Current scores update, while the same class keeps its manual work.
        await page.evaluate(async()=>{combinedStudentData.find(s=>s.name==='一班学生4').subjects.总分.score=140;await DataPool.syncFromGlobalsIfEditing()});
        await page.click('#seatingRefreshBtn');await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),arranged);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生0').status),'fixed');
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生0').tags),['自律']);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生4').latestTotalRank),1);
        // Applying settings leaves the seat map intact, and zero weights really disable a term.
        await page.click('#sm-btnAdvanced');await page.selectOption('#sm-groupSize','4');
        await page.evaluate(()=>{const m=seatingModuleInstance;m.updateWeight('complement',0);m.applyAdvancedSettings()});await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),arranged);
        assert.equal(await page.evaluate(()=>{const m=seatingModuleInstance,o=new m.SeatingOptimizer(m.students,m.seatMap,m.advancedSettings,m);o.optimize=()=>o.weights;return o.optimizeForTarget('overall').complement}),0);
        assert.ok(await page.evaluate(()=>SeatingData.groups(seatingModuleInstance.seatMap,4).every(g=>g.length<=4)));
        for(const mode of ['shift','swap','serpentine','fullCycle']) {
            await page.selectOption('#sm-rotationMode',mode);await page.click('#sm-btnRotate');await settled(page);
            assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap.indexOf('一班学生0')),fixedIndex);
            assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap[15]),'🚫');
            assert.equal(await page.evaluate(()=>new Set(seatingModuleInstance.seatMap.filter(n=>n && n!=='🚫')).size),10);
        }
        // Exercise the actual optimizer with spare seats, fixed seats and a blocked slot.
        await page.evaluate(()=>{const m=seatingModuleInstance,o=new m.SeatingOptimizer(m.students,m.seatMap,m.advancedSettings,m);const result=o.optimizeForTarget('academic');if(!SeatingData.validMap(result.solution,m.students,m.seatMap))throw new Error('优化器产生重复或遗漏');m.seatMap=result.solution;m.saveAndRender('测试实际智能排座')});await settled(page);
        // More than ten mutations must retain the earliest snapshot.
        for(let i=0;i<12;i++){await page.evaluate(i=>{const m=seatingModuleInstance;m.getStudent('一班学生1').tags=['自律'+i];m.saveAndRender('标签调整'+i)},i);await settled(page);}
        const count=await page.evaluate(()=>seatingModuleInstance.historySnapshots.length);assert.ok(count>20);
        const first=await page.evaluate(()=>seatingModuleInstance.historySnapshots[0]);
        assert.ok(await page.evaluate(async entry=>!!(await seatingStore.snapshot('01班',entry)).students.length,first));
        const mapBeforeReload=await page.evaluate(()=>seatingModuleInstance.seatMap.slice());
        await page.reload();await page.waitForFunction(()=>!dataOperationBusy);await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.students.length===10);await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),mapBeforeReload);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生0').status),'fixed');
        assert.ok(await page.evaluate(()=>seatingModuleInstance.historySnapshots.length)>=count);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.advancedSettings.groupSize),4);
        // A new score batch for the same class keeps placement and updates current metrics.
        await page.evaluate(async()=>{const next=AppCore.clone(DataPool.getCurrentBatch());next.id='seat-next';next.label='新的考试';next.combinedStudentData.find(s=>s.name==='一班学生5').subjects.总分.score=200;DataPool.batches.push(next);loadBatch(next.id);await persistBatches()});
        await page.click('#seatingRefreshBtn');await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),mapBeforeReload);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生5').latestTotalRank),1);
        // Migrate an identifiable old global snapshot into the correct class workspace.
        await page.evaluate(async()=>{
            const state=SeatingData.reconcile(buildSeatingProfiles('02班'),null);
            state.students[0].tags=['旧版保留标签'];
            await AppCore.storage.write('seating_snapshots',[{...state,className:'02班',showTags:false,advancedSettings:AppCore.clone(seatingModuleInstance.advancedSettings),label:'旧版排位'}]);
        });
        await page.selectOption('#seatingClassFilter','02班');await page.waitForFunction(()=>seatingModuleInstance?.className==='02班');await settled(page);
        assert.ok(await page.evaluate(()=>seatingModuleInstance.students.every(s=>s.name.startsWith('二班'))));
        assert.equal(await page.evaluate(()=>seatingModuleInstance.historySnapshots.length),1);
        assert.ok(await page.evaluate(()=>seatingModuleInstance.students.some(s=>s.tags.includes('旧版保留标签'))));
        assert.equal(await page.evaluate(()=>seatingModuleInstance.showTags),false);
        await page.selectOption('#seatingClassFilter','01班');await page.waitForFunction(()=>seatingModuleInstance?.className==='01班');await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),mapBeforeReload);
        // Restoring an old placement preserves current-exam academic statistics.
        await page.evaluate(()=>seatingModuleInstance.loadSnapshot(0));await settled(page);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生5').latestTotalRank),1);
        assert.ok(await page.evaluate(()=>seatingModuleInstance.historySnapshots.length)>count);
        // Excel, the readable report and the main UI use the same current statistics/map.
        assert.equal(await page.evaluate(()=>{
            const m=seatingModuleInstance,write=XLSX.writeFile;let workbook;
            XLSX.writeFile=wb=>workbook=wb;try{m.exportData()}finally{XLSX.writeFile=write}
            const rows=XLSX.utils.sheet_to_json(workbook.Sheets['学生详细信息'],{header:1});
            if(rows.find(row=>row[0]==='一班学生5')[4]!==1)return false;
            const pairs=XLSX.utils.sheet_to_json(workbook.Sheets['学科互补分析'],{header:1}).slice(1);
            if(!pairs.every(row=>row[6]===SeatingData.complementDetails(m.getStudent(row[0]),m.getStudent(row[1])).map(d=>d.subject+': '+d.helper+'→'+d.recipient).join('；')))return false;
            const report=buildSeatingReadableData('01班');
            return report.actualPlacement && JSON.stringify(report.seatMap.map(s=>s?.name || null))===JSON.stringify(m.seatMap.map(n=>n==='🚫'?null:n));
        }),true);
        await page.click('#modalConfirmBtn');
        const [download]=await Promise.all([page.waitForEvent('download'),page.click('#sm-btnRecoveryExport')]);
        const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
        const historyBeforeImport=await page.evaluate(()=>seatingModuleInstance.historySnapshots.length);
        await page.evaluate(()=>seatingModuleInstance.clearAll());await settled(page);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.seatMap.filter(n=>n && n!=='🚫').length),0);
        const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.click('#sm-btnImport')]);
        await chooser.setFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
        await page.waitForFunction(()=>seatingModuleInstance.latestSnapshot?.reason==='导入复原JSON');await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.seatMap),backup.seatMap);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生5').latestTotalRank),1);
        assert.ok(await page.evaluate(()=>seatingModuleInstance.historySnapshots.length)>historyBeforeImport);
        assert.equal(await page.evaluate(()=>{
            const m=seatingModuleInstance,students=m.students.map(s=>({...s,gradient:0,compositeRank:null,subjects:{}}));
            const optimizer=new m.SeatingOptimizer(students,m.seatMap,m.advancedSettings,m);
            optimizer.weights={complement:1,behavior:0,group:0,constraints:0,balance:1};
            return optimizer.evaluateSolution(m.seatMap);
        }),0,'unknown grades must not create balance or complement scores');
        assert.ok(await page.evaluate(()=>{
            const root=document.querySelector('#seating-module-root'),main=root.querySelector('.seating-main'),seats=root.querySelectorAll('.seat');
            return Array.from(seats).every(seat=>seat.getBoundingClientRect().right<=main.getBoundingClientRect().right);
        }),'seat labels must not push the last columns outside the visible layout');
        if(process.env.SEATING_SCREENSHOT)await page.screenshot({path:process.env.SEATING_SCREENSHOT,fullPage:true});
        // A denied database write must show a real failure, with a durable local journal.
        await page.evaluate(()=>{window.savedWrite=AppCore.storage.write;AppCore.storage.write=async()=>{throw new Error('测试存储不足')};seatingModuleInstance.getStudent('一班学生1').tags=['失败后保留'];return seatingModuleInstance.saveAndRender('存储失败测试')});
        assert.match(await page.locator('#sm-saveStatus').textContent(),/写入失败/);
        await page.evaluate(async()=>{AppCore.storage.write=window.savedWrite;await seatingModuleInstance.saveSnapshot('重试保存')});await settled(page);
        // Simulate closing the entire browser before an asynchronous write commits.
        await page.evaluate(()=>{AppCore.storage.write=()=>new Promise(()=>{});seatingModuleInstance.getStudent('一班学生1').tags=['关闭前第一改动'];seatingModuleInstance.saveAndRender('关闭前第一调整');seatingModuleInstance.getStudent('一班学生1').tags=['关闭浏览器前最后改动'];seatingModuleInstance.saveAndRender('关闭前第二调整')});
        await context.close();context=await launch();page=await open();
        await page.click('[data-tab="tab-seating"]');await page.waitForFunction(()=>seatingModuleInstance?.className==='01班');await settled(page);
        assert.deepEqual(await page.evaluate(()=>seatingModuleInstance.getStudent('一班学生1').tags),['关闭浏览器前最后改动']);
        assert.ok(await page.evaluate(()=>seatingModuleInstance.historySnapshots.length)>count);
        assert.deepEqual(await page.evaluate(async()=>{
            const entries=seatingModuleInstance.historySnapshots.filter(s=>['关闭前第一调整','关闭前第二调整'].includes(s.reason));
            return Promise.all(entries.map(async entry=>(await seatingStore.snapshot('01班',entry)).students.find(s=>s.name==='一班学生1').tags[0]));
        }),['关闭前第一改动','关闭浏览器前最后改动']);
        // With no active score batch, the stored class roster/placement remains recoverable.
        await page.evaluate(()=>loadBatch(null));await page.click('#seatingRefreshBtn');await settled(page);
        assert.equal(await page.evaluate(()=>seatingModuleInstance.students.length),10);
        assert.deepEqual(errors,[]);
        console.log('PASS seating browser: auto snapshots, retained locks/tags/layout, current-score refresh, batch/class isolation, earliest snapshot restore, fixed/blocked rotations, real optimizer, failed writes, full browser restart and interrupted-write journal recovery');
    } finally {await context.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
