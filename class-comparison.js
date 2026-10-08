/* 班级多维对比：均分、热力图、等级、名次分布和箱线图。
 * Classic script: reads the shared data pool only when an analysis is invoked.
 */
var classDiffEchartsInst = {};
var heatmapReportExportContext = null;
var gradeDistributionExportContext = null;

function normalizeClassName(cls) { return AppCore.classLabel(cls, '未知班级'); }

function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function createPatternFill(patternChar, color) {
    var canvas = document.createElement('canvas');
    canvas.width = 14;
    canvas.height = 14;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = hexToRgba(color, 0.12);
    ctx.fillRect(0, 0, 14, 14);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    switch (patternChar) {
        case '/': ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(0, 14); ctx.stroke(); break;
        case '\\': ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 14); ctx.stroke(); break;
        case '|': ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(7, 14); ctx.stroke(); break;
        case '-': ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(14, 7); ctx.stroke(); break;
        case '+': ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(7, 14); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(14, 7); ctx.stroke(); break;
        case 'x': ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(0, 14); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 14); ctx.stroke(); break;
        case 'o': ctx.beginPath(); ctx.arc(7, 7, 3, 0, Math.PI * 2); ctx.stroke(); break;
        case 'O': ctx.beginPath(); ctx.arc(7, 7, 5.5, 0, Math.PI * 2); ctx.stroke(); break;
        case '.': ctx.beginPath(); ctx.arc(7, 7, 1.5, 0, Math.PI * 2); ctx.fill(); break;
        case '*':
            ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(12, 12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(12, 2); ctx.lineTo(2, 12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(7, 14); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(14, 7); ctx.stroke();
            break;
    }
    return { image: canvas, repeat: 'repeat', patternUnits: 'userSpaceOnUse' };
}

function getClassDiffSelectedBatches() {
    var cbs = document.querySelectorAll('#classDiffBatchPicker input[type=checkbox]');
    var selected = [];
    cbs.forEach(function(cb) {
        if (cb.checked) {
            var bid = cb.value;
            var batch = DataPool.batches.find(function(b) { return b.id === bid; });
            if (batch) selected.push({ id: batch.id, label: batch.label, data: batch.combinedStudentData, headers: batch.allSubjectHeaders });
        }
    });
    return selected;
}

function renderClassDiffAll() {
    if (!combinedStudentData.length || !getMergedSubjectNames(combinedStudentData, allSubjectHeaders).length) {
        document.getElementById('classDiffMeanSection').style.display = 'none';
        document.getElementById('classDiffGradeSection').style.display = 'none';
        document.getElementById('classDiffRankSection').style.display = 'none';
        document.getElementById('classDiffBoxSection').style.display = 'none';
        document.getElementById('classDiffBatchPicker').style.display = 'none';
        document.getElementById('classDiffPlaceholder').style.display = 'block';
        return;
    }
    document.getElementById('classDiffPlaceholder').style.display = 'none';
    document.getElementById('classDiffMeanSection').style.display = 'block';
    document.getElementById('classDiffGradeSection').style.display = 'block';
    document.getElementById('classDiffRankSection').style.display = 'block';
    document.getElementById('classDiffBoxSection').style.display = 'block';
    // Build batch picker checkboxes
    var picker = document.getElementById('classDiffBatchPicker');
    // Save previous checkbox states
    var prevChecked = {};
    picker.querySelectorAll('input[type=checkbox]').forEach(function(cb) { prevChecked[cb.value] = cb.checked; });
    picker.innerHTML = '<span style="font-weight:bold;margin-right:4px;">对比批次：</span>';
    if (DataPool.batches.length > 1) {
        picker.style.display = 'flex';
        var colors = ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4'];
        DataPool.batches.forEach(function(b, i) {
            var label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;gap:3px;cursor:pointer;padding:1px 4px;border-radius:3px;background:#f8f9fa;border:1px solid #e0e0e0;';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = b.id;
            cb.checked = prevChecked.hasOwnProperty(b.id) ? prevChecked[b.id] : (b.id === DataPool.currentBatchId);
            cb.dataset.color = colors[i % colors.length];
            cb.addEventListener('change', function() {
                renderClassDiffAll();
            });
            var dot = document.createElement('span');
            dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + colors[i % colors.length] + ';';
            label.appendChild(cb);
            label.appendChild(dot);
            label.appendChild(document.createTextNode(b.label));
            picker.appendChild(label);
        });
    } else {
        picker.style.display = 'none';
    }
    renderClassDiffMeanTable();
    renderClassDiffGradeDistribution();
    // Populate rank sorting subject dropdown
    var rankSubjectSel = document.getElementById('classDiffRankSubject');
    var prevVal = rankSubjectSel.value;
    var scoredSubjects = getScoredSubjectNames(combinedStudentData, allSubjectHeaders);
    rankSubjectSel.innerHTML = '';
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    scoredSubjects.forEach(function(subjectName) {
        var opt = document.createElement('option');
        opt.value = subjectName;
        opt.textContent = subjectName;
        rankSubjectSel.appendChild(opt);
    });
    if (prevVal && Array.from(rankSubjectSel.options).some(function(o) { return o.value === prevVal; })) {
        rankSubjectSel.value = prevVal;
    } else if (totalName && Array.from(rankSubjectSel.options).some(function(o) { return o.value === totalName; })) {
        rankSubjectSel.value = totalName;
    }
    renderClassDiffRankDistribution();
    // Box plot subject dropdown
    var boxSubjSel = document.getElementById('classDiffBoxSubject');
    var prevBoxVal = boxSubjSel.value;
    boxSubjSel.innerHTML = '';
    scoredSubjects.forEach(function(subjectName) {
        var opt = document.createElement('option');
        opt.value = subjectName;
        opt.textContent = subjectName;
        boxSubjSel.appendChild(opt);
    });
    if (prevBoxVal && Array.from(boxSubjSel.options).some(function(o) { return o.value === prevBoxVal; })) {
        boxSubjSel.value = prevBoxVal;
    } else if (boxSubjSel.options.length) {
        boxSubjSel.value = boxSubjSel.options[0].value;
    }
    renderClassDiffBoxPlot();
}

