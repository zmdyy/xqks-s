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
        await page.route(/\/reports\.js(?:\?|$)/,async route=>{await new Promise(r=>setTimeout(r,120));await route.continue()});
        await page.route(/\/class-comparison\.js(?:\?|$)/,async route=>{await new Promise(r=>setTimeout(r,40));await route.continue()});
        await page.route('**/seating.js',async route=>{await new Promise(r=>setTimeout(r,80));await route.continue()});
        await page.goto(url + '/'); await page.waitForFunction(()=>!document.getElementById('mainImportBtn').disabled);
        async function chooseFiles(button, files) {
            const chooser = page.waitForEvent('filechooser');
            await page.click(button); await (await chooser).setFiles(files);
        }
        assert.deepEqual(await page.locator('#dataIntake .upload-section h3').allTextContents(), ['总成绩表','小题得分表（可选）','试卷文档（可选）']);
        const cards = await page.locator('#dataIntake .upload-section').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,top:n.getBoundingClientRect().top})));
        assert.ok(cards.every(c=>c.top===cards[0].top) && cards[0].left<cards[1].left && cards[1].left<cards[2].left, 'desktop upload cards must be side by side');
        await page.evaluate(()=>{window.mergeCalls=0;window.originalMerge=combineAllStudentData;combineAllStudentData=function(...args){window.mergeCalls++;return window.originalMerge(...args)}});
        const main1=workbook('总表一.xlsx',head.concat([[' 同名 ','８０１','０','c',0,'C'],['同名','802',60,'A',100,'A'],['李四','801',55,'B',95,'B']]),merges);
        const main2=workbook('总表二.xlsx',head.concat([['王五','一班',50,'B',90,'B'],['赵六','802',30,'C',60,'C']]),merges);
        await chooseFiles('#mainImportBtn',[main1,main2]);
        await page.waitForFunction(()=>!dataOperationBusy && combinedStudentData.length===5);
        assert.equal(await page.evaluate(()=>mergeCalls),1,'multiple files must merge once');
        assert.equal(await page.evaluate(()=>combinedStudentData.find(s=>s.name==='同名' && s.class==='01班').subjects['物理'].score),0);
        assert.equal(await page.evaluate(()=>combinedStudentData.find(s=>s.name==='同名' && s.class==='01班').subjects['物理'].grade),'C');
        assert.ok(workerLoads>=2,'large spreadsheet parsing must use workers');
        const sub=workbook('小题.xlsx', [['姓名','班级','物理','物理','物理'],['','','第1题（2分）','第2题（3分）','等级'],['同名','01班',0,2,'A'],['同名','02班',2,3,'A'],['李四','01班',1,1,'B'],['王五','01班',1,2,'B'],['赵六','02班',0,0,'C']]);
        await chooseFiles('#subImportBtn',sub);
        await page.waitForFunction(()=>!dataOperationBusy && Object.keys(uploadedFilesData).length===3);
        assert.equal(await page.evaluate(()=>combinedStudentData.length),5,'normalized classes must merge');
        assert.equal(await page.evaluate(()=>combinedStudentData.find(s=>s.name==='同名' && s.class==='01班').subjects['物理'].grade),'C','main grades must keep priority');
        assert.ok(await page.evaluate(()=>Object.keys(combinedStudentData[0].subjects['物理'].subScores).length>=2));
        await chooseFiles('#subImportBtn',sub); await page.waitForFunction(()=>!dataOperationBusy);
        assert.equal(await page.evaluate(()=>Object.keys(uploadedFilesData).length),3,'re-upload must replace');
        const bad={name:'坏表.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('')};
        await chooseFiles('#subImportBtn',bad);await page.waitForFunction(()=>!dataOperationBusy);
        assert.equal(await page.evaluate(()=>combinedStudentData.length),5,'bad import must keep previous data');
        assert.match(await page.locator('#dataImportStatus').textContent(),/文件为空/);
        await chooseFiles('#documentImportBtn',{name:'物理.md',mimeType:'text/markdown',buffer:Buffer.from('# 物理\n1. 示例题目\nA. 选项一\nB. 选项二')});
        await page.waitForFunction(()=>!dataOperationBusy && uploadedPdfs.length===1);
        assert.equal(await page.evaluate(()=>uploadedPdfs[0].source),'md');
        if (process.env.BROWSER_SCREENSHOT_DIR) {
            fs.mkdirSync(process.env.BROWSER_SCREENSHOT_DIR,{recursive:true});
            await page.locator('#dataIntake').screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,'upload-desktop.png')});
        }
        await page.setViewportSize({width:390,height:1000});
        const mobileCards=await page.locator('#dataIntake .upload-section').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,top:n.getBoundingClientRect().top,width:n.getBoundingClientRect().width,scroll:n.scrollWidth,client:n.clientWidth})));
        assert.ok(mobileCards.every(c=>c.left===mobileCards[0].left && c.scroll<=c.client) && mobileCards[0].top<mobileCards[1].top && mobileCards[1].top<mobileCards[2].top,'mobile upload cards must stack without overflow');
        if (process.env.BROWSER_SCREENSHOT_DIR) await page.locator('#dataIntake').screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,'upload-mobile.png')});
        await page.setViewportSize({width:1440,height:1000});
        // Retain binary PDFs without going through an external parser.
        await page.evaluate(()=>uploadedPdfs.push({id:'binary',fileName:'物理.pdf',status:'ready',source:'local',markdown:'1. 测试',questionIndex:[],fileData:new Uint8Array([37,80,68,70,45,49])}));
        await page.fill('#newBatchName','回归批次'); await page.click('#saveBatchBtn');
        await page.waitForFunction(()=>!dataOperationBusy && DataPool.batches.length===1 && DataPool.currentBatchId===DataPool.batches[0].id);
        assert.equal(await page.locator('#batchSelector').inputValue(),await page.evaluate(()=>DataPool.batches[0].id));
        assert.equal(await page.evaluate(()=>combinedStudentData.length),5);
        for(const tab of ['tab-class-diff','tab-collective','tab-upload']) { await page.click('[data-tab="'+tab+'"]'); }
        assert.equal(await page.locator('#batchLabelCollective').textContent(),'回归批次');
        await page.reload();await page.waitForFunction(()=>!dataOperationBusy && combinedStudentData.length===5);
        assert.equal(await page.evaluate(()=>uploadedPdfs.find(p=>p.fileName.endsWith('.pdf')).fileData instanceof Uint8Array),true);
        assert.equal(await page.evaluate(()=>createPdfFileFromEntry(uploadedPdfs.find(p=>p.fileName.endsWith('.pdf'))).size),6);
        assert.equal(await page.evaluate(()=>Object.values(uploadedFilesData).every(f=>Array.isArray(f.rawData)&&Array.isArray(f.headerMerges))),true);
        await page.selectOption('#mainHeaderRows','2'); assert.equal(await page.evaluate(()=>combinedStudentData.length),5);
        // Visit all analysis views, then exercise selected subject and both heatmap modes.
        for (const tab of ['tab-personal','tab-class-diff','tab-collective','tab-trend','tab-smart','tab-comprehensive','tab-seating','tab-upload']) {
            await page.click('[data-tab="'+tab+'"]'); await page.waitForTimeout(160);
        }
        await page.click('[data-tab="tab-personal"]');
        assert.deepEqual(await page.locator('#tab-personal .controls label').allTextContents(), ['学生姓名：','排名范围：','排名类型：']);
        assert.deepEqual(await page.locator('#rankType option').allTextContents(), ['级名','校名','班名']);
        assert.equal(await page.locator('#personalClassFilter').count(), 0);
        await page.click('[data-tab="tab-trend"]');
        const trendGaps = await page.evaluate(() => {
            const saved = DataPool.batches;
            const mode = document.getElementById('trendDisplayMode');
            const avg = document.getElementById('trendShowGradeAvg');
            const style = document.getElementById('trendPointStyleSelect');
            const savedOptions = [mode.value, avg.checked, style.value];
            const labels = ['七下期中','七下期末','八上期中','八上期末','八下期中'];
            const grades = (score, grade = 'A') => ({score,grade});
            const subjectRows = [
                {},
                {'历史':grades(81), '英语笔试':grades(61), '生物':grades(76)},
                {'物理':grades(77), '数学':grades(0,'C')},
                {'历史':grades(90,'A+'), '听说':grades(21), '地理':grades(62)},
                {}
            ];
            const snapshot = id => {
                const el = document.getElementById(id === 'bioGeo' ? 'bioGeoRankChart' : id + 'RankChart');
                if (el.parentElement.style.display === 'none') return null;
                const options = echarts.getInstanceByDom(el).getOption();
                return {labels:options.xAxis[0].data,
                    series:options.series.map(s => ({name:s.name,type:s.type,data:s.data,connectNulls:s.connectNulls,symbol:s.symbol}))};
            };
            try {
                DataPool.batches = labels.map((label, i) => ({
                    id:'trend-'+i, label,
                    combinedStudentData:[
                        {name:'趋势学生',class:'01班',subjects:{总分:grades(300),...subjectRows[i]}},
                        {name:'同组学生',class:'01班',subjects:{总分:grades(410),物理:grades(95),历史:grades(99)}}
                    ]
                }));
                mode.value = 'ranking';
                style.value = 'none';
                refreshTrendTab();
                const rank = {
                    physics:snapshot('physics'), history:snapshot('history'), english:snapshot('english'),
                    bioGeo:snapshot('bioGeo'), chemistry:snapshot('chemistry'),
                    printLabels:[...cloneTrendChartSvg('physicsRankChart').querySelectorAll('text')].map(el => el.textContent)
                };
                mode.value = 'score';
                avg.checked = true;
                updateTrendDisplay();
                const score = {math:snapshot('math'), history:snapshot('history')};
                mode.value = 'grade';
                updateTrendDisplay();
                return {rank,score,grade:snapshot('history')};
            } finally {
                DataPool.batches = saved;
                [mode.value, avg.checked, style.value] = savedOptions;
                refreshTrendTab();
            }
        });
        assert.deepEqual(trendGaps.rank.physics.labels, ['八上期中']);
        assert.deepEqual(trendGaps.rank.physics.series, [{name:'物理',type:'line',data:[2],connectNulls:false,symbol:'circle'}]);
        assert.equal(trendGaps.rank.chemistry, null);
        const gapLabels = ['七下期末','八上期中','八上期末'];
        assert.deepEqual(trendGaps.rank.history.labels, gapLabels);
        assert.deepEqual(trendGaps.rank.history.series[0].data, [2,null,2]);
        assert.equal(trendGaps.rank.history.series[0].connectNulls, false);
        assert.deepEqual(trendGaps.rank.english.labels, gapLabels);
        assert.deepEqual(trendGaps.rank.english.series.map(s=>s.data), [[1,null,null],[null,null,1]]);
        assert.deepEqual(trendGaps.rank.bioGeo.labels, gapLabels);
        assert.deepEqual(trendGaps.rank.bioGeo.series.map(s=>s.data), [[1,null,null],[null,null,1]]);
        assert.ok(trendGaps.rank.printLabels.join('').includes('八上期中'));
        assert.ok(!trendGaps.rank.printLabels.join('').includes('七下'));
        assert.deepEqual(trendGaps.score.math.labels, ['八上期中']);
        assert.deepEqual(trendGaps.score.math.series[0].data, [0]);
        assert.deepEqual(trendGaps.score.history.series.map(s=>s.data), [[81,null,90],[90,null,95]]);
        assert.deepEqual(trendGaps.grade.series[0].data, [5,null,6]);
        await page.click('[data-tab="tab-smart"]');
        await page.fill('#smartNameSearch','赵六');
        await page.locator('#smartNameSuggest .student-suggest-item[data-display-name="赵六"]').click();
        await page.click('#smartIndividualBtn');
        const weakColors = await page.locator('#studentReportWeakCompareChart').evaluate(el => {
            const option = echarts.getInstanceByDom(el).getOption();
            const zero = option.series[0].data.find(entry => entry.value === 0);
            const zeroLabel = [...el.querySelectorAll('svg text')].find(node =>
                node.textContent === '0%' && node.getAttribute('fill') === '#a23e1b');
            return {
                personal:option.series[0].color,
                group:option.series[1].color,
                zeros:zero?.label.backgroundColor,
                rendered:!!zeroLabel,
                values:option.series[1].data
            };
        });
        assert.deepEqual(weakColors,{personal:'#a23e1b',group:'#176681',zeros:'#fff0e8',rendered:true,values:[50,50]});
        const classReport = await page.evaluate(() => {
            const saved = { batches:DataPool.batches, id:DataPool.currentBatchId };
            const roster = Array.from({ length:12 }, (_, i) => ({
                name:'榜单学生' + String(i).padStart(2, '0'),
                class:'01班',
                subjects:{
                    总分:{ score:500 - (i === 10 ? 9 : i), gradeRank:[3,10,10][i] ?? 20 + i },
                    物理:{ score:100 - i, gradeRank:[4,1,9,2][i] ?? 20 + i },
                    数学:{ score:100 - i },
                    历史:{ score:95 - i, gradeRank:i === 0 ? 1 : 30 + 3 * i }
                }
            }));
            const otherClass = { name:'榜单学生01', class:'02班', subjects:{ 总分:{ score:600, gradeRank:1 }, 物理:{ score:100, gradeRank:1 }, 数学:{ score:110 } } };
            const current = {
                id:'leaderboard-current', label:'榜单本次', allSubjectHeaders:[{ name:'总分' }, { name:'物理' }, { name:'数学' }, { name:'历史' }],
                combinedStudentData:[...roster, otherClass]
            };
            const prior = AppCore.clone(current);
            prior.id = 'leaderboard-prior';
            prior.label = '榜单对照';
            prior.combinedStudentData.forEach((student, i) => {
                student.class = i === 12 ? '802' : '801';
                student.subjects.总分.gradeRank = i === 3 ? 900 : 100 + i;
                student.subjects.物理.gradeRank = i === 3 ? 102 : 50 + i;
                if (student.subjects.历史) student.subjects.历史.gradeRank = i + 1;
            });
            prior.combinedStudentData[3].subjects.数学.score = 30;
            const importedCurrent = AppCore.clone(current.combinedStudentData);
            delete importedCurrent[1].subjects.物理.gradeRank;
            importedCurrent[1].subjects.物理.schoolRank = 1;
            current.uploadedFilesData = { main:{ fileType:'main', studentData:importedCurrent } };
            prior.uploadedFilesData = { main:{ fileType:'main', studentData:AppCore.clone(prior.combinedStudentData) } };
            const progressTable = (kind = 'improved') => document.querySelector('[data-class-leaderboard="' + kind + '"] table');
            const readProgress = kind => {
                const table = progressTable(kind);
                const rows = Array.from(table.tBodies[0].rows);
                return Object.fromEntries(Array.from(table.tHead.rows[0].cells, (header, index) => [
                    header.textContent,
                    rows.map(row => row.cells[index]).filter(cell => cell.querySelector('.sr-class-progress-entry'))
                        .map(cell => ['name','delta','change'].map(part => cell.querySelector('.sr-class-progress-' + part).textContent))
                ]));
            };
            const readClassTable = () => {
                const table = document.getElementById('classReportTopTenTable');
                return Object.fromEntries([...table.tHead.rows[0].cells].map((header, index) => [header.textContent,
                    [...table.tBodies[0].rows].map(row => row.cells[index]).filter(cell => cell.querySelector('.class-top-ten-name'))
                        .map(cell => {
                            const name = cell.querySelector('.class-top-ten-name');
                            return {
                                name:name.textContent,
                                gradeRank:name.title,
                                gold:name.classList.contains('class-top-ten-grade-top') && getComputedStyle(name).backgroundColor === 'rgb(255, 228, 160)',
                                tie:cell.querySelector('.class-top-ten-tie')?.textContent || ''
                            };
                        })]));
            };
            try {
                DataPool.batches = [prior, current, ...saved.batches];
                refreshSmartTab();
                document.getElementById('smartClassFilter').value = '01班';
                const currentSelect = document.getElementById('smartClassCurrentBatch');
                currentSelect.value = current.id;
                currentSelect.dispatchEvent(new Event('change'));
                const compareSelect = document.getElementById('smartClassCompareBatch');
                compareSelect.value = prior.id;
                document.getElementById('smartClassBtn').click();
                const result = {
                    class:readClassTable(), improved:readProgress(), declined:readProgress('declined'),
                    gradeTable:!!document.querySelector('[data-class-leaderboard="grade"]')
                };
                const table = progressTable();
                const firstCell = table.tBodies[0].rows[0].cells[0];
                const name = firstCell.querySelector('.sr-class-progress-name');
                const gain = firstCell.querySelector('.sr-class-progress-delta');
                const change = firstCell.querySelector('.sr-class-progress-change');
                result.layout = {
                    twoLines:gain.getBoundingClientRect().bottom <= change.getBoundingClientRect().top,
                    nameOnLeft:name.getBoundingClientRect().right <= change.getBoundingClientRect().left,
                    fontSizes:[name,gain,change].map(node => getComputedStyle(node).fontSize),
                    heights:[...table.tBodies[0].rows].map(row => row.getBoundingClientRect().height)
                };
                const declineTable = progressTable('declined');
                const decline = declineTable.querySelector('.sr-class-progress-delta');
                result.declineColor = getComputedStyle(decline).color;
                result.noDecline = [...declineTable.tBodies[0].rows].map(row => row.cells[0].textContent.trim()).filter(Boolean);
                current.combinedStudentData = roster;
                document.getElementById('smartClassBtn').click();
                result.singleClassGold = readClassTable().数学.some(entry => entry.gold);
                const mathColumn = [...progressTable().tHead.rows[0].cells].findIndex(header => header.textContent === '数学');
                result.singleClassMessages = [...progressTable().tBodies[0].rows]
                    .map(row => row.cells[mathColumn].textContent.trim()).filter(Boolean);
                result.declineMissing = [...progressTable('declined').tBodies[0].rows]
                    .map(row => row.cells[mathColumn].textContent.trim()).filter(Boolean);
                compareSelect.value = '';
                document.getElementById('smartClassBtn').click();
                result.noCompare = document.getElementById('comprehensiveReadableReportContent').textContent.includes('选择对照批次后显示进步榜和退步榜');
                result.noDeclineWithoutCompare = !progressTable('declined');
                return result;
            } finally {
                DataPool.batches = saved.batches;
                DataPool.currentBatchId = saved.id;
                refreshSmartTab();
            }
        });
        assert.deepEqual(Object.keys(classReport.class),['总分','物理','数学','历史']);
        assert.equal(classReport.class.总分.length,11);
        assert.deepEqual(classReport.class.总分.slice(-2).map(entry => [entry.name,entry.tie]),
            [['榜单学生09','并列第 10'],['榜单学生10','并列第 10']]);
        assert.equal(classReport.class.物理.length,10);
        assert.equal(classReport.gradeTable,false);
        assert.deepEqual(classReport.class.总分.filter(entry => entry.gold).map(entry => [entry.name,entry.gradeRank]),
            [['榜单学生00','年级第 3 名'],['榜单学生01','年级第 10 名'],['榜单学生02','年级第 10 名']]);
        assert.deepEqual(classReport.class.物理.filter(entry => entry.gold).map(entry => entry.name),
            ['榜单学生00','榜单学生02','榜单学生03']);
        assert.equal(classReport.class.数学.filter(entry => entry.gold).length,9);
        assert.equal(classReport.class.数学[0].gradeRank,'年级第 2 名');
        assert.deepEqual(Object.keys(classReport.improved),['总分','物理','数学','历史']);
        assert.equal(classReport.improved.总分.length,10);
        assert.deepEqual(classReport.improved.总分[0],['榜单学生03','↑877','900 → 23']);
        assert.deepEqual(classReport.improved.物理[0],['榜单学生03','↑100','102 → 2']);
        assert.ok(classReport.improved.物理.every(([name]) => name !== '榜单学生01'));
        assert.deepEqual(classReport.improved.数学,[['榜单学生03','↑8','13 → 5']]);
        assert.ok(classReport.layout.twoLines && classReport.layout.nameOnLeft);
        assert.deepEqual(classReport.layout.fontSizes,['16px','14px','11px']);
        assert.equal(classReport.layout.heights.length,10);
        assert.ok(classReport.layout.heights.every(height => height === 48));
        assert.equal(classReport.singleClassGold,false);
        assert.deepEqual(classReport.singleClassMessages,['本次缺少年级排名数据']);
        assert.deepEqual(Object.keys(classReport.declined),['总分','物理','数学','历史']);
        assert.equal(classReport.declined.历史.length,10);
        assert.deepEqual(classReport.declined.历史[0],['榜单学生11','↓51','12 → 63']);
        assert.deepEqual(classReport.declined.历史.at(-1),['榜单学生02','↓33','3 → 36']);
        assert.deepEqual(classReport.declined.数学[0],['榜单学生04','↓1','5 → 6']);
        assert.deepEqual(classReport.noDecline,['本班无人退步']);
        assert.equal(classReport.declineColor,'rgb(153, 27, 27)');
        assert.deepEqual(classReport.declineMissing,['本次缺少年级排名数据']);
        assert.ok(classReport.noCompare && classReport.noDeclineWithoutCompare);
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
        async function downloadHeatmapSvg() {
            const pending = page.waitForEvent('download');
            await page.click('#collectiveHeatmapExportSvgBtn');
            return fs.readFileSync(await (await pending).path(), 'utf8');
        }
        const allClassesSvg = await downloadHeatmapSvg();
        const rosterIndex = allClassesSvg.indexOf('异常学生名单');
        assert.ok(rosterIndex > allClassesSvg.indexOf('</svg>'), 'the roster follows the original chart');
        const allClassRoster = allClassesSvg.slice(rosterIndex);
        assert.match(allClassRoster, />01班<.*同名（01班）.*>02班<.*赵六/);
        assert.doesNotMatch(allClassRoster, /识别依据|低于阈值|个性异常/);
        assert.ok(!await page.locator('#collectiveHeatmapChart').textContent().then(text=>text.includes('异常学生名单')));
        await page.selectOption('#collectiveClassFilter','02班');
        const selectedSvg = await downloadHeatmapSvg();
        const selectedRoster = selectedSvg.slice(selectedSvg.indexOf('异常学生名单'));
        assert.match(selectedRoster, />02班<.*赵六/);
        assert.doesNotMatch(selectedRoster, /01班|李四/);
        await page.selectOption('#collectiveClassFilter','');
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
        await page.evaluate(async()=>{const original=AppCore.imports.readWorkbook;try{AppCore.imports.readWorkbook=async file=>{await new Promise(r=>setTimeout(r,80));return original(file)};const promise=handleSelectedFiles([new File(['姓名,班级,物理\n旧学生,01班,1'],'旧.csv')],'main');await new Promise(r=>setTimeout(r,20));if(Array.from(document.querySelectorAll('#dataIntake button')).some(b=>!b.disabled))throw new Error('导入期间仍可点击其他入口');loadBatch(null);await promise;if(combinedStudentData.length||Object.keys(uploadedFilesData).length)throw new Error('旧导入污染新批次')}finally{AppCore.imports.readWorkbook=original}});
        // Local-file / unavailable-worker fallback still uses the same result format.
        const fallback=await page.evaluate(async()=>{const original=window.Worker;try{window.Worker=class{constructor(){throw new DOMException('blocked','SecurityError')}};const file=new File(['姓名,班级,物理\n测试,01班,1'],'测试.csv');return (await AppCore.imports.readWorkbook(file)).rows.length}finally{window.Worker=original}});
        assert.equal(fallback,2);
        // Top ten ranks each subject within the selected class, keeping cutoff ties.
        await page.evaluate(() => {
            const scores = [105,104,103,102,99,99,98,97,96,95,95,94];
            const students = scores.map((score, index) => ({
                name: index === 4 || index === 5 ? '同名学生' : '学生' + index,
                class: index % 2 ? '802' : '801',
                subjects: {
                    '英语总分': {score: 83 - index}, '英语笔试': {score: 60 - index}, '听说': {score: 23},
                    '总分': {score: 612 - index}, '数学': {score, classRank: 50, gradeRank: 50},
                    '物理': {score: index === 0 ? 0 : '缺考'}
                }
            }));
            const headers = Object.keys(students[0].subjects).map(name => ({name}));
            const first = {id:'top-ten', label:'前十测试', combinedStudentData:students, allSubjectHeaders:headers};
            const next = {id:'top-ten-next', label:'新班级测试',
                combinedStudentData:[{name:'其他班学生', class:'803', subjects:{'数学':{score:98}}}],
                allSubjectHeaders:[{name:'数学'}]};
            DataPool.batches.push(first, next);
            loadBatch(first.id);
            refreshBatchList();
        });
        await page.click('[data-tab="tab-class-diff"]');
        await page.click('[data-analysis-target="classDiffTopTenSection"]');
        const top = page.locator('#classDiffTopTenTable');
        const classChoice = page.locator('#classDiffTopTenClass');
        const details = page.getByRole('button', {name:'显示详情'});
        const exportTopTen = page.getByRole('button', {name:'导出图片', exact:true});
        async function downloadTopTen() {
            const pending = page.waitForEvent('download');
            await exportTopTen.click();
            const download = await pending;
            return {name:download.suggestedFilename(), bytes:fs.readFileSync(await download.path())};
        }
        const getRanks = (column) => top.locator(`tbody td:nth-child(${column}) .class-top-ten-rank:visible`).allTextContents();
        const mathNames = top.locator('tbody td:nth-child(3) .class-top-ten-name');
        assert.deepEqual(await top.locator('th').allTextContents(), ['总分','英语','数学','物理']);
        assert.equal(await page.locator('#classDiffTopTenSummary').textContent(), '12 人');
        assert.equal(await details.getAttribute('aria-pressed'), 'false');
        assert.equal(await top.locator('.class-top-ten-detail:visible').count(), 0);
        assert.equal(await mathNames.count(), 11);
        assert.deepEqual(await top.locator('tbody td:nth-child(3) .class-top-ten-tie:visible').allTextContents(),
            ['并列第 5','并列第 5','并列第 10','并列第 10']);
        const namesBeforeDetails = await mathNames.allTextContents();
        assert.equal(await top.locator('th').first().evaluate(header => {
            const style = getComputedStyle(header);
            return [style.color, style.fontWeight, style.fontSize];
        }).then(style => style.join(' ')), 'rgb(255, 255, 255) 700 14px');
        await page.evaluate(() => {
            const original = downloadHeatmapReportImage;
            downloadHeatmapReportImage = (svg, name, scale) => {
                window.lastTopTenImageSvg = svg;
                original(svg, name, scale);
            };
            document.querySelector('#classDiffTopTenTable').parentElement.style.maxHeight = '180px';
        });
        const snapshotTopTen = () => page.evaluate(() => {
            const svg = new DOMParser().parseFromString(window.lastTopTenImageSvg, 'image/svg+xml');
            return {
                width:Number(svg.documentElement.getAttribute('width')),
                height:Number(svg.documentElement.getAttribute('height')),
                viewBox:svg.documentElement.getAttribute('viewBox').split(' ').map(Number),
                texts:[...svg.querySelectorAll('text')].map(node => [node.textContent, Number(node.getAttribute('y'))])
            };
        });
        const compactImage = await downloadTopTen();
        assert.equal(compactImage.name, '各科前十_前十测试_全部班级_名单.png');
        assert.equal(compactImage.bytes.subarray(1,4).toString(), 'PNG');
        const compactSvg = await snapshotTopTen();
        assert.equal(compactSvg.width, compactSvg.viewBox[2] * 4);
        assert.equal(compactSvg.height, compactSvg.viewBox[3] * 4);
        assert.equal(compactImage.bytes.readUInt32BE(16), compactSvg.width);
        assert.equal(compactImage.bytes.readUInt32BE(20), compactSvg.height);
        assert.ok(compactSvg.texts.some(([text, y]) => text === '学生10' && y > 180), 'full cutoff tie must be in the image');
        assert.ok(compactSvg.texts.some(([text]) => text === '并列第 10'));
        assert.ok(!compactSvg.texts.some(([text]) => ['612','01班','02班'].includes(text)));
        await details.click();
        assert.equal(await details.getAttribute('aria-pressed'), 'true');
        assert.deepEqual(await mathNames.allTextContents(), namesBeforeDetails);
        assert.equal(await top.locator('.class-top-ten-tie:visible').count(), 0);
        assert.equal(await top.locator('tbody td:first-child .class-top-ten-score').first().textContent(), '612');
        assert.deepEqual(await getRanks(3), ['1','2','3','4','5','5','7','8','9','10','10']);
        assert.equal(await top.locator('tbody td:nth-child(4) .class-top-ten-score').textContent(), '0');
        assert.deepEqual(await top.locator('tbody td:nth-child(3) .class-top-ten-class').allTextContents(),
            ['01班','02班','01班','02班','01班','02班','01班','02班','01班','02班','01班']);
        const heights = await top.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
        assert.equal(new Set(heights).size, 1, 'ties must use standard-height rows');
        await classChoice.selectOption({label:'02班'});
        assert.equal(await top.locator('.class-top-ten-class:visible').count(), 0);
        assert.equal(await page.locator('#classDiffTopTenSummary').textContent(), '6 人');
        await details.click();
        assert.equal(await top.locator('.class-top-ten-detail:visible').count(), 0);
        assert.equal(await classChoice.inputValue(), '2');
        assert.equal(await mathNames.count(), 6);
        await details.click();
        assert.deepEqual(await getRanks(3), ['1','2','3','4','5','6']);
        assert.deepEqual(await top.locator('tbody td:nth-child(3) .class-top-ten-score').allTextContents(), ['104','102','99','97','95','94']);
        assert.deepEqual(await top.locator('tbody td:first-child .class-top-ten-score').allTextContents(), ['611','609','607','605','603','601']);
        assert.deepEqual(await getRanks(4), [], 'absent class scores must not be ranked');
        const detailedImage = await downloadTopTen();
        assert.equal(detailedImage.name, '各科前十_前十测试_02班_详情.png');
        assert.equal(detailedImage.bytes.subarray(1,4).toString(), 'PNG');
        const detailedSvg = await snapshotTopTen();
        assert.equal(detailedImage.bytes.readUInt32BE(16), detailedSvg.viewBox[2] * 4);
        assert.equal(detailedImage.bytes.readUInt32BE(20), detailedSvg.viewBox[3] * 4);
        assert.ok(detailedSvg.texts.some(([text]) => text === '611'));
        assert.ok(!detailedSvg.texts.some(([text]) => ['612','学生0','并列第 10'].includes(text)));
        await top.evaluate(table => {
            const body = table.tBodies[0];
            const template = body.rows[0];
            const longList = document.createDocumentFragment();
            for (let row = 0; row < 221; row++) longList.append(template.cloneNode(true));
            longList.lastElementChild.querySelector('.class-top-ten-name').textContent = '末行验证';
            body.append(longList);
        });
        const longImage = await downloadTopTen();
        assert.match(longImage.name, /\.svg$/);
        assert.match(longImage.bytes.toString(), /末行验证/);
        await classChoice.selectOption({label:'全部班级'});
        assert.equal((await getRanks(3)).length, 11);
        await page.locator('#classDiffBatchPicker input[value="top-ten-next"]').check();
        assert.equal((await getRanks(3)).length, 11, 'comparison batches must not feed the top-ten table');
        await classChoice.selectOption({label:'02班'});
        await page.click('[data-tab="tab-upload"]');
        await page.selectOption('#batchSelector', 'top-ten-next');
        await page.click('[data-tab="tab-class-diff"]');
        assert.deepEqual(await classChoice.locator('option').allTextContents(), ['全部班级','03班']);
        assert.equal(await classChoice.inputValue(), '');
        assert.deepEqual(await top.locator('th').allTextContents(), ['总分','数学']);
        assert.deepEqual(await getRanks(1), [], 'missing total must not be inferred from subjects');
        assert.deepEqual(await getRanks(2), ['1']);
        assert.deepEqual(errors,[],'browser uncaught exceptions');
        console.log('PASS browser: three upload buttons, responsive upload cards, worker import, atomic multi-file merge, zero scores, class identity, invalid/repeated imports, save/reload, raw headers, PDF bytes, all 8 tabs, original personal toolbar, class top ten compact/detail and 4x PNG export, heatmap, progress, 7 report types, seating interaction/snapshot, delayed module loads, storage order and legacy migration');
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
