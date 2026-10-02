'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const XLSX = require('../xlsx.full.min.js');
const root = path.resolve(__dirname, '..');
function workbook(name, rows, merges=[]) {
    const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!merges'] = merges;
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '成绩');
    return {name, mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer:Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'}))};
}
const head = [['姓名','班级','物理','','总分',''],['','','分数','等级','分数','等级']];
const merges = [{s:{r:0,c:2},e:{r:0,c:3}},{s:{r:0,c:4},e:{r:0,c:5}}];
(async function() {
    const server = http.createServer((req,res) => {
        const name = decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]);
        const file = path.resolve(root, '.' + name);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}), args:process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : ['--no-sandbox']});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        let workerLoads=0; page.on('response', r => { if(r.url().endsWith('/spreadsheet-worker.js') && r.ok()) workerLoads++; });
        await page.route('**/reports.js',async route=>{await new Promise(r=>setTimeout(r,120));await route.continue()});
        await page.route('**/class-comparison.js',async route=>{await new Promise(r=>setTimeout(r,40));await route.continue()});
        await page.route('**/seating.js',async route=>{await new Promise(r=>setTimeout(r,80));await route.continue()});
        await page.goto(url); await page.waitForFunction(()=>!document.getElementById('importDataBtn').disabled);
        await page.evaluate(()=>{window.mergeCalls=0;window.originalMerge=combineAllStudentData;combineAllStudentData=function(...args){window.mergeCalls++;return window.originalMerge(...args)}});
        const main1=workbook('总表一.xlsx',head.concat([[' 同名 ','８０１','０','c',0,'C'],['同名','802',60,'A',100,'A'],['李四','801',55,'B',95,'B']]),merges);
        const main2=workbook('总表二.xlsx',head.concat([['王五','一班',50,'B',90,'B'],['赵六','802',30,'C',60,'C']]),merges);
        await page.locator('#dataFileInput').setInputFiles([main1,main2]);
        await page.waitForFunction(()=>!dataOperationBusy && combinedStudentData.length===5);
        assert.equal(await page.evaluate(()=>mergeCalls),1,'multiple files must merge once');
        assert.equal(await page.evaluate(()=>combinedStudentData.find(s=>s.name==='同名' && s.class==='01班').subjects['物理'].score),0);
        assert.equal(await page.evaluate(()=>combinedStudentData.find(s=>s.name==='同名' && s.class==='01班').subjects['物理'].grade),'C');
        assert.ok(workerLoads>=2,'large spreadsheet parsing must use workers');
        const sub=workbook('小题.xlsx', [['姓名','班级','物理','物理','物理'],['','','第1题（2分）','第2题（3分）','等级'],['同名','01班',0,2,'A'],['同名','02班',2,3,'A'],['李四','01班',1,1,'B'],['王五','01班',1,2,'B'],['赵六','02班',0,0,'C']]);
        await page.selectOption('#importDataType','sub'); await page.locator('#dataFileInput').setInputFiles(sub);
        await page.waitForFunction(()=>!dataOperationBusy && Object.keys(uploadedFilesData).length===3);
        assert.equal(await page.evaluate(()=>combinedStudentData.length),5,'normalized classes must merge');
        assert.equal(await page.evaluate(()=>combinedStudentData.find(s=>s.name==='同名' && s.class==='01班').subjects['物理'].grade),'C','main grades must keep priority');
        assert.ok(await page.evaluate(()=>Object.keys(combinedStudentData[0].subjects['物理'].subScores).length>=2));
        await page.locator('#dataFileInput').setInputFiles(sub); await page.waitForFunction(()=>!dataOperationBusy);
        assert.equal(await page.evaluate(()=>Object.keys(uploadedFilesData).length),3,'re-upload must replace');
        const bad={name:'坏表.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('')};
        await page.locator('#dataFileInput').setInputFiles(bad);await page.waitForFunction(()=>!dataOperationBusy);
        assert.equal(await page.evaluate(()=>combinedStudentData.length),5,'bad import must keep previous data');
        assert.match(await page.locator('#dataImportStatus').textContent(),/文件为空/);
        await page.selectOption('#importDataType','document');
        await page.locator('#dataFileInput').setInputFiles({name:'物理.md',mimeType:'text/markdown',buffer:Buffer.from('# 物理\n1. 示例题目\nA. 选项一\nB. 选项二')});
        await page.waitForFunction(()=>!dataOperationBusy && uploadedPdfs.length===1);
        assert.equal(await page.evaluate(()=>uploadedPdfs[0].source),'md');
        // Retain binary PDFs without going through an external parser.
        await page.evaluate(()=>uploadedPdfs.push({id:'binary',fileName:'物理.pdf',status:'ready',source:'local',markdown:'1. 测试',questionIndex:[],fileData:new Uint8Array([37,80,68,70,45,49])}));
        await page.fill('#newBatchName','回归批次'); await page.click('#saveBatchBtn');
        await page.waitForFunction(()=>!dataOperationBusy && DataPool.batches.length===1 && DataPool.currentBatchId===null);
        assert.equal(await page.locator('#batchSelector').inputValue(),'__new__');
        await page.reload();await page.waitForFunction(()=>!dataOperationBusy && combinedStudentData.length===5);
        assert.equal(await page.evaluate(()=>uploadedPdfs.find(p=>p.fileName.endsWith('.pdf')).fileData instanceof Uint8Array),true);
        assert.equal(await page.evaluate(()=>createPdfFileFromEntry(uploadedPdfs.find(p=>p.fileName.endsWith('.pdf'))).size),6);
        assert.equal(await page.evaluate(()=>Object.values(uploadedFilesData).every(f=>Array.isArray(f.rawData)&&Array.isArray(f.headerMerges))),true);
        await page.selectOption('#mainHeaderRows','2'); assert.equal(await page.evaluate(()=>combinedStudentData.length),5);
        // Visit all analysis views, then exercise selected subject and both heatmap modes.
        for (const tab of ['tab-personal','tab-class-diff','tab-collective','tab-trend','tab-smart','tab-comprehensive','tab-seating','tab-upload']) {
            await page.click('[data-tab="'+tab+'"]'); await page.waitForTimeout(160);
        }
        await page.click('[data-tab="tab-collective"]');
        await page.selectOption('#collectiveSubjectFilter','物理'); await page.waitForTimeout(160);
        assert.ok(await page.evaluate(()=>document.getElementById('collectiveHeatmapChart').querySelector('svg')),'heatmap must draw');
        for (const mode of ['anomaly','student','rate']) {
            await page.selectOption('#collectiveHeatmapMode',mode); await page.waitForTimeout(160);
            assert.ok(await page.evaluate(()=>document.getElementById('collectiveHeatmapChart').querySelector('svg')));
        }
        assert.equal(await page.evaluate(()=>{const c=document.getElementById('collectiveHeatmapChart').__chart;const svg=decodeURIComponent(c.getDataURL({type:'svg'}).split(',').slice(1).join(','));return !!new DOMParser().parseFromString(svg,'image/svg+xml').querySelector('parsererror')}),false,'chart font must produce valid SVG');
        const downloadPromise=page.waitForEvent('download'); await page.click('#collectiveHeatmapExportPngBtn');
        const download=await downloadPromise; const image=fs.readFileSync(await download.path());
        assert.equal(image.subarray(1,4).toString(),'PNG','heatmap export must remain valid PNG');
        assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),await page.evaluate(()=>getComputedStyle(document.querySelector('select')).fontFamily),'controls must share the body font');
        await page.evaluate(async()=>{const original=AppCore.storage.write;try{AppCore.storage.write=async()=>{throw new Error('测试存储不足')};if(await persistBatches())throw new Error('失败写入返回成功')}finally{AppCore.storage.write=original}});
        assert.match(await page.locator('#batchStatus').textContent(),/保存失败/);
        await page.evaluate(()=>{
            const base=AppCore.clone(DataPool.batches[0]), next=AppCore.clone(base); next.id='next'; next.label='下一次';
            next.combinedStudentData.forEach(s=>{s.subjects['总分'].score+=5;s.subjects['物理'].score+=2});
            const model=buildProgressAnalysisData(base,next,'__all__','物理');
            if(model.results.length!==5)throw new Error('同名学生进退步模型丢失');
            renderProgressAnalysis(base,next,'__all__','物理');
        });
        // Exercise the extracted modules with real report generation, not just tab navigation.
        await page.evaluate(async()=>{
            const saved={students:combinedStudentData,batches:DataPool.batches,id:DataPool.currentBatchId,trend:DataPool.trendParsedSheets};
            try {
                const roster=Array.from({length:8},(_,i)=>{const s=AppCore.clone(saved.students[i%saved.students.length]);s.name=s.displayName='模块学生'+i;s.class='01班';Object.values(s.subjects).forEach(sd=>{sd.score=20+i*5;sd.grade=i>4?'A':'B';sd.gradeRank=sd.schoolRank=sd.classRank=''});return s});
                combinedStudentData=roster;applyFallbackGradeRanks(roster,allSubjectHeaders);calculateFallbackRanks(roster,allSubjectHeaders);
                const current=Object.assign(AppCore.clone(saved.batches[0]),{id:'module-current',label:'模块本次',combinedStudentData:roster});
                const previous=AppCore.clone(current);previous.id='module-previous';previous.label='模块对照';previous.combinedStudentData.forEach(s=>Object.values(s.subjects).forEach(sd=>sd.score-=5));
                DataPool.batches=[previous,current];DataPool.currentBatchId=current.id;DataPool.trendParsedSheets=null;
                refreshBatchList();refreshComprehensiveTab();refreshSmartTab();
                if(!renderStudentReadableReport(roster[0].name,.6))throw new Error('个人图文报告未生成');
                if(!renderClassReadableReport('01班',previous.id))throw new Error('班级图文报告未生成');
                if(!renderSubjectTeachingReadableReport(['01班'],'物理',previous.id,'grade'))throw new Error('单科图文报告未生成');
                document.getElementById('progressBaseBatch').value=previous.id;document.getElementById('progressCompareBatch').value=current.id;document.getElementById('progressClassFilter').value='01班';document.getElementById('progressSubjectFilter').value='物理';
                if(!renderProgressReadableReport())throw new Error('进退步图文报告未生成');
                document.getElementById('criticalClassFilter').value='01班';document.getElementById('criticalSubjectFilter').value='物理';document.getElementById('criticalLineMode').value='ratio';document.getElementById('criticalPassLine').value='42';
                if(!renderCriticalReadableReport())throw new Error('临界预警图文报告未生成');
                document.getElementById('corrClassFilter').value='01班';document.getElementById('corrXSubject').value='物理';document.getElementById('corrYSubject').value='总分';
                if(!renderCorrelationReadableReport())throw new Error('学科关联图文报告未生成');
                if(!renderSeatingReadableReport('01班'))throw new Error('座位图文报告未生成');
                const seat=new SeatingModule(document.getElementById('seating-module-root'));seat.init(buildSeatingProfiles('01班'));seat.saveSnapshot();
                if(seat.students.length!==8||!seat.historySnapshots.length)throw new Error('座位交互或快照异常');
                renderClassDiffAll();renderClassDiffGradeDistribution();renderClassDiffRankDistribution();renderClassDiffBoxPlot();
                window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('afterprint'));
                if(!document.getElementById('comprehensiveReadableReportContent').textContent)throw new Error('图文报告内容为空');
            } finally {
                combinedStudentData=saved.students;DataPool.batches=saved.batches;DataPool.currentBatchId=saved.id;DataPool.trendParsedSheets=saved.trend;
                refreshBatchList();refreshComprehensiveTab();refreshSmartTab();
            }
        });
        // Serialized writes capture the input snapshot; later failures do not poison subsequent saves.
        await page.evaluate(async()=>{const a=[{v:1}];const first=AppCore.storage.write('test_queue',a);a[0].v=2;await first;if((await AppCore.storage.read('test_queue'))[0].v!==1)throw new Error('写入快照被后续编辑污染');await Promise.all([AppCore.storage.write('test_queue',[1]),AppCore.storage.write('test_queue',[2])]);if((await AppCore.storage.read('test_queue'))[0]!==2)throw new Error('并发写入顺序异常');});
        // Legacy JSON/b64 migration and old files without rawData must load without throwing.
        await page.evaluate(async()=>{const legacy=AppCore.clone(DataPool.batches[0]);legacy.uploadedPdfs=[{id:'old',fileName:'旧.pdf',status:'ready',fileDataB64:btoa('%PDF-1')}];Object.values(legacy.uploadedFilesData).forEach(f=>{delete f.rawData;delete f.headerMerges});await AppCore.storage.write('scoreBatches',JSON.stringify([legacy]));});
        await page.reload();await page.waitForFunction(()=>!dataOperationBusy && combinedStudentData.length===5);
        await page.selectOption('#mainHeaderRows','1');
        assert.equal(await page.evaluate(()=>combinedStudentData.length),5);
        assert.equal(await page.evaluate(()=>uploadedPdfs.find(p=>p.fileName.endsWith('.pdf')).fileData instanceof Uint8Array),true);
        // Invalid snapshot JSON must resolve to an empty list, never hang.
        await page.evaluate(async()=>{await AppCore.storage.write('seating_snapshots','{bad');if((await restoreSeatingSnapshots()).length!==0)throw new Error('损坏座位快照未安全恢复');});
        // A delayed parse cannot attach to a new batch after a programmatic switch.
        await page.evaluate(async()=>{const original=AppCore.imports.readWorkbook;try{AppCore.imports.readWorkbook=async file=>{await new Promise(r=>setTimeout(r,80));return original(file)};const promise=handleSelectedFiles([new File(['姓名,班级,物理\n旧学生,01班,1'],'旧.csv')],'main');await new Promise(r=>setTimeout(r,20));loadBatch(null);await promise;if(combinedStudentData.length||Object.keys(uploadedFilesData).length)throw new Error('旧导入污染新批次')}finally{AppCore.imports.readWorkbook=original}});
        // Local-file / unavailable-worker fallback still uses the same result format.
        const fallback=await page.evaluate(async()=>{const original=window.Worker;try{window.Worker=class{constructor(){throw new DOMException('blocked','SecurityError')}};const file=new File(['姓名,班级,物理\n测试,01班,1'],'测试.csv');return (await AppCore.imports.readWorkbook(file)).rows.length}finally{window.Worker=original}});
        assert.equal(fallback,2);
        assert.deepEqual(errors,[],'browser uncaught exceptions');
        console.log('PASS browser: worker import, atomic multi-file merge, zero scores, class identity, invalid/repeated imports, save/reload, raw headers, PDF bytes, all 8 tabs, heatmap, progress, 7 report types, seating interaction/snapshot, delayed module loads, storage order and legacy migration');
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