function renderClassDiffMeanTable() {
    // 分析层直接依据合并后的学生分数数据确定科目，不依赖原 Excel 的 scoreIndex。
    var scoredSubjects = getScoredSubjectNames(combinedStudentData, allSubjectHeaders);
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    // Build display list: subjects + total at end
    var displaySubjects = scoredSubjects.filter(function(name) { return name !== totalName; });
    if (totalName && scoredSubjects.indexOf(totalName) >= 0) displaySubjects.push(totalName);
    if (!displaySubjects.length) {
        document.getElementById('classDiffMeanSection').style.display = 'none';
        return;
    }
    // Group by class
    var classMap = {};
    combinedStudentData.forEach(function(stu) {
        var cls = stu.class || '未知班级';
        if (!classMap[cls]) classMap[cls] = [];
        classMap[cls].push(stu);
    });
    var classNames = Object.keys(classMap).sort(function(a,b) {
        var na = parseInt(a.match(/\d+/)?.[0] || '0');
        var nb = parseInt(b.match(/\d+/)?.[0] || '0');
        return na - nb || a.localeCompare(b);
    });
    // Compute averages
    var stats = [];
    classNames.forEach(function(cls) {
        var arr = classMap[cls];
        var row = { 班级: cls };
        displaySubjects.forEach(function(sn) {
            var vals = arr.map(function(s) { var sd = getSubjectDataByAlias(s, sn); return sd ? parseFloat(sd.score) : NaN; }).filter(function(v) { return !isNaN(v); });
            row[sn] = vals.length ? vals.reduce(function(a,b){return a+b;},0) / vals.length : '';
        });
        stats.push(row);
    });
    // Max/Min per column among class averages
    var maxMap = {}, minMap = {};
    displaySubjects.forEach(function(sn) {
        var vals = stats.map(function(r) { return r[sn]; }).filter(function(v) { return v !== '' && !isNaN(v); });
        if (vals.length) { maxMap[sn] = Math.max.apply(null, vals); minMap[sn] = Math.min.apply(null, vals); }
    });
    // Global max/min (across all students)
    var globalMax = {}, globalMin = {};
    displaySubjects.forEach(function(sn) {
        var vals = combinedStudentData.map(function(s) { var sd = getSubjectDataByAlias(s, sn); return sd ? parseFloat(sd.score) : NaN; }).filter(function(v) { return !isNaN(v); });
        globalMax[sn] = vals.length ? Math.max.apply(null, vals) : '';
        globalMin[sn] = vals.length ? Math.min.apply(null, vals) : '';
    });
    // Render table
    var table = document.getElementById('classDiffMeanTable');
    var html = '<thead><tr><th>班级</th>';
    displaySubjects.forEach(function(sn) { html += '<th>' + escapeHtml(sn) + '</th>'; });
    html += '</tr></thead><tbody>';
    stats.forEach(function(row) {
        html += '<tr><td style="font-weight:bold;">' + escapeHtml(row.班级) + '</td>';
        displaySubjects.forEach(function(sn) {
            var v = row[sn];
            var cls = '';
            if (v !== '') {
                if (v === maxMap[sn] && v === minMap[sn]) cls = 'class="mean-max mean-min"';
                else if (v === maxMap[sn]) cls = 'class="mean-max"';
                else if (v === minMap[sn]) cls = 'class="mean-min"';
            }
            html += '<td ' + cls + '>' + (v !== '' ? Number(v).toFixed(2) : '') + '</td>';
        });
        html += '</tr>';
    });
    html += '<tr><td style="font-weight:bold;background:#ffe066;">最高分</td>';
    displaySubjects.forEach(function(sn) {
        var v = globalMax[sn];
        html += '<td class="mean-max">' + (v !== '' ? v.toFixed(2) : '') + '</td>';
    });
    html += '</tr>';
    html += '<tr><td style="font-weight:bold;background:#a5d8ff;">最低分</td>';
    displaySubjects.forEach(function(sn) {
        var v = globalMin[sn];
        html += '<td class="mean-min">' + (v !== '' ? v.toFixed(2) : '') + '</td>';
    });
    html += '</tr>';
    html += '</tbody>';
    table.innerHTML = html;
    // Populate comparison subject dropdown
    var compSubjectSel = document.getElementById('classDiffMeanCompSubject');
    compSubjectSel.innerHTML = '';
    displaySubjects.forEach(function(sn) {
        var opt = document.createElement('option');
        opt.value = sn;
        opt.textContent = sn;
        compSubjectSel.appendChild(opt);
    });
    if (totalName) compSubjectSel.value = totalName;
    renderClassDiffMeanLineChart(displaySubjects);
    renderClassDiffHeatmap(stats, classNames, displaySubjects);
}

function renderClassDiffMeanLineChart(displaySubjects) {
    var selectedBatches = getClassDiffSelectedBatches();
    var comparisonDiv = document.getElementById('classDiffMeanComparison');
    if (selectedBatches.length < 2) {
        comparisonDiv.style.display = 'none';
        return;
    }
    comparisonDiv.style.display = 'block';
    var subject = document.getElementById('classDiffMeanCompSubject').value;
    if (!subject) return;
    // Compute per-class mean for each batch (normalize class names for cross-batch matching)
    var batchClassMap = {};
    selectedBatches.forEach(function(batch) {
        var classMap = {};
        batch.data.forEach(function(stu) {
            var cls = normalizeClassName(stu.class || '未知班级');
            if (!classMap[cls]) classMap[cls] = [];
            classMap[cls].push(stu);
        });
        var classNames = Object.keys(classMap).sort(function(a,b) {
            var na = parseInt(a.match(/\d+/)?.[0] || '0');
            var nb = parseInt(b.match(/\d+/)?.[0] || '0');
            return na - nb || a.localeCompare(b);
        });
        batchClassMap[batch.label] = { classNames: classNames, classMap: classMap };
    });
    // Collect all classes across all batches (normalized)
    var allClasses = new Set();
    Object.keys(batchClassMap).forEach(function(label) {
        batchClassMap[label].classNames.forEach(function(cls) { allClasses.add(cls); });
    });
    var classList = Array.from(allClasses).sort(function(a,b) {
        var na = parseInt(a.match(/\d+/)?.[0] || '0');
        var nb = parseInt(b.match(/\d+/)?.[0] || '0');
        return na - nb || a.localeCompare(b);
    });
    var batchLabels = selectedBatches.map(function(b) { return b.label; });
    var lineTypes = ['solid', 'dashed', 'dotted'];
    var symbols = ['circle', 'triangle', 'rect', 'diamond'];
    var series = classList.map(function(cls, idx) {
        var data = selectedBatches.map(function(batch) {
            var info = batchClassMap[batch.label];
            if (!info) return '-';
            var arr = info.classMap[cls];
            if (!arr || !arr.length) return '-';
            var vals = arr.map(function(s) { var sd = getSubjectDataByAlias(s, subject); return sd ? parseFloat(sd.score) : NaN; }).filter(function(v) { return !isNaN(v); });
            return vals.length ? Math.round((vals.reduce(function(a,b){return a+b;},0) / vals.length) * 100) / 100 : '-';
        });
        return {
            name: cls,
            type: 'line',
            data: data,
            smooth: true,
            lineStyle: { type: lineTypes[idx % lineTypes.length] },
            symbol: symbols[Math.floor(idx / lineTypes.length) % symbols.length],
            symbolSize: 8
        };
    });
    var chartDiv = document.getElementById('classDiffMeanLineChart');
    var existing = chartDiv.__chart;
    if (existing) try { existing.dispose(); } catch(e) {}
    var chart = AppCore.charts.init(chartDiv, null, {renderer:'svg'});
    chartDiv.__chart = chart;
    chart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: classList, top: 0, textStyle: { fontSize: 14 } },
        xAxis: { type: 'category', data: batchLabels, axisLabel: { fontSize: 15 } },
        yAxis: { type: 'value', name: '均分', scale: true, axisLabel: { fontSize: 15 } },
        series: series,
        grid: { left: 60, right: 20, top: 40, bottom: 40 }
    });
    chart.resize();
}

function renderClassDiffHeatmap(stats, classNames, displaySubjects) {
    var section = document.getElementById('classDiffHeatmapSection');
    if (!displaySubjects.length || !combinedStudentData.length) { section.style.display = 'none'; return; }
    // Populate class dropdown
    var classSel = document.getElementById('heatmapClassSelect');
    var prevClassVal = classSel.value;
    classSel.innerHTML = '<option value="__all__">全部班级</option>';
    var allClasses = {};
    combinedStudentData.forEach(function(stu) {
        var cls = stu.class || '未知班级';
        allClasses[cls] = true;
    });
    Object.keys(allClasses).sort(function(a,b) {
        var na = parseInt(a.match(/\d+/)?.[0] || '0');
        var nb = parseInt(b.match(/\d+/)?.[0] || '0');
        return na - nb || a.localeCompare(b, 'zh-CN');
    }).forEach(function(cls) {
        var opt = document.createElement('option');
        opt.value = cls; opt.textContent = cls;
        classSel.appendChild(opt);
    });
    if (prevClassVal && (prevClassVal === '__all__' || allClasses[prevClassVal])) classSel.value = prevClassVal;
    // Filter by selected class
    var selectedClass = classSel.value;
    var dataSource = selectedClass === '__all__' ? combinedStudentData : combinedStudentData.filter(function(stu) {
        return (stu.class || '未知班级') === selectedClass;
    });
    if (!dataSource.length) { section.style.display = 'none'; return; }
    // Get full marks for score rate calculation
    var fullMarks = expandSubjectFullMarks(getSubjectFullMarksFromInputs());
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    // 总分满分按英语整科固定100分，不重复累加笔试、听说或合并字段。
    // 单科得分率仍按各自 fullMarks 计算，不修改学生总分。
    var totalFullMark = calculateTotalExamFullMark(displaySubjects, fullMarks, totalName);
    if (totalName && totalFullMark > 0) fullMarks[totalName] = totalFullMark;
    var heatSubjects = displaySubjects.filter(function(sn) {
        if (sn === totalName) return totalFullMark > 0;
        var fm = fullMarks[sn];
        if (fm == null && sn === '英语') fm = (fullMarks['英语笔试']||0) + (fullMarks['听说']||0);
        return fm != null && fm > 0;
    });
    if (!heatSubjects.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    // Read bucket size from selector
    var bucketSize = parseInt(document.getElementById('heatmapBucketSelect').value, 10);
    bucketSize = isNaN(bucketSize) || bucketSize < 1 ? 5 : Math.min(bucketSize, 20);
    var numBuckets = Math.ceil(100 / bucketSize);
    // Build bucket labels: "0-5%" "5-10%" ... "95-100%"
    var bucketLabels = [];
    for (var bi = 0; bi < numBuckets; bi++) {
        var lo = bi * bucketSize, hi = Math.min((bi + 1) * bucketSize, 100);
        bucketLabels.push(lo + '-' + hi + '%');
    }
    // Compute per-subject distribution
    var seriesData = [];
    var perRowMin = [], perRowMax = [];
    heatSubjects.forEach(function(sn, si) {
        var counts = new Array(numBuckets).fill(0);
        dataSource.forEach(function(stu) {
            var sd = getSubjectDataByAlias(stu, sn);
            var score = sd ? parseFloat(sd.score) : NaN;
            var fm = fullMarks[sn];
            if (fm == null && sn === '英语') fm = (fullMarks['英语笔试']||0) + (fullMarks['听说']||0);
            if (isNaN(score) || !fm || fm <= 0) return;
            var rate = score / fm * 100;
            var idx = Math.min(Math.floor(rate / bucketSize), numBuckets - 1);
            counts[idx]++;
        });
        var rowMin = Infinity, rowMax = -Infinity;
        for (var bi = 0; bi < numBuckets; bi++) {
            if (counts[bi] < rowMin) rowMin = counts[bi];
            if (counts[bi] > rowMax) rowMax = counts[bi];
        }
        perRowMin.push(rowMin);
        perRowMax.push(rowMax);
        for (var bi = 0; bi < numBuckets; bi++) {
            seriesData.push([bi, si, counts[bi]]);
        }
    });
    if (!seriesData.length) { section.style.display = 'none'; return; }
    // Normalize per-row: map each row's count range to [0, 1] for color
    var normData = seriesData.map(function(d) {
        var ri = d[1], mn = perRowMin[ri], mx = perRowMax[ri];
        var norm = mx > mn ? (d[2] - mn) / (mx - mn) : 0.5;
        return { value: [d[0], ri, norm], raw: d[2] };
    });
    var chartH = Math.max(300, heatSubjects.length * 50 + 80);
    var chartDiv = document.getElementById('classDiffHeatmapChart');
    chartDiv.style.height = chartH + 'px';
    var existing = chartDiv.__chart;
    if (existing) try { existing.dispose(); } catch(e) {}
    var chart = AppCore.charts.init(chartDiv, null, {renderer:'svg'});
    chartDiv.__chart = chart;
    chart.setOption({
        tooltip: {
            position: 'top',
            formatter: function(params) {
                var subj = heatSubjects[params.value[1]];
                var lo = params.value[0] * bucketSize;
                var hi = Math.min((params.value[0] + 1) * bucketSize, 100);
                var cnt = params.data.raw;
                var total = dataSource.length;
                var pct = total > 0 ? (cnt / total * 100).toFixed(1) : '0.0';
                return subj + '<br/>得分率 ' + lo + '%-' + hi + '%<br/>人数: <b>' + cnt + '</b> 人 (占 ' + pct + '%)';
            }
        },
        grid: { left: 80, right: 30, top: 20, bottom: 110 },
        xAxis: {
            type: 'category', data: bucketLabels, splitArea: { show: true },
            axisLabel: { fontSize: 10, rotate: 45, interval: 'auto' },
            name: '得分率',
            nameLocation: 'center', nameGap: 50,
            nameTextStyle: { fontSize: 13 }
        },
        yAxis: {
            type: 'category', data: heatSubjects, splitArea: { show: true },
            axisLabel: { fontSize: 13 },
            axisLine: { show: false }
        },
        visualMap: {
            min: 0, max: 1, show: false,
            inRange: {
                color: ['#053061', '#2166ac', '#4393c3', '#1a9850', '#66bd63',
                        '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#67001f']
            }
        },
        series: [{
            type: 'heatmap', data: normData,
            label: { show: false },
            emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
        }]
    });
    chart.resize();
    heatmapReportExportContext = {
        dataSource: dataSource,
        heatSubjects: heatSubjects,
        fullMarks: fullMarks,
        bucketSize: bucketSize,
        selectedClass: selectedClass
    };
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || !params.data || params.data.value == null) return;
        var bi = params.value[0], si = params.value[1];
        if (bi == null || si == null) return;
        var subj = heatSubjects[si];
        if (!subj) return;
        var lo = bi * bucketSize, hi = Math.min((bi + 1) * bucketSize, 100);
        var fm = fullMarks[subj];
        if (fm == null && subj === '英语') fm = (fullMarks['英语笔试']||0) + (fullMarks['听说']||0);
        if (!fm || fm <= 0) return;
        // Find students in this range
        var matched = dataSource.filter(function(stu) {
            var sd = getSubjectDataByAlias(stu, subj);
            var score = sd ? parseFloat(sd.score) : NaN;
            if (isNaN(score)) return false;
            var rate = score / fm * 100;
            var isLastBucket = bi === numBuckets - 1;
            return rate >= lo && (isLastBucket ? rate <= hi : rate < hi);
        }).sort(function(a, b) {
            var ca = a.class || '', cb = b.class || '';
            if (ca !== cb) return ca.localeCompare(cb, 'zh-CN');
            return (a.name || '').localeCompare(b.name || '', 'zh-CN');
        });
        if (!matched.length) return;
        var title = subj + ' 得分率 ' + lo + '%-' + hi + '% 共' + matched.length + '人';
        var names = matched.map(function(s, i) {
            var sd = getSubjectDataByAlias(s, subj);
            var sc = sd ? sd.score : '';
            return (i+1) + '. ' + (s.class || '') + ' ' + s.name + (sc !== '' ? ' (' + sc + '分)' : '');
        }).join('<br>');
        showStudentListModal(title, names);
    });
}

function getHeatmapSubjectRateBuckets(dataSource, subjectName, fullMarks, bucketSize) {
    var fm = fullMarks[subjectName];
    if (fm == null && subjectName === '英语') fm = (fullMarks['英语笔试']||0) + (fullMarks['听说']||0);
    if (!fm || fm <= 0) return [];
    var numBuckets = Math.ceil(100 / bucketSize);
    var buckets = [];
    for (var bi = 0; bi < numBuckets; bi++) {
        var lo = bi * bucketSize, hi = Math.min((bi + 1) * bucketSize, 100);
        buckets.push({ lo: lo, hi: hi, label: lo + '-' + hi + '%', students: [] });
    }
    dataSource.forEach(function(stu) {
        var sd = getSubjectDataByAlias(stu, subjectName);
        var score = sd ? parseFloat(sd.score) : NaN;
        if (isNaN(score)) return;
        var rate = score / fm * 100;
        var idx = Math.min(Math.floor(rate / bucketSize), numBuckets - 1);
        if (idx < 0) return;
        buckets[idx].students.push({
            name: getStudentDisplayName(stu) || stu.name || '',
            className: stu.class || '未知班级',
            score: score,
            rate: rate
        });
    });
    buckets.forEach(function(bucket) {
        bucket.students.sort(function(a, b) {
            if (a.className !== b.className) return String(a.className).localeCompare(String(b.className), 'zh-CN');
            return b.score - a.score || String(a.name).localeCompare(String(b.name), 'zh-CN');
        });
    });
    return buckets;
}

function buildHeatmapReportSvg(subjectName, selectedClass, buckets, total) {
    var chartBuckets = buckets.slice();
    var palette = ['#053061', '#2c7fb8', '#2ca25f', '#74c476', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#67001f', '#225ea8'];
    var colW = 220, left = 28, top = 76, bandH = 58, labelH = 210, nameTop = top + bandH + labelH;
    var maxNames = Math.max.apply(null, chartBuckets.map(function(b) { return b.students.length; }).concat([1]));
    var rowH = 52, width = left + chartBuckets.length * colW + 44, height = nameTop + maxNames * rowH + 60;
    var title = subjectName + '得分率区间名单图（' + (selectedClass === '__all__' ? '全部班级' : selectedClass) + '，共' + total + '人）';
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">'];
    parts.push('<rect width="100%" height="100%" fill="#ffffff"/>');
    parts.push('<text x="' + left + '" y="40" font-size="34" font-weight="800" fill="#1e3a5f">' + escapeHtml(title) + '</text>');
    chartBuckets.forEach(function(bucket, i) {
        var x = left + i * colW;
        var color = palette[i % palette.length];
        parts.push('<rect x="' + x + '" y="' + top + '" width="' + colW + '" height="' + bandH + '" fill="' + color + '" stroke="#ffffff" stroke-width="1"/>');
        parts.push('<text x="' + (x + colW / 2) + '" y="' + (top + bandH + 50) + '" text-anchor="middle" font-size="30" font-weight="800" fill="#64748b">' + escapeHtml(bucket.label) + '</text>');
        parts.push('<text x="' + (x + colW / 2) + '" y="' + (top + bandH + 100) + '" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">' + bucket.students.length + '人</text>');
        if (bucket.students.length) parts.push('<text x="' + (x + 14) + '" y="' + (top + bandH + 152) + '" font-size="26" font-weight="800" fill="#334155">班  姓名  分</text>');
        parts.push('<line x1="' + x + '" y1="' + (top + bandH) + '" x2="' + x + '" y2="' + (height - 20) + '" stroke="#e2e8f0" stroke-width="1"/>');
        bucket.students.forEach(function(s, si) {
            var y = nameTop + si * rowH;
            var classNo = String(s.className || '').replace(/^0+/, '') || String(s.className || '');
            var name = classNo + '  ' + s.name + '  ' + Number(s.score.toFixed(1));
            parts.push('<text x="' + (x + 14) + '" y="' + y + '" font-size="30" fill="#111827">' + escapeHtml(name) + '</text>');
        });
    });
    parts.push('<line x1="' + left + '" y1="' + (top + bandH) + '" x2="' + (left + chartBuckets.length * colW) + '" y2="' + (top + bandH) + '" stroke="#334155" stroke-width="1"/>');
    parts.push('</svg>');
    return parts.join('');
}

function downloadHeatmapReportImage(svgText, fileName) {
    if (!svgText) return;
    var img = new Image();
    var svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(svgBlob);
    img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.width * 2;
        canvas.height = img.height * 2;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    img.onerror = function() { URL.revokeObjectURL(url); showAlert('名单图生成失败，请重试'); };
    img.src = url;
}

async function exportHeatmapSubjectRosterImage() {
    if (!heatmapReportExportContext || !heatmapReportExportContext.heatSubjects || !heatmapReportExportContext.heatSubjects.length) {
        await showAlert('请先生成得分率热力图后再导出名单图');
        return;
    }
    var subjects = heatmapReportExportContext.heatSubjects;
    var promptText = '请选择要导出的科目编号：\n' + subjects.map(function(sn, i) { return (i + 1) + '. ' + sn; }).join('\n');
    var input = window.prompt(promptText, '1');
    if (input == null) return;
    var idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= subjects.length) {
        await showAlert('科目编号无效，请重新点击导出');
        return;
    }
    var subjectName = subjects[idx];
    var buckets = getHeatmapSubjectRateBuckets(heatmapReportExportContext.dataSource, subjectName, heatmapReportExportContext.fullMarks, heatmapReportExportContext.bucketSize);
    var total = buckets.reduce(function(sum, bucket) { return sum + bucket.students.length; }, 0);
    var svgText = buildHeatmapReportSvg(subjectName, heatmapReportExportContext.selectedClass, buckets, total);
    var classLabel = heatmapReportExportContext.selectedClass === '__all__' ? '全部班级' : heatmapReportExportContext.selectedClass;
    downloadHeatmapReportImage(svgText, subjectName + '_得分率区间名单图_' + classLabel + '.png');
}

// Re-render heatmap when bucket size or class changes
function reRenderHeatmap() {
    var stats = [], classNames = [], displaySubjects = [];
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    var scoredSubjects = getScoredSubjectNames(combinedStudentData, allSubjectHeaders);
    displaySubjects = scoredSubjects.filter(function(name) { return name !== totalName; });
    if (totalName && scoredSubjects.indexOf(totalName) >= 0) displaySubjects.push(totalName);
    renderClassDiffHeatmap(stats, classNames, displaySubjects);
}
document.getElementById('heatmapBucketSelect').addEventListener('change', reRenderHeatmap);
document.getElementById('heatmapClassSelect').addEventListener('change', reRenderHeatmap);
document.getElementById('heatmapExportSubjectImageBtn').addEventListener('click', exportHeatmapSubjectRosterImage);

function buildGradeDistributionExportRows(stats, subjectName, classNames) {
    var exportGrades = ['A+', 'A', 'B+', 'B', 'C+', 'C'];
    var rowsByClass = {};
    (stats || []).forEach(function(row) { rowsByClass[row.班级] = row; });
    var rows = (classNames || []).map(function(className) {
        var source = rowsByClass[className] || {};
        var gradeCounts = source[subjectName] || {};
        var counts = {};
        var percentages = {};
        var validCount = 0;
        exportGrades.forEach(function(grade) {
            var count = parseInt(gradeCounts[grade], 10);
            counts[grade] = isNaN(count) || count < 0 ? 0 : count;
            validCount += counts[grade];
        });
        exportGrades.forEach(function(grade) {
            percentages[grade] = (validCount > 0 ? counts[grade] / validCount * 100 : 0).toFixed(1) + '%';
        });
        return { className: className, counts: counts, percentages: percentages, validCount: validCount };
    });
    return { grades: exportGrades, rows: rows };
}

function buildGradeDistributionExportSvg(subjectName, exportData) {
    var grades = exportData && exportData.grades ? exportData.grades : [];
    var rows = exportData && exportData.rows ? exportData.rows : [];
    var classWidth = 150, valueWidth = 120, left = 32, top = 86, headerHeight = 58, rowHeight = 54;
    var columnCount = grades.length * 2;
    var tableWidth = classWidth + columnCount * valueWidth;
    var width = left * 2 + tableWidth;
    var height = top + headerHeight + Math.max(rows.length, 1) * rowHeight + 36;
    var title = subjectName + '等级分布统计（按班级）';
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">'];
    parts.push('<rect width="100%" height="100%" fill="#ffffff"/>');
    parts.push('<text x="' + left + '" y="46" font-size="30" font-weight="800" fill="#1e3a5f">' + escapeHtml(title) + '</text>');
    var headers = ['班级'];
    grades.forEach(function(grade) { headers.push(grade + '人数'); headers.push(grade + '比例'); });
    var x = left;
    headers.forEach(function(header, index) {
        var columnWidth = index === 0 ? classWidth : valueWidth;
        parts.push('<rect x="' + x + '" y="' + top + '" width="' + columnWidth + '" height="' + headerHeight + '" fill="#1e3a5f" stroke="#ffffff"/>');
        parts.push('<text x="' + (x + columnWidth / 2) + '" y="' + (top + 37) + '" text-anchor="middle" font-size="20" font-weight="700" fill="#ffffff">' + escapeHtml(header) + '</text>');
        x += columnWidth;
    });
    rows.forEach(function(row, rowIndex) {
        var y = top + headerHeight + rowIndex * rowHeight;
        var fill = rowIndex % 2 ? '#f8fafc' : '#ffffff';
        var cells = [row.className];
        grades.forEach(function(grade) { cells.push(String(row.counts[grade])); cells.push(row.percentages[grade]); });
        var cellX = left;
        cells.forEach(function(cell, index) {
            var columnWidth = index === 0 ? classWidth : valueWidth;
            parts.push('<rect x="' + cellX + '" y="' + y + '" width="' + columnWidth + '" height="' + rowHeight + '" fill="' + fill + '" stroke="#cbd5e1"/>');
            parts.push('<text x="' + (cellX + columnWidth / 2) + '" y="' + (y + 35) + '" text-anchor="middle" font-size="20" fill="#0f172a">' + escapeHtml(cell) + '</text>');
            cellX += columnWidth;
        });
    });
    parts.push('</svg>');
    return parts.join('');
}

async function exportClassDiffGradeSubjectImage() {
    var context = gradeDistributionExportContext;
    if (!context || !context.subjects || !context.subjects.length) {
        await showAlert('请先加载包含等级数据的成绩');
        return;
    }
    var promptText = '请选择要导出的科目编号：\n' + context.subjects.map(function(subjectName, index) { return (index + 1) + '. ' + subjectName; }).join('\n');
    var input = window.prompt(promptText, '1');
    if (input == null) return;
    var subjectIndex = parseInt(input, 10) - 1;
    if (isNaN(subjectIndex) || subjectIndex < 0 || subjectIndex >= context.subjects.length) {
        await showAlert('科目编号无效，请重新点击导出');
        return;
    }
    var subjectName = context.subjects[subjectIndex];
    var exportData = buildGradeDistributionExportRows(context.stats, subjectName, context.classNames);
    var svgText = buildGradeDistributionExportSvg(subjectName, exportData);
    downloadHeatmapReportImage(svgText, subjectName + '_等级分布统计.png');
}

function renderClassDiffGradeDistribution() {
    gradeDistributionExportContext = null;
    var gradeSubjects = getGradedSubjectNames(combinedStudentData, allSubjectHeaders).map(function(name) { return { name:name }; });
    if (!gradeSubjects.length) {
        document.getElementById('classDiffGradeSection').style.display = 'none';
        return;
    }
    document.getElementById('classDiffGradeSection').style.display = 'block';
    // Collect all used grade values
    var allGrades = new Set();
    combinedStudentData.forEach(function(stu) {
        gradeSubjects.forEach(function(sh) {
            var sd = getSubjectDataByAlias(stu, sh.name);
            if (sd && sd.grade && typeof sd.grade === 'string') allGrades.add(sd.grade.trim());
        });
    });
    var gradeOrder = ['A+','A','B+','B','C+','C'];
    var grades = Array.from(allGrades).sort(function(a,b) {
        var ia = gradeOrder.indexOf(a), ib = gradeOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1; if (ib !== -1) return 1;
        return a.localeCompare(b, 'zh-CN');
    });
    // Group by class
    var classMap = {};
    combinedStudentData.forEach(function(stu) {
        var cls = stu.class || '未知班级';
        if (!classMap[cls]) classMap[cls] = [];
        classMap[cls].push(stu);
    });
    var classNames = Object.keys(classMap).sort(function(a,b) {
        var na = parseInt(a.match(/\d+/)?.[0] || '0');
        var nb = parseInt(b.match(/\d+/)?.[0] || '0');
        return na - nb || a.localeCompare(b);
    });
    // Stats per class per grade subject
    var stats = [];
    classNames.forEach(function(cls) {
        var arr = classMap[cls];
        var row = { 班级: cls };
        gradeSubjects.forEach(function(sh) {
            var gradeCount = {};
            grades.forEach(function(g) { gradeCount[g] = 0; });
            arr.forEach(function(stu) {
                var sd = getSubjectDataByAlias(stu, sh.name);
                var g = sd ? (sd.grade || '').trim() : '';
                if (grades.indexOf(g) >= 0) gradeCount[g]++;
            });
            row[sh.name] = gradeCount;
        });
        stats.push(row);
    });
    // Render table
    var container = document.getElementById('classDiffGradeTableContainer');
    var html = '<table class="stats-table"><thead><tr><th>班级</th>';
    gradeSubjects.forEach(function(sh) { html += '<th>' + sh.name + '</th>'; });
    html += '</tr></thead><tbody>';
    stats.forEach(function(row) {
        html += '<tr><td>' + escapeHtml(row.班级) + '</td>';
        gradeSubjects.forEach(function(sh) {
            html += '<td>' + grades.map(function(g) { return g + ': <b>' + (row[sh.name][g] || 0) + '</b>'; }).join('<br>') + '</td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
    gradeDistributionExportContext = {
        subjects: gradeSubjects.map(function(sh) { return sh.name; }),
        stats: stats,
        classNames: classNames
    };
    // Subject select for chart
    var select = document.getElementById('classDiffGradeSubjectSelect');
    select.innerHTML = '';
    gradeSubjects.forEach(function(sh) {
        var opt = document.createElement('option');
        opt.value = sh.name; opt.textContent = sh.name; select.appendChild(opt);
    });
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    var defaultIdx = gradeSubjects.findIndex(function(sh) { return sh.name === totalName; });
    if (defaultIdx >= 0) select.selectedIndex = defaultIdx;
    renderClassDiffGradeChart(gradeSubjects[select.selectedIndex].name, stats, classNames, grades);
    select.onchange = function() {
        renderClassDiffGradeChart(select.value, stats, classNames, grades);
    };
}

function renderClassDiffGradeChart(selectedSubjectName, stats, classNames, grades) {
    var chartDiv = document.getElementById('classDiffGradeChart');
    if (!chartDiv) return;
    if (chartDiv.__chart) try { chartDiv.__chart.dispose(); } catch(e) {}
    var series = grades.map(function(g) {
        return {
            name: g, type: 'bar', stack: '等级',
            data: stats.map(function(row) { return row[selectedSubjectName] ? (row[selectedSubjectName][g] || 0) : 0; }),
            barGap: 0, barCategoryGap: '30%', emphasis: { focus: 'series' }, itemStyle: { opacity: 0.85 },
            label: { show: true, position: 'inside', fontSize: 13, formatter: function(p) { return p.value > 0 ? p.value : ''; } }
        };
    });
    var chart = AppCore.charts.init(chartDiv, null, {renderer:'svg'});
    chartDiv.__chart = chart;
    chart.setOption({
        tooltip: {
            trigger: 'item', axisPointer: { type: 'shadow' },
            formatter: function(params) {
                if (!params) return '';
                return '班级: <b>' + params.name + '</b><br/>' + params.seriesName + ': <b>' + params.value + '</b>人';
            }
        },
        legend: { data: grades, top: 0, textStyle: { fontSize: 14 } },
        xAxis: { type: 'category', data: classNames, axisLabel: { fontSize: 14, rotate: 45, interval: 0 } },
        yAxis: { type: 'value', name: '人数', axisLabel: { fontSize: 14 } },
        series: series,
        grid: { left: 60, right: 20, top: 40, bottom: 80 }
    });
    chart.resize();
    chart.on('click', function(params) {
        if (!params || !params.name || !params.seriesName) return;
        var cls = params.name;
        var grade = params.seriesName;
        var students = combinedStudentData.filter(function(stu) {
            if ((stu.class || '未知班级') !== cls) return false;
            var sd = getSubjectDataByAlias(stu, selectedSubjectName);
            return sd && sd.grade && sd.grade.trim() === grade;
        });
        if (!students.length) return;
        var title = escapeHtml(cls) + ' - ' + escapeHtml(selectedSubjectName) + ' [' + escapeHtml(grade) + '] 共' + students.length + '人';
        var names = students.map(function(s, i) {
            var sd = getSubjectDataByAlias(s, selectedSubjectName);
            var score = sd ? sd.score : '';
            return (i+1) + '. ' + escapeHtml(s.name) + (score !== '' ? ' (' + escapeHtml(score) + '分)' : '');
        }).join('<br>');
        showStudentListModal(title, names);
    });
}
document.getElementById('classDiffGradeExportBtn').addEventListener('click', exportClassDiffGradeSubjectImage);

function renderClassDiffRankDistribution() {
    if (!combinedStudentData.length) return;
    var select = document.getElementById('classDiffRankSubject');
    var selectedSubject = select ? select.value : '';
    if (!selectedSubject) {
        document.getElementById('classDiffRankSection').style.display = 'none';
        return;
    }
    document.getElementById('classDiffRankSection').style.display = 'block';
    // Filter students with valid score for selected subject
    var scoredStudents = combinedStudentData.filter(function(stu) {
        var sd = getSubjectDataByAlias(stu, selectedSubject);
        if (!sd) return false;
        var s = parseFloat(sd.score);
        return !isNaN(s) && isFinite(s);
    });
    if (!scoredStudents.length) {
        document.getElementById('classDiffDistributionTablesContainer').innerHTML = '<div class="no-data">所选科目暂无有效的分数数据</div>';
        return;
    }
    // Sort by score descending (higher score = better rank)
    scoredStudents.sort(function(a, b) {
        var sa = parseFloat(getSubjectDataByAlias(a, selectedSubject).score) || 0;
        var sb = parseFloat(getSubjectDataByAlias(b, selectedSubject).score) || 0;
        if (sb !== sa) return sb - sa;
        return 0;
    });
    // Assign ranks with tie handling (same score = same rank, skip ranks accordingly)
    var rankedStudents = [];
    var currentRank = 1;
    for (var i = 0; i < scoredStudents.length; i++) {
        if (i > 0) {
            var prevScore = parseFloat(getSubjectDataByAlias(scoredStudents[i-1], selectedSubject).score) || 0;
            var currScore = parseFloat(getSubjectDataByAlias(scoredStudents[i], selectedSubject).score) || 0;
            if (currScore !== prevScore) currentRank = i + 1;
        }
        rankedStudents.push({ rank: currentRank, student: scoredStudents[i], normClass: normalizeClassName(scoredStudents[i].class || '未知班级') });
    }
    // Class list from ranked students (using normalized names)
    var classSet = new Set();
    rankedStudents.forEach(function(item) { classSet.add(item.normClass); });
    var classList = Array.from(classSet).sort(function(a,b) {
        var na = parseInt(a.match(/\d+/)?.[0] || '0');
        var nb = parseInt(b.match(/\d+/)?.[0] || '0');
        return na - nb || a.localeCompare(b);
    });
    var interval = parseInt(document.getElementById('classDiffIntervalInput').value, 10) || 20;
    if (interval < 1) interval = 1;
    var maxRank = rankedStudents.length ? rankedStudents[rankedStudents.length - 1].rank : 0;
    var segmentCount = Math.ceil(maxRank / interval);
    var container = document.getElementById('classDiffDistributionTablesContainer');
    var chartLabels = [], chartDatasets = {}, classColors = generateClassDiffColors(classList), classSegmentCounts = {};
    var classSegmentStudents = {};
    classList.forEach(function(cls) { classSegmentCounts[cls] = []; classSegmentStudents[cls] = []; });
    var html = '<table class="distribution-table"><thead><tr><th>名次段</th>';
    classList.forEach(function(cls) { html += '<th>' + cls + '</th>'; });
    html += '<th>总人数</th></tr></thead><tbody>';
    for (var i = 0; i < segmentCount; i++) {
        var startRank = i * interval + 1;
        var endRank = (i + 1) * interval;
        var segmentLabel = startRank + '-' + endRank + '名';
        chartLabels.push(segmentLabel);
        // Students with rank in this segment
        var segStudents = rankedStudents.filter(function(item) { return item.rank >= startRank && item.rank <= endRank; });
        var classCounts = {}, total = 0;
        segStudents.forEach(function(item) {
            var cls = item.normClass || '未知班级';
            classCounts[cls] = (classCounts[cls] || 0) + 1; total++;
        });
        classList.forEach(function(cls) {
            if (!chartDatasets[cls]) { chartDatasets[cls] = { label: cls, data: [], backgroundColor: classColors[cls] || '#999' }; }
            var count = classCounts[cls] || 0;
            chartDatasets[cls].data.push(count);
            classSegmentCounts[cls].push(count);
            // Collect student names for this class+segment
            var names = segStudents.filter(function(item) { return item.normClass === cls; }).map(function(item) { return item.student.name; });
            classSegmentStudents[cls].push(names);
        });
        html += '<tr><td>' + segmentLabel + '</td>';
        classList.forEach(function(cls) {
            var count = classCounts[cls] || 0, percent = total > 0 ? (count / total * 100).toFixed(1) : 0;
            html += '<td style="background:' + (classColors[cls] || '#999') + '20;">' + count + '人 (' + percent + '%)</td>';
        });
        html += '<td style="font-weight:bold;">' + total + '人</td></tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    updateClassDiffDistributionChart(chartLabels, Object.values(chartDatasets), rankedStudents, selectedSubject, classList);
    // Multi-batch data for extra charts
    var multiBatchRankData = null;
    var selectedBatches = getClassDiffSelectedBatches();
    if (selectedBatches.length > 1) {
        multiBatchRankData = [];
        selectedBatches.forEach(function(batch) {
            var batchScored = batch.data.filter(function(stu) {
                var sd = getSubjectDataByAlias(stu, selectedSubject);
                if (!sd) return false;
                var s = parseFloat(sd.score);
                return !isNaN(s) && isFinite(s);
            });
            if (!batchScored.length) return;
            batchScored.sort(function(a, b) {
                var sa = parseFloat(getSubjectDataByAlias(a, selectedSubject).score) || 0;
                var sb = parseFloat(getSubjectDataByAlias(b, selectedSubject).score) || 0;
                return (sb !== sa) ? sb - sa : 0;
            });
            var batchRanked = [];
            var cr = 1;
            for (var ri = 0; ri < batchScored.length; ri++) {
                if (ri > 0) {
                    var ps = parseFloat(getSubjectDataByAlias(batchScored[ri-1], selectedSubject).score) || 0;
                    var cs = parseFloat(getSubjectDataByAlias(batchScored[ri], selectedSubject).score) || 0;
                    if (cs !== ps) cr = ri + 1;
                }
                batchRanked.push({ rank: cr, student: batchScored[ri], normClass: normalizeClassName(batchScored[ri].class || '未知班级') });
            }
            var bClassSegmentCounts = {};
            var bClassSegmentStudents = {};
            classList.forEach(function(cls) { bClassSegmentCounts[cls] = []; bClassSegmentStudents[cls] = []; });
            var bMaxRank = batchRanked.length ? batchRanked[batchRanked.length - 1].rank : 0;
            var bSegCount = Math.ceil(bMaxRank / interval);
            if (bSegCount > segmentCount) bSegCount = segmentCount;
            for (var si = 0; si < bSegCount; si++) {
                var sStart = si * interval + 1;
                var sEnd = (si + 1) * interval;
                var segStu = batchRanked.filter(function(item) { return item.rank >= sStart && item.rank <= sEnd; });
                classList.forEach(function(cls) {
                    var cnt = segStu.filter(function(item) { return item.normClass === cls; }).length;
                    bClassSegmentCounts[cls].push(cnt);
                    var names = segStu.filter(function(item) { return item.normClass === cls; }).map(function(item) { return item.student.name; });
                    bClassSegmentStudents[cls].push(names);
                });
            }
            for (var si = bSegCount; si < segmentCount; si++) {
                classList.forEach(function(cls) {
                    bClassSegmentCounts[cls].push(0);
                    bClassSegmentStudents[cls].push([]);
                });
            }
            multiBatchRankData.push({ label: batch.label, classSegmentCounts: bClassSegmentCounts, classSegmentStudents: bClassSegmentStudents });
        });
    }
    updateClassDiffDistributionExtraCharts(chartLabels, classList, classSegmentCounts, classColors, classSegmentStudents, multiBatchRankData, rankedStudents, selectedSubject);
}

function updateClassDiffDistributionChart(labels, datasets, rankedStudents, selectedSubject, classList) {
    var chartDiv = document.getElementById('classDiffDistributionChart');
    if (!chartDiv) return;
    if (classDiffEchartsInst.mainChart) try { classDiffEchartsInst.mainChart.dispose(); } catch(e) {}
    var chart = AppCore.charts.init(chartDiv, null, {renderer: 'svg'});
    classDiffEchartsInst.mainChart = chart;
    chart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { data: datasets.map(function(ds) { return ds.label; }), top: 0, textStyle: { fontSize: 16 } },
        xAxis: { type: 'category', data: labels, name: '名次段', nameLocation: 'middle', nameGap: 50, nameTextStyle: { fontSize: 18, fontWeight: 'bold' }, axisLabel: { fontSize: 15, interval: 0, rotate: 45, show: true } },
        yAxis: { type: 'value', name: '人数', nameLocation: 'middle', nameGap: 30, nameTextStyle: { fontSize: 18, fontWeight: 'bold' }, axisLabel: { fontSize: 15, interval: 0, show: true } },
        series: datasets.map(function(ds) { return { name: ds.label, type: 'bar', stack: 'total', data: ds.data, itemStyle: { color: ds.backgroundColor } }; }),
        grid: { left: 60, right: 20, top: 30, bottom: 85 }
    });
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || params.dataIndex == null || !params.seriesName) return;
        var segIdx = params.dataIndex;
        var cls = params.seriesName;
        var segLabel = labels[segIdx];
        if (!segLabel) return;
        var parts = segLabel.match(/(\d+)-(\d+)/);
        if (!parts) return;
        var startRank = parseInt(parts[1]), endRank = parseInt(parts[2]);
        var matched = rankedStudents.filter(function(item) {
            return item.rank >= startRank && item.rank <= endRank && item.normClass === cls;
        });
        if (!matched.length) return;
        var title = escapeHtml(cls) + ' ' + segLabel + ' 共' + matched.length + '人';
        var names = matched.map(function(s, i) {
            var sd = getSubjectDataByAlias(s.student, selectedSubject);
            var score = sd ? sd.score : '';
            return (i+1) + '. ' + escapeHtml(s.student.name) + (score !== '' ? ' (' + escapeHtml(score) + '分)' : '');
        }).join('<br>');
        showStudentListModal(title, names);
    });
}

function updateClassDiffDistributionExtraCharts(labels, classList, classSegmentCounts, classColors, classSegmentStudents, multiBatchRankData, rankedStudents, selectedSubject) {
    var container = document.getElementById('classDiffDistributionExtraCharts');
    container.innerHTML = '';
    if (classList.length < 1) return;
    var isMulti = multiBatchRankData && multiBatchRankData.length > 0;
    var batchColors = ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4'];
    // Individual bar per class, 2 per row
    classList.forEach(function(cls, idx) {
        var barDiv = document.createElement('div');
        barDiv.className = "distribution-extra-chart-item";
        barDiv.style.width = 'calc(50% - 15px)';
        barDiv.style.minWidth = '300px';
        barDiv.innerHTML = '<div class="distribution-extra-chart-title">' + escapeHtml(cls) + '班各名次段人数</div><div id="classDiffEchartsBar_' + idx + '" style="width:100%;height:320px"></div>';
        container.appendChild(barDiv);
    });
    // Pie chart
    var pieDiv = document.createElement('div');
    pieDiv.className = "distribution-extra-chart-item";
    pieDiv.style.width = 'calc(50% - 15px)';
    pieDiv.style.minWidth = '300px';
    pieDiv.innerHTML = '<div class="distribution-extra-chart-title">各班级总人数分布</div><div id="classDiffEchartsPie" style="width:100%;height:320px"></div>';
    container.appendChild(pieDiv);
    setTimeout(function() {
        // Bars per class
        classList.forEach(function(cls, idx) {
            var barId = 'classDiffEchartsBar_' + idx;
            var barEl = document.getElementById(barId);
            var barChart = AppCore.charts.init(barEl, null, {renderer:'svg'});
            if (isMulti) {
                var patternChars = ['/', '\\', '-', 'x', 'o', 'O', '.', '*'];
                var batchSeries = multiBatchRankData.map(function(bd, bi) {
                    var cnts = bd.classSegmentCounts[cls] || [];
                    return {
                        name: bd.label,
                        type: 'bar',
                        data: cnts,
                        itemStyle: {
                            color: createPatternFill(patternChars[bi % patternChars.length], batchColors[bi % batchColors.length]),
                            borderColor: batchColors[bi % batchColors.length],
                            borderWidth: 1
                        }
                    };
                });
                barChart.setOption({
                    tooltip: {
                        trigger: 'axis',
                        formatter: function(ps) {
                            if (!ps || !ps.length) return '';
                            var res = '<b>' + cls + '班</b><br/>';
                            ps.forEach(function(p) {
                                var idx = p.dataIndex;
                                var batchLabel = p.seriesName;
                                var cnt = p.value;
                                var names = (multiBatchRankData.find(function(bd) { return bd.label === batchLabel; })?.classSegmentStudents?.[cls]?.[idx]) || [];
                                res += batchLabel + ' - ' + labels[idx] + ': <b>' + cnt + '</b>人';
                                if (names.length > 0) res += ' (' + names.join('、') + ')';
                                res += '<br/>';
                            });
                            return res;
                        }
                    },
                    legend: { data: multiBatchRankData.map(function(bd) { return bd.label; }), top: 0, textStyle: { fontSize: 14 } },
                    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 15, interval: 0, rotate: 45, show: true } },
                    yAxis: { type: 'value', name: '人数', nameLocation: 'middle', nameGap: 40, nameRotate: 90, nameTextStyle: { fontSize: 16, fontWeight: 'bold' }, axisLabel: { fontSize: 18, interval: 0, show: true } },
                    series: batchSeries,
                    grid: { left: 60, right: 20, top: 40, bottom: 80 }
                });
                barChart.off('click');
                barChart.on('click', function(params) {
                    if (!params || params.dataIndex == null) return;
                    var segIdx = params.dataIndex;
                    var segLabel = labels[segIdx];
                    if (!segLabel) return;
                    var parts = segLabel.match(/(\d+)-(\d+)/);
                    if (!parts) return;
                    var startRank = parseInt(parts[1]), endRank = parseInt(parts[2]);
                    var matched = rankedStudents.filter(function(item) {
                        return item.rank >= startRank && item.rank <= endRank && item.normClass === cls;
                    });
                    if (!matched.length) return;
                    var title = escapeHtml(cls) + ' ' + segLabel + ' 共' + matched.length + '人';
                    var names = matched.map(function(s, i) {
                        var sd = getSubjectDataByAlias(s.student, selectedSubject);
                        var score = sd ? sd.score : '';
                        return (i+1) + '. ' + escapeHtml(s.student.name) + (score !== '' ? ' (' + escapeHtml(score) + '分)' : '');
                    }).join('<br>');
                    showStudentListModal(title, names);
                });
            } else {
                var studentsBySegment = (classSegmentStudents && classSegmentStudents[cls]) || [];
                barChart.setOption({
                    tooltip: {
                        trigger: 'axis',
                        formatter: function(ps) {
                            if (!ps || !ps.length) return '';
                            var p = ps[0];
                            var idx = p.dataIndex;
                            var names = studentsBySegment[idx] || [];
                            var res = '<b>' + cls + '班</b><br/>名次段: ' + labels[idx] + '<br/>人数: <b>' + p.value + '</b>人';
                            if (names.length > 0) res += '<br/>学生: ' + names.join('、');
                            return res;
                        }
                    },
                    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 15, interval: 0, rotate: 45, show: true } },
                    yAxis: { type: 'value', name: '人数', nameLocation: 'middle', nameGap: 40, nameRotate: 90, nameTextStyle: { fontSize: 16, fontWeight: 'bold' }, axisLabel: { fontSize: 18, interval: 0, show: true } },
                    series: [{ name: cls, type: 'bar', data: classSegmentCounts[cls], color: classColors[cls] }],
                    grid: { left: 60, right: 20, top: 20, bottom: 80 }
                });
                barChart.off('click');
                barChart.on('click', function(params) {
                    if (!params || params.dataIndex == null) return;
                    var segIdx = params.dataIndex;
                    var segLabel = labels[segIdx];
                    if (!segLabel) return;
                    var parts = segLabel.match(/(\d+)-(\d+)/);
                    if (!parts) return;
                    var startRank = parseInt(parts[1]), endRank = parseInt(parts[2]);
                    var matched = rankedStudents.filter(function(item) {
                        return item.rank >= startRank && item.rank <= endRank && item.normClass === cls;
                    });
                    if (!matched.length) return;
                    var title = escapeHtml(cls) + ' ' + segLabel + ' 共' + matched.length + '人';
                    var names = matched.map(function(s, i) {
                        var sd = getSubjectDataByAlias(s.student, selectedSubject);
                        var score = sd ? sd.score : '';
                        return (i+1) + '. ' + escapeHtml(s.student.name) + (score !== '' ? ' (' + escapeHtml(score) + '分)' : '');
                    }).join('<br>');
                    showStudentListModal(title, names);
                });
            }
        });
        // Pie (always uses current batch data)
        var totalByClass = classList.map(function(cls) { return classSegmentCounts[cls].reduce(function(a,b){return a+b;}, 0); });
        var pieEl = document.getElementById('classDiffEchartsPie');
        var pieChart = AppCore.charts.init(pieEl, null, {renderer:'svg'});
        pieChart.setOption({
            tooltip: { trigger: 'item', textStyle: { fontSize: 18 } },
            legend: { orient: 'vertical', left: 10, data: classList, textStyle: { fontSize: 18 } },
            series: [{ name: '班级分布', type: 'pie', radius: '45%', data: classList.map(function(cls,i) { return { value: totalByClass[i], name: cls, itemStyle: { color: classColors[cls] } }; }), label: { fontSize: 18, formatter: '{b}: {d}%' } }]
        });
    }, 40);
}

function generateClassDiffColors(classes) {
    var colors = {}, palette = SMART_CHART_PALETTE;
    classes.forEach(function(cls, idx) { colors[cls] = palette[idx % palette.length]; });
    return colors;
}

function renderClassDiffBoxPlot() {
    var chartDiv = document.getElementById('classDiffBoxChart');
    if (!chartDiv) return;
    var subject = document.getElementById('classDiffBoxSubject').value;
    if (!subject) return;
    // Group by class
    var classMap = {};
    combinedStudentData.forEach(function(stu) {
        var cls = stu.class || '未知班级';
        if (!classMap[cls]) classMap[cls] = [];
        var sd = getSubjectDataByAlias(stu, subject);
        if (sd) { var s = parseFloat(sd.score); if (!isNaN(s)) classMap[cls].push(s); }
    });
    var classNames = Object.keys(classMap).sort(function(a,b) {
        var na = parseInt((a||'').toString().match(/\d+/)?.[0] || '0');
        var nb = parseInt((b||'').toString().match(/\d+/)?.[0] || '0');
        return na - nb || a.localeCompare(b);
    });
    if (!classNames.length) { chartDiv.innerHTML = '<div class="no-data">无有效数据</div>'; return; }
    // Compute boxplot values + std dev / median for each class
    function computeBoxValues(scores) {
        if (!scores.length) return null;
        var sorted = scores.slice().sort(function(a,b){return a-b;});
        var n = sorted.length;
        var min = sorted[0], max = sorted[n-1];
        var median = n % 2 === 1 ? sorted[Math.floor(n/2)] : (sorted[n/2-1] + sorted[n/2]) / 2;
        var q1i = Math.floor(n * 0.25), q3i = Math.floor(n * 0.75);
        var q1 = n % 2 === 0 ? sorted[q1i] : (sorted[q1i] + sorted[q1i+1]) / 2;
        var q3 = n % 2 === 0 ? sorted[q3i] : (sorted[q3i] + sorted[q3i+1]) / 2;
        var mean = scores.reduce(function(a,b){return a+b;},0) / n;
        var variance = scores.reduce(function(a,b){return a + (b-mean)*(b-mean);},0) / n;
        var stdDev = Math.sqrt(variance);
        return { min: min, q1: q1, median: median, q3: q3, max: max, stdDev: stdDev, mean: mean };
    }
    var boxData = [], stdDevs = [], medians = [];
    classNames.forEach(function(cls) {
        var scores = classMap[cls];
        var bv = computeBoxValues(scores);
        if (bv) boxData.push([bv.min, bv.q1, bv.median, bv.q3, bv.max]);
        else boxData.push([0,0,0,0,0]);
        stdDevs.push(bv ? bv.stdDev : 0);
        medians.push(bv ? bv.median : 0);
    });
    // Render box plot
    var chart = AppCore.charts.init(chartDiv, null, {renderer:'svg'});
    var series = [{
        name: '箱线图', type: 'boxplot', data: boxData,
        itemStyle: { color: 'rgba(84,112,198,0.3)', borderColor: '#1e3a5f', borderWidth: 2.5 },
        emphasis: { itemStyle: { borderWidth: 3.5 } }
    }];
    chart.setOption({
        tooltip: {
            trigger: 'item',
            formatter: function(params) {
                if (!params.data || !Array.isArray(params.data)) return '';
                var cls = classNames[params.dataIndex];
                var bv = classMap[cls] ? computeBoxValues(classMap[cls]) : null;
                if (!bv) return '';
                return '<b>' + cls + '</b><br/>'
                    + '最大值: ' + bv.max.toFixed(1) + '<br/>'
                    + 'Q3(75%): ' + bv.q3.toFixed(1) + '<br/>'
                    + '中位数: <b>' + bv.median.toFixed(1) + '</b><br/>'
                    + 'Q1(25%): ' + bv.q1.toFixed(1) + '<br/>'
                    + '最小值: ' + bv.min.toFixed(1) + '<br/>'
                    + '均值: ' + bv.mean.toFixed(2) + '<br/>'
                    + '标准差: <b>' + bv.stdDev.toFixed(2) + '</b>';
            }
        },
        grid: { left: 80, right: 40, top: 30, bottom: 80 },
        xAxis: { type: 'category', data: classNames, axisLabel: { fontSize: 14, rotate: 45, interval: 0 }, boundaryGap: true },
        yAxis: { type: 'value', name: '分数', nameLocation: 'middle', nameGap: 45, axisLabel: { fontSize: 14 } },
        series: series
    });
    chart.resize();
}

// Event handler for box plot update button (in case change on select doesn't work)
document.getElementById('classDiffBoxUpdateBtn').addEventListener('click', function() {
    if (document.getElementById('classDiffBoxSection').style.display !== 'none') {
        renderClassDiffBoxPlot();
    }
});
document.getElementById('classDiffBoxSubject').addEventListener('change', function() {
    renderClassDiffBoxPlot();
});
