/* 图文报告：个人、班级、单科、进退步、临界预警和关联图表。
 * Classic script: reads the shared data pool only when an analysis is invoked.
 */
function parseRankNumber(rankVal) {
    if (rankVal == null) return null;
    var m = String(rankVal).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

var originalDocumentTitle = document.title;

function getTodayString() {
    return new Date().toISOString().slice(0, 10);
}

function sanitizePdfFileName(name) {
    return String(name || '图文报告').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function startNamedPrint(title, printClassName) {
    originalDocumentTitle = originalDocumentTitle || document.title;
    document.title = sanitizePdfFileName(title || '图文报告');
    document.body.classList.add(printClassName);
    setTimeout(function() { window.print(); }, 80);
}

function getStudentTrendName(data, fallbackName) {
    return String(data.displayName || data.name || fallbackName || '').trim();
}

function getTotalRankTrendForReport(studentKey) {
    var ps = DataPool.trendParsedSheets;
    if (!ps || !ps.total || !ps.total.rows.length) { ps = buildParsedSheetsFromAllBatches(); if (ps) DataPool.trendParsedSheets = ps; }
    if (!ps || !ps.total || !ps.total.rows.length) return null;
    var row = findRowData(ps.total, studentKey);
    if (!row || !row.values.length) return null;
    return { labels: row.labels, values: row.values.map(function(v) { var x = parseFloat(v); return isNaN(x) ? null : x; }) };
}

function getSubjectRankCompareForReport(studentKey, subjects) {
    var ps = DataPool.trendParsedSheets;
    if (!ps || !ps.subjects) { ps = buildParsedSheetsFromAllBatches(); if (ps) DataPool.trendParsedSheets = ps; }
    if (!ps || !ps.subjects) return [];
    var nameToId = { '语文': 'chinese', '数学': 'math', '英语': 'english', '英语笔试': 'english', '英语合': 'english', '英语听说': 'englishListening', '物理': 'physics', '历史': 'history', '道法': 'daofa', '道德与法治': 'daofa', '化学': 'chemistry', '生物': 'biology', '地理': 'geography' };
    var rows = [];
    subjects.forEach(function(s) {
        var id = nameToId[s.name];
        if (!id || !ps.subjects[id]) return;
        var trend = findRowData(ps.subjects[id], studentKey);
        if (!trend || trend.values.length < 2) return;
        var vals = trend.values.map(function(v) { var x = parseFloat(v); return isNaN(x) ? null : x; }).filter(function(v) { return v != null; });
        if (vals.length < 2) return;
        var prev = vals[vals.length - 2];
        var cur = vals[vals.length - 1];
        rows.push({ name: s.name, prev: prev, cur: cur, change: prev - cur });
    });
    return rows.sort(function(a, b) { return Math.abs(b.change) - Math.abs(a.change); });
}

function classifySubjectTrend(scoreRates, rankPercentiles) {
    var count = Math.min((scoreRates || []).length, (rankPercentiles || []).length);
    if (count < 2) return null;
    var scoreStart = Number(scoreRates[0]), scoreEnd = Number(scoreRates[count - 1]);
    var rankStart = Number(rankPercentiles[0]), rankEnd = Number(rankPercentiles[count - 1]);
    var scoreChange = scoreEnd - scoreStart;
    var rankChange = rankStart - rankEnd;
    var scoreDirection = scoreChange > 0.03 ? 1 : (scoreChange < -0.03 ? -1 : 0);
    var rankDirection = rankChange > 0.05 ? 1 : (rankChange < -0.05 ? -1 : 0);
    var directionConflict = scoreDirection !== 0 && rankDirection !== 0 && scoreDirection !== rankDirection;
    var note = directionConflict ? '得分率与排名百分位方向不一致，可能受试卷难度或群体变化影响。' : '';
    var classification;
    if (count === 2) {
        var direction = scoreDirection !== 0 ? scoreDirection : rankDirection;
        classification = direction > 0 ? '上升' : (direction < 0 ? '下降' : '基本稳定');
        return { classification: classification, directionConflict: directionConflict, note: note };
    }
    var scoreUp = true, scoreDown = true, rankUp = true, rankDown = true;
    var hasScoreMove = false, hasRankMove = false;
    for (var i = 1; i < count; i++) {
        var sd = Number(scoreRates[i]) - Number(scoreRates[i - 1]);
        var rd = Number(rankPercentiles[i - 1]) - Number(rankPercentiles[i]);
        if (sd < -0.02) scoreUp = false;
        if (sd > 0.02) scoreDown = false;
        if (rd < -0.03) rankUp = false;
        if (rd > 0.03) rankDown = false;
        if (Math.abs(sd) > 0.02) hasScoreMove = true;
        if (Math.abs(rd) > 0.03) hasRankMove = true;
    }
    if (!hasScoreMove && !hasRankMove) classification = '稳定';
    else if (!directionConflict && scoreUp && rankUp && (hasScoreMove || hasRankMove)) classification = '持续进步';
    else if (!directionConflict && scoreDown && rankDown && (hasScoreMove || hasRankMove)) classification = '持续下降';
    else classification = '学科表现波动';
    return { classification: classification, directionConflict: directionConflict, note: note };
}

function classifySubjectRankTrend(rankPercentiles) {
    var values = (rankPercentiles || []).map(function(value) { return Number(value); }).filter(function(value) { return isFinite(value); });
    if (values.length < 2) return null;
    var changes = [];
    var hasProgress = false;
    var hasDecline = false;
    var epsilon = 0.000001;
    for (var i = 1; i < values.length; i++) {
        var change = values[i] - values[i - 1];
        changes.push(change);
        if (change >= 0.05 - epsilon) hasDecline = true;
        if (change <= -0.05 + epsilon) hasProgress = true;
    }
    var latest = changes[changes.length - 1];
    var isFluctuating = hasProgress && hasDecline;
    if (isFluctuating && Math.abs(latest) >= 0.10 - epsilon) {
        return latest > 0
            ? { text: '明显退步', cls: 'sr-danger' }
            : { text: '明显进步', cls: 'sr-good' };
    }
    var trailingDirection = latest >= 0.05 - epsilon ? 1 : (latest <= -0.05 + epsilon ? -1 : 0);
    var trailingCount = trailingDirection ? 1 : 0;
    for (var j = changes.length - 2; trailingDirection && j >= 0; j--) {
        var direction = changes[j] >= 0.05 - epsilon ? 1 : (changes[j] <= -0.05 + epsilon ? -1 : 0);
        if (direction !== trailingDirection) break;
        trailingCount++;
    }
    if (trailingCount >= 2) {
        return trailingDirection > 0
            ? { text: '持续退步', cls: 'sr-danger' }
            : { text: '持续进步', cls: 'sr-good' };
    }
    if (Math.abs(latest) >= 0.10 - epsilon) {
        return latest > 0
            ? { text: '明显退步', cls: 'sr-danger' }
            : { text: '明显进步', cls: 'sr-good' };
    }
    if (isFluctuating) return { text: '排名波动', cls: 'sr-warn' };
    return null;
}

function getSubjectRankTrendForReport(studentKey, subjectName) {
    var ps = buildParsedSheetsFromAllBatches('__all__');
    if (!ps || !ps.subjects) return null;
    var nameToId = { '语文': 'chinese', '数学': 'math', '英语': 'english', '英语笔试': 'english', '物理': 'physics', '历史': 'history', '道法': 'daofa', '道德与法治': 'daofa', '化学': 'chemistry', '生物': 'biology', '地理': 'geography' };
    var id = nameToId[subjectName];
    var dataset = id ? ps.subjects[id] : null;
    if (!dataset) return null;
    var rankRow = findRowData(dataset, studentKey);
    if (!rankRow) return null;
    var records = [];
    for (var i = 0; i < rankRow.values.length; i++) {
        var rank = parseFloat(rankRow.values[i]);
        var population = dataset.rows.filter(function(row) {
            var value = parseFloat(row[i + 1]);
            return !isNaN(value) && value > 0;
        }).length;
        if (isNaN(rank) || rank <= 0 || population <= 0 || rank > population) continue;
        records.push({ rank: rank, population: population, percentile: rank / population });
    }
    var trend = classifySubjectRankTrend(records.map(function(record) { return record.percentile; }));
    if (!trend) return null;
    var previous = records[records.length - 2];
    var current = records[records.length - 1];
    trend.pointCount = records.length;
    trend.title = '最近排名：' + previous.rank + '/' + previous.population + '（前' + Math.round(previous.percentile * 100) + '%）→' + current.rank + '/' + current.population + '（前' + Math.round(current.percentile * 100) + '%）；有效批次：' + records.length;
    return trend;
}

function getSubjectTrendInfoForReport(studentKey, subjectName, fullMark) {
    var ps = buildParsedSheetsFromAllBatches('__all__');
    if (!ps) return null;
    var nameToId = { '语文': 'chinese', '数学': 'math', '英语': 'english', '英语笔试': 'english', '物理': 'physics', '历史': 'history', '道法': 'daofa', '道德与法治': 'daofa', '化学': 'chemistry', '生物': 'biology', '地理': 'geography' };
    var id = nameToId[subjectName];
    if (!id || !ps.subjectScores[id] || !ps.subjects[id]) return null;
    var scoreRow = findRowData(ps.subjectScores[id], studentKey);
    var rankRow = findRowData(ps.subjects[id], studentKey);
    if (!scoreRow || !rankRow) return null;
    var scoreRates = [], rankPercentiles = [];
    for (var i = 0; i < Math.min(scoreRow.values.length, rankRow.values.length); i++) {
        var score = parseFloat(scoreRow.values[i]);
        var rank = parseFloat(rankRow.values[i]);
        var fm = parseFloat(fullMark);
        if (subjectName === '英语' && DataPool.batches && DataPool.batches[i]) fm = resolveAmbiguousEnglishFullMark(DataPool.batches[i].combinedStudentData || []);
        var population = ps.subjects[id].rows.filter(function(row) { var value = parseFloat(row[i + 1]); return !isNaN(value) && value > 0; }).length;
        if (isNaN(score) || isNaN(rank) || isNaN(fm) || fm <= 0 || population <= 0) continue;
        scoreRates.push(score / fm);
        rankPercentiles.push(rank / population);
    }
    var trendInfo = classifySubjectTrend(scoreRates, rankPercentiles);
    if (trendInfo) trendInfo.pointCount = scoreRates.length;
    return trendInfo;
}

function getStudentReadableReportData(studentName, thresholdVal) {
    var raw = extractStudentAnalysisData(studentName, thresholdVal);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
}

function computeSubjectStructuralPriorities(targetStudent, allStudents, reportSubjects, totalName) {
    var result = {};
    if (!targetStudent || !allStudents || !allStudents.length || !reportSubjects || !reportSubjects.length || !totalName) return result;
    function toNumber(v) {
        if (typeof v === 'string' && !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(v)) return null;
        if (typeof v !== 'number' && typeof v !== 'string') return null;
        var n = Number(v);
        return isFinite(n) ? n : null;
    }
    function getScore(stu, subjectName) {
        var sd = stu && stu.subjects ? stu.subjects[subjectName] : null;
        return sd ? toNumber(sd.score) : null;
    }
    var targetTotal = getScore(targetStudent, totalName);
    if (targetTotal == null || targetTotal < 0) return result;
    reportSubjects.forEach(function(subjectInfo) {
        var subjectName = subjectInfo.name;
        var targetScore = toNumber(subjectInfo.score);
        var fullMark = toNumber(subjectInfo.fullMark);
        var hasValidFullMark = fullMark != null && fullMark >= 0;
        if (targetScore == null || targetScore < 0 || targetScore > targetTotal || (hasValidFullMark && targetScore > fullMark)) return;
        var targetAnchor = targetTotal - targetScore;
        var peers = [];
        var validPopulation = 0;
        allStudents.forEach(function(stu) {
            if (!stu) return;
            var totalScore = getScore(stu, totalName);
            var peerScore = getScore(stu, subjectName);
            if (totalScore == null || peerScore == null || totalScore < 0 || peerScore < 0 || peerScore > totalScore || (hasValidFullMark && peerScore > fullMark)) return;
            validPopulation++;
            if (stu === targetStudent) return;
            var peerAnchor = totalScore - peerScore;
            peers.push({ score: peerScore, distance: Math.abs(peerAnchor - targetAnchor) });
        });
        peers.sort(function(a, b) { return a.distance - b.distance; });
        var peerTarget = Math.max(3, Math.ceil(validPopulation * 0.05));
        var usablePeers = peers.slice(0, peerTarget);
        if (usablePeers.length < 3) return;
        var sortedScores = usablePeers.map(function(p) { return p.score; }).sort(function(a, b) { return a - b; });
        var middle = Math.floor(sortedScores.length / 2);
        var median = sortedScores.length % 2 ? sortedScores[middle] : (sortedScores[middle - 1] + sortedScores[middle]) / 2;
        var avg = usablePeers.reduce(function(sum, p) { return sum + p.score; }, 0) / usablePeers.length;
        var gap = median - targetScore;
        var focusThreshold = fullMark && fullMark > 0 ? Math.max(5, fullMark * 0.10) : 8;
        var assistThreshold = fullMark && fullMark > 0 ? Math.max(3, fullMark * 0.06) : 5;
        var level = 'normal';
        if (gap >= focusThreshold) level = 'focus';
        else if (gap >= assistThreshold) level = 'assist';
        result[subjectName] = { level: level, gap: gap, peerMedian: median, peerAverage: avg, peerCount: usablePeers.length, peerTarget: peerTarget, sampleComplete: usablePeers.length === peerTarget };
    });
    return result;
}

function computeSubjectLiftScenarios(targetStudent, allStudents, reportSubjects, totalName, structuralPriorities, liftRatioOpt) {
    var rows = [];
    if (!targetStudent || !allStudents || !allStudents.length || !reportSubjects || !reportSubjects.length || !totalName || !structuralPriorities) return rows;
    function toNumber(v) {
        var n = parseFloat(v);
        return isNaN(n) ? null : n;
    }
    function getScore(stu, subjectName) {
        var sd = stu && stu.subjects ? stu.subjects[subjectName] : null;
        return sd ? toNumber(sd.score) : null;
    }
    var targetTotal = getScore(targetStudent, totalName);
    if (targetTotal == null) return rows;
    var liftRatio = parseFloat(liftRatioOpt);
    if (isNaN(liftRatio)) liftRatio = 0.6;
    liftRatio = Math.max(0.4, Math.min(0.8, liftRatio));
    var totalScores = allStudents.map(function(stu) { return getScore(stu, totalName); }).filter(function(v) { return v != null; });
    if (totalScores.length < 30) return rows;
    var currentRank = totalScores.filter(function(v) { return v > targetTotal; }).length + 1;
    var primaryRows = [];
    var alternativeRows = [];
    function isExcludedSubject(subjectName) {
        var name = String(subjectName || '').replace(/\s/g, '');
        return name.indexOf('\u542c\u8bf4') !== -1 || name.indexOf('\u542c\u529b') !== -1 || name === '\u82f1\u8bed\u5408\u5e76' || name === '\u82f1\u8bed\u603b\u5206' || name === '\u82f1\u8bed\u5408' || name === '\u82f1\u8bed/\u542c\u8bf4';
    }
    function pushScenario(subjectInfo, structural, scenarioType, estimatedLift, remainingSpace) {
        if (estimatedLift < 1) return;
        var simulatedTotal = targetTotal + estimatedLift;
        var simulatedRank = totalScores.filter(function(v) { return v > simulatedTotal; }).length + 1;
        var rankGain = Math.max(0, currentRank - simulatedRank);
        var row = {
            name: subjectInfo.name,
            structuralGap: structural ? structural.gap : null,
            estimatedLift: estimatedLift,
            simulatedTotal: simulatedTotal,
            rankGain: rankGain,
            peerCount: structural && structural.peerCount ? structural.peerCount : 0,
            confidence: structural && structural.peerCount >= 15 ? 'medium' : 'low',
            scenarioType: scenarioType,
            remainingSpace: remainingSpace
        };
        if (scenarioType === 'alternative') alternativeRows.push(row);
        else primaryRows.push(row);
    }
    reportSubjects.forEach(function(subjectInfo) {
        var structural = structuralPriorities[subjectInfo.name];
        var score = toNumber(subjectInfo.score);
        var fullMark = toNumber(subjectInfo.fullMark);
        if (score == null || fullMark == null || fullMark <= score || isExcludedSubject(subjectInfo.name)) return;
        var remainingSpace = fullMark - score;
        if (structural && structural.gap > 0 && structural.level !== 'normal') {
            pushScenario(subjectInfo, structural, 'primary', Math.min(structural.gap * liftRatio, remainingSpace), remainingSpace);
        } else {
            pushScenario(subjectInfo, structural, 'alternative', remainingSpace * liftRatio, remainingSpace);
        }
    });
    primaryRows.sort(function(a, b) { return b.structuralGap - a.structuralGap || b.estimatedLift - a.estimatedLift; });
    alternativeRows.sort(function(a, b) { return b.remainingSpace - a.remainingSpace || b.estimatedLift - a.estimatedLift; });
    return primaryRows.slice(0, 2).concat(alternativeRows.slice(0, 2));
}

function canShowRankPrediction(batchCount, sampleSize) {
    return batchCount >= 2 && sampleSize >= 30;
}

function getActionPrioritySubjects(subjects, structuralPriorities, liftScenarios, fallbackWeakest) {
    var byName = {};
    (subjects || []).forEach(function(s) { byName[s.name] = s; });
    var picked = {};
    var result = [];
    function addByName(name) {
        if (!name || picked[name] || !byName[name]) return;
        picked[name] = true;
        result.push(byName[name]);
    }
    (liftScenarios || []).forEach(function(row) { addByName(row.name); });
    Object.keys(structuralPriorities || {}).filter(function(name) {
        var info = structuralPriorities[name];
        return info && info.level === 'focus';
    }).sort(function(a, b) { return structuralPriorities[b].gap - structuralPriorities[a].gap; }).forEach(addByName);
    Object.keys(structuralPriorities || {}).filter(function(name) {
        var info = structuralPriorities[name];
        return info && info.level === 'assist';
    }).sort(function(a, b) { return structuralPriorities[b].gap - structuralPriorities[a].gap; }).forEach(addByName);
    (fallbackWeakest || []).forEach(function(s) { addByName(s.name); });
    return result;
}

function selectTeacherReviewSubjects(subjects, structuralPriorities, actionPrioritySubjects) {
    function isExcluded(name) {
        var normalized = String(name || '').replace(/\s/g, '');
        return /听说|听力/.test(normalized) || normalized === '英语合并' || normalized === '英语总分' || normalized === '英语合' || normalized === '英语/听说';
    }
    var priorityNames = (actionPrioritySubjects || []).map(function(item) { return item.name; });
    return (subjects || []).map(function(subject) {
        var structural = structuralPriorities ? structuralPriorities[subject.name] : null;
        if (!structural || structural.gap <= 0 || (structural.level !== 'focus' && structural.level !== 'assist') || isExcluded(subject.name)) return null;
        var priorityIndex = priorityNames.indexOf(subject.name);
        return { subject: subject, structural: structural, priorityIndex: priorityIndex < 0 ? 999 : priorityIndex, priorityText: '辅助', gapText: Math.round(structural.gap) + '分' };
    }).filter(function(item) { return item !== null; }).sort(function(a, b) {
        return a.priorityIndex - b.priorityIndex || b.structural.gap - a.structural.gap;
    }).map(function(item, index) { item.priorityText = index === 0 ? '主优先' : '辅助'; return item; });
}

function filterLiftScenariosForTeacherReview(liftScenarios, teacherReviewSubjects) {
    var order = {};
    (teacherReviewSubjects || []).forEach(function(item, index) { order[item.subject.name] = index; });
    return (liftScenarios || []).filter(function(row) {
        return order.hasOwnProperty(row.name) && typeof row.structuralGap === 'number' && row.structuralGap > 0;
    }).sort(function(a, b) { return order[a.name] - order[b.name]; });
}

function getReadableSubjectStatus(subjectInfo, structuralInfo) {
    if (structuralInfo && structuralInfo.level === 'focus') {
        return { text: '精准发力（同水平低约' + Math.round(structuralInfo.gap) + '分）', cls: 'sr-focus' };
    }
    if (structuralInfo && structuralInfo.level === 'assist') {
        return { text: '可补短板（同水平低约' + Math.round(structuralInfo.gap) + '分）', cls: 'sr-assist' };
    }
    var rate = subjectInfo.rate;
    var weakCount = subjectInfo.weakCount || 0;
    if (rate != null && rate >= 85 && weakCount > 0) return { text: '优势但有局部弱项', cls: 'sr-warn' };
    if (rate != null && rate >= 85) return { text: '优势稳定', cls: 'sr-good' };
    if (rate != null && rate >= 70 && weakCount > 0) return { text: '需补弱', cls: 'sr-warn' };
    if (rate != null && rate < 70) return { text: '重点补弱', cls: 'sr-danger' };
    return { text: '观察', cls: '' };
}

function getClassItemAverageRate(subjectName, itemName) {
    var totalScore = 0;
    var totalMax = 0;
    combinedStudentData.forEach(function(stu) {
        var sd = stu.subjects && stu.subjects[subjectName];
        var item = sd && sd.subScores ? sd.subScores[itemName] : null;
        if (!item || typeof item !== 'object') return;
        var score = parseFloat(item.score);
        var maxScore = parseFloat(item.maxScore);
        if (isNaN(score) || isNaN(maxScore) || maxScore <= 0) return;
        totalScore += score;
        totalMax += maxScore;
    });
    if (totalMax <= 0) return null;
    return totalScore / totalMax;
}

function getReadableItemComparison(studentRate, classRate) {
    if (classRate == null || isNaN(classRate)) return '无全体数据';
    var diff = studentRate - classRate;
    var pct = Math.round(Math.abs(diff) * 100);
    if (Math.abs(diff) < 0.05) return '接近全体均值';
    return diff > 0 ? '高于全体' + pct + '个百分点' : '低于全体' + pct + '个百分点';
}

function classifyWeakItemNature(studentRate, classRate) {
    if (typeof studentRate !== 'number' || typeof classRate !== 'number' || isNaN(studentRate) || isNaN(classRate)) {
        return { label: '需面谈', reason: '个人或全体得分率数据不完整' };
    }
    if (studentRate <= 0.5 && classRate >= 0.65 && classRate - studentRate >= 0.15) {
        return { label: '个体短板', reason: '个人得分率低，且全体表现正常' };
    }
    if (studentRate <= 0.5 && classRate <= 0.55) {
        return { label: '班级共性难题', reason: '个人与全体得分率均低' };
    }
    return { label: '需面谈', reason: '现有差异不足以直接归因' };
}

function classifySubjectLossStructure(items) {
    var losses = (items || []).map(function(item) {
        var score = parseFloat(item.score);
        var maxScore = parseFloat(item.maxScore);
        return !isNaN(score) && !isNaN(maxScore) && maxScore > 0 ? Math.max(0, maxScore - score) : null;
    }).filter(function(loss) { return loss !== null && loss > 0; }).sort(function(a, b) { return b - a; });
    if (losses.length < 3) return { label: '证据不足', reason: '可用失分题少于3题' };
    var total = 0;
    for (var i = 0; i < losses.length; i++) total += losses[i];
    var concentrated = total > 0 && (losses[0] + losses[1]) / total >= 0.65;
    return concentrated
        ? { label: '局部可修复', reason: '前2道题占该科已识别失分的65%以上' }
        : { label: '系统性', reason: '失分分散在多道题，暂不宜归为单一局部问题' };
}

function assessTeacherReviewConfidence(structuralInfo, usableItemCount, trendInfo) {
    var sources = 0;
    var reasons = [];
    if (structuralInfo && structuralInfo.sampleComplete && structuralInfo.peerCount >= 3) { sources++; reasons.push('同水平样本完整'); }
    else reasons.push('同水平样本不足或不完整');
    if (usableItemCount >= 3) { sources++; reasons.push('小题证据较充分'); }
    else if (usableItemCount >= 2) { sources++; reasons.push('小题证据有限'); }
    else reasons.push('小题证据不足');
    if (trendInfo && trendInfo.pointCount >= 3) { sources++; reasons.push('有至少3次学科趋势'); }
    else reasons.push('学科趋势不足3次');
    return { level: sources === 3 ? '较高' : (sources === 2 ? '中等' : '有限'), reason: reasons.join('；') };
}

function selectInterviewItemCandidates(teacherReviewSubjects, weakItems, maxCount) {
    var names = (teacherReviewSubjects || []).map(function(item) { return item.subject ? item.subject.name : item.name; });
    var limit = typeof maxCount === 'number' ? Math.min(6, Math.max(0, maxCount)) : 6;
    return (weakItems || []).filter(function(item) {
        return names.indexOf(item.subject) >= 0 && classifyWeakItemNature(item.rate, item.classRate).label === '个体短板';
    }).sort(function(a, b) {
        var priorityDiff = names.indexOf(a.subject) - names.indexOf(b.subject);
        if (priorityDiff !== 0) return priorityDiff;
        var rateDiff = (typeof a.rate === 'number' ? a.rate : 1) - (typeof b.rate === 'number' ? b.rate : 1);
        if (rateDiff !== 0) return rateDiff;
        var aGap = typeof a.classRate === 'number' ? a.classRate - a.rate : -1;
        var bGap = typeof b.classRate === 'number' ? b.classRate - b.rate : -1;
        return bGap - aGap;
    }).slice(0, limit);
}

function getSubjectReviewItems(subjectName, weakItems) {
    return (weakItems || []).filter(function(item) { return item.subject === subjectName; });
}

function getTeacherInterviewDirection(structureInfo, subjectItems) {
    if (!subjectItems.length) return '先核对答题过程与试卷信息，不预设知识点';
    var individualCount = subjectItems.filter(function(item) { return classifyWeakItemNature(item.rate, item.classRate).label === '个体短板'; }).length;
    if (individualCount) return '围绕个人明显低于全体的小题复盘解题过程';
    if (structureInfo.label === '系统性') return '核对多题失分是否来自共同方法或作答流程';
    return '结合原卷与学生口述确认问题位置';
}

function renderStudentReadableReport(studentName, thresholdVal) {
    var data = getStudentReadableReportData(studentName, thresholdVal);
    if (!data) return false;
    var output = document.getElementById('studentReadableReportOutput');
    var content = document.getElementById('studentReadableReportContent');
    if (!output || !content) return false;
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    var total = totalName && data.subjects[totalName] ? data.subjects[totalName] : null;
    var subjectFullMarks = data.subjectFullMarks || {};
    var subjects = Object.keys(data.subjects || {}).filter(function(sn) { return sn !== totalName; }).map(function(sn) {
        var sd = data.subjects[sn] || {};
        var fm = subjectFullMarks[sn];
        if (fm == null && sn === '英语') fm = (subjectFullMarks['英语笔试'] || 0) + (subjectFullMarks['听说'] || 0);
        var score = typeof sd.score === 'number' ? sd.score : parseFloat(sd.score);
        var rate = (!isNaN(score) && typeof fm === 'number' && fm > 0) ? Math.round(score / fm * 100) : null;
        var weakCount = sd.weakSubScores && sd.weakSubScores.items ? sd.weakSubScores.items.length : 0;
        return { name: sn, score: isNaN(score) ? null : score, fullMark: fm || null, rate: rate, grade: sd.grade || '-', rank: parseRankNumber(sd.gradeRank || sd.schoolRank), weakCount: weakCount, raw: sd, trendInfo: getSubjectTrendInfoForReport(studentName, sn, fm), rankTrendInfo: getSubjectRankTrendForReport(studentName, sn) };
    }).filter(function(s) { return s.score !== null || s.rank !== null || s.weakCount > 0; });
    var weakItems = [];
    subjects.forEach(function(s) {
        var items = s.raw.weakSubScores && s.raw.weakSubScores.items ? s.raw.weakSubScores.items : [];
        items.forEach(function(item) {
            var classRate = getClassItemAverageRate(s.name, item.item);
            weakItems.push({ subject: s.name, item: item.item, score: item.score, maxScore: item.maxScore, rate: item.rate, classRate: classRate, studentAnswer: item.studentAnswer || '', correctAnswer: item.correctAnswer || '' });
        });
    });
    weakItems.sort(function(a, b) { return a.rate - b.rate; });
    var strongest = subjects.filter(function(s) { return s.rate != null; }).sort(function(a, b) { return b.rate - a.rate; }).slice(0, 3);
    var weakest = subjects.filter(function(s) { return s.rate != null; }).sort(function(a, b) { return a.rate - b.rate; }).slice(0, 3);
    var totalRank = total ? (total.gradeRank || total.schoolRank || total.classRank || '-') : '-';
    var liftRatio = 0.6;
    var batch = DataPool.getCurrentBatch ? DataPool.getCurrentBatch() : null;
    var reportTitle = (data.displayName || data.name || studentName || '学生') + ' 学生个体图文报告';
    var html = [];
    html.push('<div class="student-readable-report">');
    html.push('<div class="sr-cover"><div class="sr-title"><h2>' + escapeHtml(reportTitle) + '</h2><p>基于当前成绩、小题得分和已保存批次趋势生成，可通过浏览器打印导出 PDF。</p></div>');
    html.push('<div class="sr-meta"><div><b>班级：</b>' + escapeHtml(data.class || '-') + '</div><div><b>批次：</b>' + escapeHtml(batch ? batch.label : '当前批次') + '</div><div><b>薄弱阈值：</b>' + escapeHtml(String(data.weakScoreRateThreshold || thresholdVal || 0.6)) + '</div><div><b>生成时间：</b>' + new Date().toLocaleString() + '</div></div></div>');
    html.push('<div class="sr-kpis">');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">总分</div><div class="sr-kpi-value">' + escapeHtml(total && hasDataValue(total.score) ? String(total.score) : '-') + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">年级/校排名</div><div class="sr-kpi-value">' + escapeHtml(String(totalRank)) + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">薄弱小题</div><div class="sr-kpi-value">' + weakItems.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">优势科目</div><div class="sr-kpi-value" style="font-size:16px;">' + escapeHtml(strongest.map(function(s){return s.name;}).join('、') || '-') + '</div></div>');
    html.push('</div>');

    html.push('<div class="sr-section"><h3>一、整体趋势</h3><div class="sr-note-box">');
    html.push('<b>优势科目：</b>' + escapeHtml(strongest.map(function(s){ return s.name + (s.rate != null ? '(' + s.rate + '%)' : ''); }).join('、') || '暂无可判定数据') + '<br>');
    html.push('<b>优先补强：</b>' + escapeHtml(weakest.map(function(s){ return s.name + (s.rate != null ? '(' + s.rate + '%)' : ''); }).join('、') || '暂无可判定数据') + '<br>');
    html.push('<b>主要风险：</b>' + (weakItems.length ? '存在 ' + weakItems.length + ' 个低于阈值的小题/模块，需优先处理最低得分率项目。' : '本次未发现低于阈值的小题/模块，建议保持节奏并复盘易错点。'));
    html.push('</div><div class="sr-grid"><div id="studentReportTrendChart" class="sr-chart sr-chart-large"></div><div id="studentReportRadarChart" class="sr-chart sr-chart-large"></div></div></div>');

    html.push('<div class="sr-section"><h3>二、科目结构</h3><div class="sr-grid">');
    html.push('<div id="studentReportRankCompareChart" class="sr-chart sr-chart-wide"></div>');
    html.push('</div>');

    html.push('<h4 style="margin:12px 0 4px;color:#1e3a5f;">各科结构明细</h4>');
    html.push('<table class="sr-table"><thead><tr><th>科目</th><th>得分</th><th>满分参考</th><th>得分率</th><th>等级</th><th>年级/校排名</th><th>薄弱数</th><th>状态</th></tr></thead><tbody>');
    var currentStudentEntry = findStudentByNameOrDisplay(combinedStudentData, studentName);
    var structuralPriorities = computeSubjectStructuralPriorities(currentStudentEntry, combinedStudentData, subjects, totalName);
    var savedBatchCount = DataPool && DataPool.batches ? DataPool.batches.length : 0;
    var showRankPrediction = canShowRankPrediction(savedBatchCount, combinedStudentData.length);
    var liftScenarios = showRankPrediction ? computeSubjectLiftScenarios(currentStudentEntry, combinedStudentData, subjects, totalName, structuralPriorities, liftRatio) : [];
    var actionPrioritySubjects = getActionPrioritySubjects(subjects, structuralPriorities, liftScenarios, weakest);
    subjects.forEach(function(s) {
        var statusInfo = getReadableSubjectStatus(s, structuralPriorities[s.name]);
        var status = '<span class="sr-pill ' + statusInfo.cls + '">' + escapeHtml(statusInfo.text) + '</span>';
        if (s.rankTrendInfo) status += ' <span class="sr-pill ' + s.rankTrendInfo.cls + '" title="' + escapeHtml(s.rankTrendInfo.title) + '">' + escapeHtml(s.rankTrendInfo.text) + '</span>';
        html.push('<tr><td>' + escapeHtml(s.name) + '</td><td>' + escapeHtml(s.score != null ? String(s.score) : '-') + '</td><td>' + escapeHtml(s.fullMark != null ? String(s.fullMark) : '-') + '</td><td>' + escapeHtml(s.rate != null ? s.rate + '%' : '-') + '</td><td>' + escapeHtml(s.grade || '-') + '</td><td>' + escapeHtml(s.rank != null ? String(s.rank) : '-') + '</td><td>' + s.weakCount + '</td><td>' + status + '</td></tr>');
    });
    html.push('</tbody></table></div>');

    html.push('<div class="sr-section"><h3>三、教师研判</h3>');
    html.push('<div class="sr-note-box">以下结论用于教师面谈前筛查，只描述学科层级趋势与已观测失分。具体知识点须结合原卷和学生作答确认，系统不自动填写。“同水平”按扣除本科成绩后的其余科目总分接近程度确定，不代表原始总分或排名相同。</div>');
    var teacherReviewSubjects = selectTeacherReviewSubjects(subjects, structuralPriorities, actionPrioritySubjects);
    var teacherReviewLiftScenarios = filterLiftScenariosForTeacherReview(liftScenarios, teacherReviewSubjects);
    if (teacherReviewSubjects.length) {
        html.push('<table class="sr-table sr-review-table"><thead><tr><th>科目</th><th>优先级</th><th>同水平中位数差距</th><th>学科趋势</th><th>可信度</th><th>建议面谈方向</th></tr></thead><tbody>');
    }
    teacherReviewSubjects.forEach(function(reviewItem) {
        var s = reviewItem.subject;
        var structural = reviewItem.structural;
        var subjectItems = getSubjectReviewItems(s.name, weakItems);
        var lossStructure = classifySubjectLossStructure(subjectItems);
        var confidence = assessTeacherReviewConfidence(structural, subjectItems.filter(function(item) { return typeof item.classRate === 'number'; }).length, s.trendInfo);
        var trendText = s.trendInfo ? s.trendInfo.classification + (s.trendInfo.note ? '；' + s.trendInfo.note : '') : '不足2次可用记录';
        var priorityClass = reviewItem.priorityText === '主优先' ? 'sr-focus' : 'sr-assist';
        html.push('<tr><td>' + escapeHtml(s.name) + '</td><td><span class="sr-pill ' + priorityClass + '">' + escapeHtml(reviewItem.priorityText) + '</span></td><td><b>' + escapeHtml(reviewItem.gapText) + '</b></td><td>' + escapeHtml(trendText) + '</td><td><b>' + escapeHtml(confidence.level) + '</b><br>' + escapeHtml(confidence.reason) + '</td><td>' + escapeHtml(getTeacherInterviewDirection(lossStructure, subjectItems)) + '</td></tr>');
    });
    if (teacherReviewSubjects.length) html.push('</tbody></table>');
    else html.push('<div class="sr-note-box">当前未发现达到主优先或辅助阈值的结构短板，暂无需重点干预的科目。</div>');
    if (teacherReviewLiftScenarios.length) {
        html.push('<h4 style="margin:14px 0 4px;color:#1e3a5f;">提升模拟（辅助参考）</h4>');
        html.push('<table class="sr-table"><thead><tr><th>优先科目</th><th>结构差距</th><th>预计可提升</th><th>模拟总分</th><th>约可前进</th></tr></thead><tbody>');
        teacherReviewLiftScenarios.forEach(function(row) {
            var structuralGapText = Math.round(row.structuralGap) + '分';
            html.push('<tr><td>' + escapeHtml(row.name) + '</td><td>' + structuralGapText + '</td><td>' + row.estimatedLift.toFixed(1) + '分</td><td>' + row.simulatedTotal.toFixed(1) + '</td><td>' + (row.rankGain > 0 ? row.rankGain + '名' : '当前分布不明显') + '</td></tr>');
        });
        html.push('</tbody></table>');
    }
    html.push('</div>');

    html.push('<div class="sr-section"><h3>四、具体薄弱题</h3>');
    html.push('<div id="studentReportWeakCompareChart" class="sr-chart sr-chart-wide"></div>');
    html.push('</div>');

    html.push('<div class="sr-section"><h3>五、薄弱小题明细清单</h3>');
    if (weakItems.length) {
        html.push('<table class="sr-table"><thead><tr><th>科目</th><th>题号/模块</th><th>得分</th><th>个人得分率</th><th>全体该题得分率</th><th>与全体对比</th><th>学生答案</th><th>正确答案</th></tr></thead><tbody>');
        weakItems.slice(0, 36).forEach(function(w) {
            var pillClass = w.rate < 0.4 ? 'sr-danger' : 'sr-warn';
            var classRateText = w.classRate == null ? '-' : Math.round(w.classRate * 100) + '%';
            html.push('<tr><td>' + escapeHtml(w.subject) + '</td><td>' + escapeHtml(w.item) + '</td><td>' + escapeHtml(w.score + '/' + w.maxScore) + '</td><td><span class="sr-pill ' + pillClass + '">' + Math.round(w.rate * 100) + '%</span></td><td>' + escapeHtml(classRateText) + '</td><td>' + escapeHtml(getReadableItemComparison(w.rate, w.classRate)) + '</td><td>' + escapeHtml(w.studentAnswer || '无数据') + '</td><td>' + escapeHtml(w.correctAnswer || '无数据') + '</td></tr>');
        });
        html.push('</tbody></table>');
        if (weakItems.length > 36) html.push('<div class="sr-note-box" style="margin-top:8px;">仅展示得分率最低的36项，其余弱项可在 AI 深度报告包中查看。</div>');
    } else {
        html.push('<div class="sr-note-box">暂无低于当前阈值的小题/模块。</div>');
    }
    html.push('</div>');

    html.push('<div class="sr-section"><h3>六、师生面谈与一周行动卡</h3>');
    var interviewCandidates = selectInterviewItemCandidates(teacherReviewSubjects, weakItems, 6);
    if (interviewCandidates.length) {
        html.push('<div class="sr-note-box">系统仅筛选面谈候选，不代替教师归因。教师与学生可共同勾选“本周重点”，错因允许多选。</div><div class="sr-reflection-list">');
        var causeOptions = [
            ['知识理解','概念、定义或原理是否理解准确'], ['知识应用','是否会把已学知识用于当前情境'], ['条件提取','是否遗漏、误读或未转换题目条件'],
            ['推理与步骤','推理链条、步骤顺序或中间依据是否完整'], ['计算问题','运算、估算或数据处理是否出错'], ['单位与符号','单位、正负号或数学符号是否正确'],
            ['表达与规范','答案表述、格式或书写规范是否影响得分'], ['时间与检查','时间分配是否合理，完成后是否检查'], ['其他原因','写下不属于以上类别的具体原因']
        ];
        interviewCandidates.forEach(function(item, index) {
            var classRateText = typeof item.classRate === 'number' ? Math.round(item.classRate * 100) + '%' : '无数据';
            html.push('<div class="sr-reflection-card"><div class="sr-card-heading"><h4>归因/反思卡 ' + (index + 1) + '：' + escapeHtml(item.subject + ' ' + item.item) + '</h4><label class="sr-focus-check"><input type="checkbox"> 本周重点</label></div>');
            html.push('<table class="sr-table"><thead><tr><th>科目</th><th>题号</th><th>个人/全体得分率</th><th>学生答案</th><th>正确答案</th></tr></thead><tbody><tr><td>' + escapeHtml(item.subject) + '</td><td>' + escapeHtml(item.item) + '</td><td>' + Math.round(item.rate * 100) + '% / ' + escapeHtml(classRateText) + '</td><td>' + escapeHtml(item.studentAnswer || '无数据') + '</td><td>' + escapeHtml(item.correctAnswer || '无数据') + '</td></tr><tr><th>错题类别</th><td colspan="4"><span class="sr-pill sr-focus">个体短板</span></td></tr></tbody></table>');
            html.push('<div class="sr-cause-grid">');
            causeOptions.forEach(function(cause) { html.push('<label class="sr-cause-option"><input type="checkbox"><span><b>' + cause[0] + '</b>' + cause[1] + '</span></label>'); });
            html.push('</div><div class="sr-careless-question"><b>“粗心”追问：</b>你说的“粗心”具体发生在哪一步：看错条件、抄错数字、计算错误、单位遗漏、符号写反，还是没有检查？</div>');
            html.push('<div class="sr-form-grid"><label class="sr-form-field sr-full">我原来是这样想的<textarea></textarea></label><label class="sr-form-field sr-full">我从第___步开始出现偏差，主要原因是<textarea></textarea></label><label class="sr-form-field sr-full">下次遇到相似题目，我会先<textarea></textarea></label></div>');
            html.push('<div class="sr-teacher-confirm"><h5>教师确认区</h5><div class="sr-form-grid"><label class="sr-form-field">主要错因<textarea></textarea></label><label class="sr-form-field">知识点/方法<textarea placeholder="由教师结合原卷填写"></textarea></label><label class="sr-form-field">学生归因是否准确<input type="text"></label><label class="sr-form-field">补充说明<textarea></textarea></label></div></div></div>');
        });
        html.push('</div>');
    } else {
        html.push('<div class="sr-note-box">当前优先科目下没有可用薄弱小题，请结合原卷手工确定面谈题目。</div>');
    }
    var candidateRefs = interviewCandidates.map(function(item) { return item.subject + '-' + item.item; }).join('、');
    html.push('<div class="sr-week-card"><div class="sr-card-heading"><h4>一周行动卡</h4></div><div class="sr-form-grid">');
    html.push('<label class="sr-form-field">本周主目标<textarea></textarea></label><label class="sr-form-field">辅助目标（可空）<textarea></textarea></label>');
    html.push('<label class="sr-form-field sr-full">重点题目/题型<textarea>' + escapeHtml(candidateRefs) + '</textarea></label><label class="sr-form-field sr-full">训练任务<textarea></textarea></label>');
    html.push('<label class="sr-form-field">达标标准<textarea></textarea></label><label class="sr-form-field">复测日期<input type="date"></label><label class="sr-form-field">复测结果<textarea></textarea></label><label class="sr-form-field">下一步<textarea></textarea></label>');
    html.push('</div></div></div>');
    html.push('</div>');
    content.innerHTML = html.join('');
    output.dataset.printTitle = reportTitle + '_' + (batch ? batch.label : '当前批次') + '_' + getTodayString();
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideComprehensiveReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderStudentReadableCharts(subjects, weakItems, data, studentName);
    return true;
}

window.addEventListener('beforeprint', function() {
    var fields = document.querySelectorAll('#studentReadableReportContent textarea');
    for (var i = 0; i < fields.length; i++) {
        fields[i].setAttribute('data-print-original-height', fields[i].style.height || '');
        fields[i].style.height = 'auto';
        fields[i].style.height = Math.max(fields[i].scrollHeight, 68) + 'px';
    }
});

function renderStudentReadableCharts(subjects, weakItems, data, studentName) {
    if (typeof echarts === 'undefined') return;
    var studentKey = getStudentTrendName(data, studentName);
    var usable = subjects.filter(function(s) { return s.rate != null; });
    var colors = SMART_CHART_PALETTE;

    var trendEl = document.getElementById('studentReportTrendChart');
    if (trendEl) {
        var trendChart = AppCore.charts.init(trendEl, null, { renderer: 'svg' });
        var trend = getTotalRankTrendForReport(studentKey);
        if (trend && trend.values.some(function(v) { return v != null; })) {
            var valid = trend.values.filter(function(v) { return v != null; });
            var first = valid[0], last = valid[valid.length - 1];
            var change = first - last;
            trendChart.setOption({
                title: getReportChartTitle('总分年级排名趋势：' + first + ' → ' + last + (change > 0 ? '，进步' + change + '名' : (change < 0 ? '，退步' + Math.abs(change) + '名' : '，持平'))),
                tooltip: { trigger: 'axis' },
                grid: getReportChartGrid(42, 28, 54, 42),
                xAxis: getReportCategoryAxis(trend.labels, trend.labels.length > 4 ? 25 : 0),
                yAxis: Object.assign(getReportValueAxis('年级名次'), { minInterval: 1, scale: true, axisLabel: { color: REPORT_CHART_THEME.axis, fontSize: 11, formatter: function(v) { return Number.isInteger(v) ? v : ''; } } }),
                series: [{ type: 'line', data: trend.values, smooth: false, symbol: 'circle', symbolSize: 8, color: REPORT_CHART_THEME.blue, lineStyle: { width: 3 }, areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(78,121,167,.22)'},{offset:1,color:'rgba(78,121,167,0)'}]) }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700 } }]
            });
        } else {
            trendChart.setOption({ title: { text: '总分年级排名趋势：暂无多批次数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } });
        }
    }

    var radarEl = document.getElementById('studentReportRadarChart');
    if (radarEl) {
        var radarChart = AppCore.charts.init(radarEl, null, { renderer: 'svg' });
        if (usable.length) {
            radarChart.setOption({
                title: getReportChartTitle('各科得分率雷达：优势结构一眼可见'),
                tooltip: { trigger: 'item' },
                radar: { indicator: usable.map(function(s) { return { name: s.name, max: 100 }; }), radius: '62%', center: ['50%','55%'], splitNumber: 5, axisName: { color: '#334155', fontSize: 11 }, splitLine: { lineStyle: { color: '#cbd5e1' } }, splitArea: { areaStyle: { color: ['rgba(239,68,68,.05)','rgba(245,158,11,.05)','rgba(34,197,94,.05)'] } } },
                series: [{ type: 'radar', data: [{ value: usable.map(function(s) { return s.rate; }), name: '得分率' }], areaStyle: { color: 'rgba(78,121,167,.20)' }, lineStyle: { color: REPORT_CHART_THEME.blue, width: 3 }, itemStyle: { color: REPORT_CHART_THEME.blue }, label: { show: true, color: REPORT_CHART_THEME.text, fontSize: 11, formatter: function(p) { return p.value + '%'; } } }]
            });
        } else {
            radarChart.setOption({ title: { text: '各科得分率雷达：暂无满分参考数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } });
        }
    }

    var rankEl = document.getElementById('studentReportRankCompareChart');
    if (rankEl) {
        var rankChart = AppCore.charts.init(rankEl, null, { renderer: 'svg' });
        var rankRows = getSubjectRankCompareForReport(studentKey, subjects).slice(0, 10);
        if (rankRows.length) {
            var rankPrevColor = '#64748b';
            var rankCurColor = '#1e3a5f';
            rankChart.setOption({
                title: getReportChartTitle('各科年级排名前后对比：看清推动项与预警项'),
                tooltip: {
                    trigger: 'item',
                    backgroundColor: 'rgba(15,23,42,.92)',
                    borderWidth: 0,
                    textStyle: { color: '#fff', fontSize: 12 },
                    formatter: function(p) {
                        if (!p || !p.data) return '';
                        var d = p.data;
                        var prev = d.prev != null ? d.prev : (Array.isArray(d) ? d[1] : null);
                        var cur = d.cur != null ? d.cur : (Array.isArray(d) ? d[2] : null);
                        var name = d.name || (d.value && d.value[0]) || p.name;
                        if (prev == null || cur == null) return '';
                        var ch = prev - cur;
                        var tag = ch > 0 ? '进步 ' + ch + '名' : (ch < 0 ? '退步 ' + Math.abs(ch) + '名' : '持平');
                        return escapeHtml(String(name)) + '<br>上次：第' + prev + '名<br>本次：第' + cur + '名<br>' + tag;
                    }
                },
                legend: { top: 28, data: ['上次', '本次'], textStyle: { color: REPORT_CHART_THEME.axis, fontSize: 11 } },
                grid: getReportChartGrid(56, 36, 72, 40),
                xAxis: getReportCategoryAxis(rankRows.map(function(r) { return r.name; })),
                yAxis: Object.assign(getReportValueAxis('年级名次'), { minInterval: 1, scale: true, inverse: true, nameLocation: 'middle', nameGap: 42 }),
                series: [
                    {
                        name: '变化',
                        type: 'custom',
                        renderItem: function(params, api) {
                            var cat = api.value(0);
                            var prev = api.value(1);
                            var cur = api.value(2);
                            var p1 = api.coord([cat, prev]);
                            var p2 = api.coord([cat, cur]);
                            if (!p1 || !p2) return;
                            var ch = prev - cur;
                            var color = ch > 0 ? REPORT_CHART_THEME.green : (ch < 0 ? REPORT_CHART_THEME.red : REPORT_CHART_THEME.gray);
                            return {
                                type: 'line',
                                shape: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] },
                                style: { stroke: color, lineWidth: 3, fill: 'none', lineCap: 'round' },
                                silent: true,
                                z2: 1
                            };
                        },
                        data: rankRows.map(function(r) { return [r.name, r.prev, r.cur]; }),
                        encode: { x: 0, y: [1, 2] },
                        tooltip: { show: false },
                        legendHoverLink: false,
                        silent: true,
                        z: 1
                    },
                    {
                        name: '上次',
                        type: 'scatter',
                        data: rankRows.map(function(r) { return { name: r.name, value: [r.name, r.prev], prev: r.prev, cur: r.cur, change: r.change }; }),
                        symbol: 'circle',
                        symbolSize: 12,
                        itemStyle: { color: '#fff', borderColor: rankPrevColor, borderWidth: 2 },
                        z: 3
                    },
                    {
                        name: '本次',
                        type: 'scatter',
                        data: rankRows.map(function(r) {
                            return {
                                name: r.name,
                                value: [r.name, r.cur],
                                prev: r.prev,
                                cur: r.cur,
                                change: r.change,
                                label: { position: r.change >= 0 ? 'top' : 'bottom' }
                            };
                        }),
                        symbol: 'circle',
                        symbolSize: 13,
                        itemStyle: { color: rankCurColor, borderColor: rankCurColor, borderWidth: 1 },
                        label: {
                            show: true,
                            color: REPORT_CHART_THEME.text,
                            fontSize: 11,
                            fontWeight: 700,
                            formatter: function(p) {
                                var ch = p.data && p.data.change;
                                var tag = ch > 0 ? '↑' + ch : (ch < 0 ? '↓' + Math.abs(ch) : '→0');
                                return p.data.cur + '\n' + tag;
                            }
                        },
                        z: 4
                    }
                ]
            });
        } else {
            rankChart.setOption({ title: { text: '各科年级排名前后对比：暂无多批次数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } });
        }
    }

    var weakEl = document.getElementById('studentReportWeakCompareChart');
    if (weakEl) {
        var weakChart = AppCore.charts.init(weakEl, null, { renderer: 'svg' });
        var topWeak = weakItems.slice(0, 10);
        if (topWeak.length) {
            weakChart.setOption({
                title: getReportChartTitle('薄弱小题对比：区分个体短板与共性难题'),
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(params) { return params.map(function(p) { return p.seriesName + '：' + p.value + '%'; }).join('<br>'); } },
                legend: { top: 28, textStyle: { color: REPORT_CHART_THEME.axis, fontSize: 11 } },
                grid: getReportChartGrid(52, 28, 66, 70),
                xAxis: getReportCategoryAxis(topWeak.map(function(w) { return w.subject + '-' + w.item; }), 25),
                yAxis: Object.assign(getReportValueAxis('得分率', 100), { axisLabel: { color: REPORT_CHART_THEME.axis, fontSize: 11, formatter: '{value}%' } }),
                series: [
                    { name: '个人', type: 'bar', data: topWeak.map(function(w){ return Math.round(w.rate * 100); }), color: REPORT_CHART_THEME.blue, barMaxWidth: 24, itemStyle: { borderRadius: [7,7,0,0] }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700, formatter: '{c}%' } },
                    { name: '全体', type: 'bar', data: topWeak.map(function(w){ return w.classRate == null ? null : Math.round(w.classRate * 100); }), color: REPORT_CHART_THEME.gray, barMaxWidth: 24, itemStyle: { borderRadius: [7,7,0,0] }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.axis, fontSize: 11, formatter: function(p) { return p.value == null ? '-' : p.value + '%'; } } }
                ]
            });
        } else {
            weakChart.setOption({ title: { text: '薄弱小题对比：暂无低于阈值的小题', left: 'center', textStyle: { fontSize: 13, color: '#16a34a' } } });
        }
    }
}

function hideStudentReadableReport() {
    var el = document.getElementById('studentReadableReportOutput');
    if (el) el.style.display = 'none';
}

function hideComprehensiveReadableReport() {
    var el = document.getElementById('comprehensiveReadableReportOutput');
    if (el) el.style.display = 'none';
}

function getComprehensiveModeTitle(mode) {
    if (mode === 'batch') return '班级学情图文报告';
    if (mode === 'grouping') return '分层教学图文报告';
    if (mode === 'subj') return '单科教研图文报告';
    if (mode === 'seating') return '座位优化图文报告';
    return '综合诊断图文报告';
}

function getComprehensivePrintContext(mode) {
    if (mode === 'batch') return (document.getElementById('comprehensiveClassFilter')?.value || '') + '班';
    if (mode === 'grouping') return (document.getElementById('comprehensiveClassFilter')?.value || '') + '班';
    if (mode === 'seating') return (document.getElementById('comprehensiveClassFilter')?.value || '') + '班';
    if (mode === 'subj') {
        var subject = document.getElementById('comprehensiveSubjFilter')?.value || '';
        var chips = document.getElementById('comprehensiveSubjClassChips');
        var classes = chips ? Array.from(chips.querySelectorAll('.subj-class-chip.active')).map(function(chip) { return chip.dataset.value === '__all__' ? '全部班级' : chip.dataset.value; }).slice(0, 3).join('、') : '';
        return [subject, classes].filter(Boolean).join('_');
    }
    return '';
}

function renderMarkdownForReadableReport(markdownText) {
    var text = String(markdownText || '');
    if (window.marked && typeof window.marked.parse === 'function') {
        return window.marked.parse(text);
    }
    if (typeof window.marked === 'function') return window.marked(text);
    return '<pre>' + escapeHtml(text) + '</pre>';
}

function renderComprehensiveReadableReport() {
    var ta = document.getElementById('comprehensiveDataContent');
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!ta || !output || !content || !ta.textContent.trim()) return false;
    var mode = ta.dataset.mode || 'single';
    var title = getComprehensiveModeTitle(mode);
    var context = getComprehensivePrintContext(mode);
    output.dataset.backTarget = 'comprehensiveOutput';
    var batch = DataPool.getCurrentBatch ? DataPool.getCurrentBatch() : null;
    output.dataset.printTitle = [context, title, (batch ? batch.label : '当前批次'), getTodayString()].filter(Boolean).join('_');
    var bodyHtml = renderMarkdownForReadableReport(ta.textContent);
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>' + escapeHtml(title) + '</h2><p>由当前综合诊断数据包渲染生成，用于校内研判、教研沟通与打印归档。</p></div>');
    html.push('<div class="cr-meta"><div><b>报告类型：</b>' + escapeHtml(title) + '</div><div><b>批次：</b>' + escapeHtml(batch ? batch.label : '当前批次') + '</div><div><b>生成时间：</b>' + new Date().toLocaleString() + '</div></div></div>');
    html.push('<div class="cr-body">' + bodyHtml + '</div>');
    html.push('</div>');
    content.innerHTML = html.join('');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    return true;
}

function renderDomOutputReadableReport(title, sourceEl) {
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content || !sourceEl) return false;
    var sourceHtml = sourceEl.innerHTML || '';
    if (!sourceHtml.trim()) return false;
    var batch = DataPool.getCurrentBatch ? DataPool.getCurrentBatch() : null;
    var backTarget = sourceEl && sourceEl.dataset ? sourceEl.dataset.backTarget : '';
    var printContext = sourceEl && sourceEl.dataset ? sourceEl.dataset.printContext : '';
    output.dataset.backTarget = backTarget || '';
    output.dataset.printTitle = [printContext, title, (batch ? batch.label : '当前批次'), getTodayString()].filter(Boolean).join('_');
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>' + escapeHtml(title) + '</h2><p>由当前页面结果生成，用于打印、另存为 PDF 或归档。</p></div>');
    html.push('<div class="cr-meta"><div><b>报告类型：</b>' + escapeHtml(title) + '</div><div><b>批次：</b>' + escapeHtml(batch ? batch.label : '当前批次') + '</div><div><b>生成时间：</b>' + new Date().toLocaleString() + '</div></div></div>');
    html.push('<div class="cr-body">' + sourceHtml + '</div>');
    html.push('</div>');
    content.innerHTML = html.join('');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    return true;
}

function getClassReportRank(stu, subjectName) {
    var sd = stu && stu.subjects ? stu.subjects[subjectName] : null;
    if (!sd) return null;
    var r = parseInt(sd.gradeRank, 10) || parseInt(sd.schoolRank, 10) || null;
    return r && r > 0 ? r : null;
}

function getClassReportCompareBatch(compareBatchId) {
    if (!compareBatchId) return null;
    return DataPool.batches.find(function(b) {
        return b.id === compareBatchId && b.id !== DataPool.currentBatchId;
    }) || null;
}

function getClassAverageRankSnapshot(data, subjectName, className) {
    if (!data || !data.length || !subjectName) return null;
    var classMap = {};
    data.forEach(function(stu) {
        var sd = getSubjectDataByAlias(stu, subjectName);
        var score = sd ? parseFloat(sd.score) : NaN;
        if (isNaN(score)) return;
        var key = normalizeClassName(stu.class || '');
        if (!classMap[key]) classMap[key] = [];
        classMap[key].push(score);
    });
    var rows = Object.keys(classMap).map(function(key) {
        var vals = classMap[key];
        return {
            className: key,
            avg: vals.reduce(function(a, b) { return a + b; }, 0) / vals.length
        };
    }).sort(function(a, b) {
        if (Math.abs(b.avg - a.avg) > 1e-9) return b.avg - a.avg;
        return a.className.localeCompare(b.className);
    });
    var prevAvg = null;
    var currentRank = 0;
    rows.forEach(function(row, idx) {
        if (prevAvg === null || Math.abs(row.avg - prevAvg) > 1e-9) currentRank = idx + 1;
        row.rank = currentRank;
        prevAvg = row.avg;
    });
    var target = normalizeClassName(className || '');
    return rows.find(function(row) { return row.className === target; }) || null;
}

function getClassSubjectRankRowsForReport(className, compareBatch) {
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    var subjectNames = [];
    if (totalName && subjectHasScoreData(combinedStudentData, totalName)) subjectNames.push(totalName);
    getScoredSubjectNames(combinedStudentData, allSubjectHeaders).forEach(function(name) {
        if (!name || name === totalName) return;
        if (subjectNames.indexOf(name) < 0) subjectNames.push(name);
    });
    return subjectNames.map(function(subjectName) {
        var current = getClassAverageRankSnapshot(combinedStudentData, subjectName, className);
        var previous = compareBatch ? getClassAverageRankSnapshot(compareBatch.combinedStudentData || [], subjectName, className) : null;
        if (!current && !previous) return null;
        var change = current && previous && current.rank && previous.rank ? previous.rank - current.rank : null;
        return {
            subject: subjectName,
            currentAvg: current ? current.avg : null,
            currentRank: current ? current.rank : null,
            compareAvg: previous ? previous.avg : null,
            compareRank: previous ? previous.rank : null,
            rankChange: change
        };
    }).filter(function(row) { return row !== null; });
}

function formatClassRankChange(change) {
    if (change == null) return { text: '—', color: '#64748b' };
    if (change > 0) return { text: '↑' + change + '名', color: '#15803d' };
    if (change < 0) return { text: '↓' + Math.abs(change) + '名', color: '#b91c1c' };
    return { text: '持平', color: '#475569' };
}

function renderClassTotalGradeFlowTable(students, totalName, compareBatch) {
    if (!compareBatch || !compareBatch.combinedStudentData) return '';
    var compareTotalName = getTotalSubjectName(compareBatch.allSubjectHeaders || [], compareBatch.combinedStudentData || []) || totalName;
    var compareMap = {};
    compareBatch.combinedStudentData.forEach(function(s) {
        compareMap[String(s.name || '').trim() + '||' + normalizeClassName(s.class || '')] = s;
    });
    var validGrades = ['A+','A','B+','B','C+','C'];
    var gradeLevel = { 'C': 0, 'C+': 1, 'B': 2, 'B+': 3, 'A': 4, 'A+': 5 };
    var flowMap = {};
    var missingNames = [];
    var matchedCount = 0;

    (students || []).forEach(function(s) {
        var key = String(s.name || '').trim() + '||' + normalizeClassName(s.class || '');
        var ps = compareMap[key];
        if (!ps) return;
        matchedCount++;
        var curSd = getSubjectDataByAlias(s, totalName);
        var prevSd = getSubjectDataByAlias(ps, compareTotalName);
        var curGrade = curSd && curSd.grade ? String(curSd.grade).trim().toUpperCase() : '';
        var prevGrade = prevSd && prevSd.grade ? String(prevSd.grade).trim().toUpperCase() : '';
        if (validGrades.indexOf(curGrade) < 0 || validGrades.indexOf(prevGrade) < 0) {
            missingNames.push(getStudentDisplayName(s));
            return;
        }
        var flowKey = prevGrade + '→' + curGrade;
        if (!flowMap[flowKey]) {
            flowMap[flowKey] = {
                from: prevGrade,
                to: curGrade,
                count: 0,
                names: [],
                delta: gradeLevel[curGrade] - gradeLevel[prevGrade]
            };
        }
        flowMap[flowKey].count++;
        flowMap[flowKey].names.push(getStudentDisplayName(s));
    });

    if (!matchedCount) {
        return '<div class="sr-note-box" style="margin-top:12px;">两个批次之间没有可匹配的本班学生，无法生成总分等级流转表。</div>';
    }

    var rows = Object.keys(flowMap).map(function(k) { return flowMap[k]; });
    rows.sort(function(a, b) {
        var ai = validGrades.indexOf(a.from), bi = validGrades.indexOf(b.from);
        if (ai !== bi) return ai - bi;
        var aj = validGrades.indexOf(a.to), bj = validGrades.indexOf(b.to);
        return aj - bj;
    });

    if (!rows.length) {
        return '<div class="sr-note-box" style="margin-top:12px;">已匹配 ' + matchedCount + ' 人，但两个批次缺少可对应的 A+/A/B+/B/C+/C 总分等级数据。</div>';
    }

    var currentBatch = DataPool.getCurrentBatch ? DataPool.getCurrentBatch() : null;
    var html = '<div style="margin-top:14px;"><div class="sr-card-heading"><h4>总分等级流转</h4><span style="font-size:12px;color:#64748b;">' + escapeHtml(compareBatch.label || '对照批次') + ' → ' + escapeHtml(currentBatch ? currentBatch.label : '本次') + '</span></div>';
    html += '<table class="sr-table"><thead><tr><th>对照等级</th><th>本次等级</th><th>流转</th><th>人数</th><th>学生姓名</th></tr></thead><tbody>';
    rows.forEach(function(r) {
        var status = '稳定';
        var pillStyle = 'background:#f1f5f9;color:#475569;border-color:#cbd5e1;';
        if (r.delta > 0) {
            status = '升级';
            pillStyle = 'background:#dcfce7;color:#166534;border-color:#86efac;';
        } else if (r.delta < 0) {
            status = '降级';
            pillStyle = 'background:#ffe4e6;color:#be123c;border-color:#fda4af;';
        }
        html += '<tr><td style="font-weight:800;">' + r.from + '</td><td style="font-weight:800;">' + r.to + '</td><td><span class="sr-pill" style="' + pillStyle + '">' + status + '</span></td><td>' + r.count + '</td><td>' + escapeHtml(r.names.join('、')) + '</td></tr>';
    });
    if (missingNames.length) {
        html += '<tr><td colspan="2">等级缺失/无法识别</td><td><span class="sr-pill" style="background:#fff7ed;color:#9a3412;border-color:#fdba74;">待核对</span></td><td>' + missingNames.length + '</td><td>' + escapeHtml(missingNames.join('、')) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
}

function renderClassReadableReport(className, compareBatchId) {
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content) return false;
    var students = combinedStudentData.filter(function(s) { return String(s.class) === String(className); });
    if (!students.length) return false;
    var totalName = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    if (!totalName) return false;
    var batch = DataPool.getCurrentBatch ? DataPool.getCurrentBatch() : null;
    var compareBatch = getClassReportCompareBatch(compareBatchId);
    var hasCompare = !!compareBatch;
    var scores = students.map(function(s) {
        var sd = s.subjects[totalName];
        var score = sd ? parseFloat(sd.score) : NaN;
        var rank = getClassReportRank(s, totalName);
        var grade = sd && sd.grade ? String(sd.grade).trim().toUpperCase() : '';
        return { name: getStudentDisplayName(s), rawName: s.name, className: s.class, score: isNaN(score) ? null : score, rank: rank, grade: grade };
    }).filter(function(s) { return s.score != null || s.rank != null || s.grade; });
    var validScores = scores.filter(function(s) { return s.score != null; }).map(function(s) { return s.score; });
    var avgScore = validScores.length ? validScores.reduce(function(a,b){return a+b;},0) / validScores.length : null;
    var topStudents = scores.filter(function(s) { return s.rank != null; }).sort(function(a,b){ return a.rank - b.rank; }).slice(0, 10);
    var progressRows = hasCompare ? getClassProgressRowsForReport(students, compareBatch, totalName) : [];
    var improvers = progressRows.filter(function(r) { return r.change > 0; }).sort(function(a,b){ return b.change - a.change; }).slice(0, 10);
    var decliners = progressRows.filter(function(r) { return r.change < 0; }).sort(function(a,b){ return a.change - b.change; }).slice(0, 10);
    var subjectRankRows = getClassSubjectRankRowsForReport(className, compareBatch);
    var title = className + '班 班级学情图文报告';
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>' + escapeHtml(title) + '</h2><p>' + (hasCompare ? '按“对照 → 本次”的方向，对比班级结构、总分与各科均分排名，并追踪学生年级名次进退步。' : '以班级结构、总分与各科均分排名为主线，快速判断班级当前状态。') + '</p></div>');
    html.push('<div class="cr-meta"><div><b>班级：</b>' + escapeHtml(className) + '</div>' + (hasCompare ? '<div><b>对照：</b>' + escapeHtml(compareBatch.label) + '</div>' : '') + '<div><b>本次：</b>' + escapeHtml(batch ? batch.label : '当前批次') + '</div><div><b>生成时间：</b>' + new Date().toLocaleString() + '</div></div></div>');
    html.push('<div class="sr-kpis">');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">学生人数</div><div class="sr-kpi-value">' + students.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">总分均分</div><div class="sr-kpi-value">' + (avgScore == null ? '-' : avgScore.toFixed(1)) + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">年级前10</div><div class="sr-kpi-value">' + scores.filter(function(s){ return s.rank != null && s.rank <= 10; }).length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">' + (hasCompare ? '可对照人数' : '均分排名项目') + '</div><div class="sr-kpi-value">' + (hasCompare ? progressRows.length : subjectRankRows.filter(function(r){ return r.currentRank != null; }).length) + '</div></div>');
    html.push('</div>');
    html.push('<div class="sr-section"><h3>一、班级结构与分布</h3><div class="sr-grid">');
    html.push('<div id="classReportTierChart" class="sr-chart sr-chart-large"></div>');
    html.push('<div id="classReportDistChart" class="sr-chart sr-chart-large"></div>');
    html.push('</div>');
    if (hasCompare) html.push(renderClassTotalGradeFlowTable(students, totalName, compareBatch));
    html.push('</div>');

    html.push('<div class="sr-section"><h3>二、总分/各科均分排名' + (hasCompare ? '变化' : '') + '</h3>');
    if (subjectRankRows.length) {
        if (hasCompare) {
            html.push('<table class="sr-table"><thead><tr><th>科目</th><th>本次均分</th><th>本次均分排名</th><th>对照均分</th><th>对照均分排名</th><th>排名变化</th></tr></thead><tbody>');
            subjectRankRows.forEach(function(row) {
                var ch = formatClassRankChange(row.rankChange);
                html.push('<tr><td>' + escapeHtml(row.subject) + '</td><td>' + (row.currentAvg == null ? '—' : row.currentAvg.toFixed(1)) + '</td><td>' + (row.currentRank == null ? '—' : '第' + row.currentRank + '名') + '</td><td>' + (row.compareAvg == null ? '—' : row.compareAvg.toFixed(1)) + '</td><td>' + (row.compareRank == null ? '—' : '第' + row.compareRank + '名') + '</td><td style="font-weight:800;color:' + ch.color + ';">' + ch.text + '</td></tr>');
            });
        } else {
            html.push('<table class="sr-table"><thead><tr><th>科目</th><th>本次均分</th><th>本次均分排名</th></tr></thead><tbody>');
            subjectRankRows.forEach(function(row) {
                html.push('<tr><td>' + escapeHtml(row.subject) + '</td><td>' + (row.currentAvg == null ? '—' : row.currentAvg.toFixed(1)) + '</td><td>' + (row.currentRank == null ? '—' : '第' + row.currentRank + '名') + '</td></tr>');
            });
        }
        html.push('</tbody></table>');
    } else {
        html.push('<div class="no-data">暂无可计算的班级均分排名数据</div>');
    }
    html.push('</div>');

    if (hasCompare) {
        html.push('<div class="sr-section"><h3>三、学生年级名次变化 Top10</h3><div class="sr-grid">');
        html.push('<div id="classReportImproveChart" class="sr-chart sr-chart-large"></div>');
        html.push('<div id="classReportDeclineChart" class="sr-chart sr-chart-large"></div>');
        html.push('</div></div>');
        html.push('<div class="sr-section"><h3>四、重点学生速览</h3>');
        html.push('<table class="sr-table"><thead><tr><th class="sr-overview-top">本班年级排名前10</th><th class="sr-overview-top">本次名次</th><th class="sr-overview-improve sr-overview-start">进步Top10</th><th class="sr-overview-improve">进步名次</th><th class="sr-overview-decline sr-overview-start">退步Top10</th><th class="sr-overview-decline">退步名次</th></tr></thead><tbody>');
        var maxRows = Math.max(topStudents.length, improvers.length, decliners.length, 1);
        for (var i = 0; i < maxRows; i++) {
            html.push('<tr><td>' + escapeHtml(topStudents[i] ? topStudents[i].name : '-') + '</td><td>' + escapeHtml(topStudents[i] ? String(topStudents[i].rank) : '-') + '</td><td class="sr-overview-start">' + escapeHtml(improvers[i] ? improvers[i].name : '-') + '</td><td style="color:#15803d;font-weight:700;">' + escapeHtml(improvers[i] ? '+' + improvers[i].change : '-') + '</td><td class="sr-overview-start">' + escapeHtml(decliners[i] ? decliners[i].name : '-') + '</td><td style="color:#b91c1c;font-weight:700;">' + escapeHtml(decliners[i] ? '-' + Math.abs(decliners[i].change) : '-') + '</td></tr>');
        }
        html.push('</tbody></table></div>');
    } else {
        html.push('<div class="sr-section"><h3>三、重点学生速览</h3>');
        html.push('<table class="sr-table"><thead><tr><th class="sr-overview-top">本班年级排名前10</th><th class="sr-overview-top">本次名次</th></tr></thead><tbody>');
        var currentRows = Math.max(topStudents.length, 1);
        for (var j = 0; j < currentRows; j++) {
            html.push('<tr><td>' + escapeHtml(topStudents[j] ? topStudents[j].name : '-') + '</td><td>' + escapeHtml(topStudents[j] ? String(topStudents[j].rank) : '-') + '</td></tr>');
        }
        html.push('</tbody></table></div>');
    }
    html.push('</div>');
    content.innerHTML = html.join('');
    output.dataset.backTarget = 'comprehensiveOutput';
    output.dataset.printTitle = [className + '班', '班级学情图文报告', (batch ? batch.label : '当前批次') + (hasCompare ? '_对比_' + compareBatch.label : ''), getTodayString()].join('_');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderClassReadableCharts(scores, students, progressRows, totalName, hasCompare);
    return true;
}

function getClassProgressRowsForReport(students, compareBatch, totalName) {
    if (!compareBatch || !compareBatch.combinedStudentData) return [];
    var compareTotalName = getTotalSubjectName(compareBatch.allSubjectHeaders || [], compareBatch.combinedStudentData || []) || totalName;
    var compareMap = {};
    compareBatch.combinedStudentData.forEach(function(s) { compareMap[String(s.name || '').trim() + '||' + normalizeClassName(s.class || '')] = s; });
    var rows = [];
    students.forEach(function(s) {
        var key = String(s.name || '').trim() + '||' + normalizeClassName(s.class || '');
        var ps = compareMap[key];
        if (!ps) return;
        var compareRank = getClassReportRank(ps, compareTotalName);
        var curRank = getClassReportRank(s, totalName);
        if (!compareRank || !curRank) return;
        rows.push({ name: getStudentDisplayName(s), compareRank: compareRank, curRank: curRank, change: compareRank - curRank });
    });
    return rows;
}

function renderClassReadableCharts(scores, students, progressRows, totalName, hasCompare) {
    if (typeof echarts === 'undefined') return;
    renderClassTierChart(scores, students, totalName);
    renderClassScoreDistributionChart(scores, getClassReportTotalFullMark(totalName));
    if (!hasCompare) return;
    renderClassProgressBarChart('classReportImproveChart', '年级名次进步 Top10', progressRows.filter(function(r){ return r.change > 0; }).sort(function(a,b){ return b.change - a.change; }).slice(0, 10), REPORT_CHART_THEME.green);
    renderClassProgressBarChart('classReportDeclineChart', '年级名次退步 Top10', progressRows.filter(function(r){ return r.change < 0; }).sort(function(a,b){ return a.change - b.change; }).slice(0, 10).map(function(r){ return { name: r.name, change: Math.abs(r.change) }; }), REPORT_CHART_THEME.red);
}

function renderClassTierChart(scores, students, totalName) {
    var el = document.getElementById('classReportTierChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var gradeOrder = ['A+','A','B+','B','C+','C'];
    var gradeCounts = {};
    scores.forEach(function(s) { if (gradeOrder.indexOf(s.grade) >= 0) gradeCounts[s.grade] = (gradeCounts[s.grade] || 0) + 1; });
    var data = gradeOrder.filter(function(g){ return gradeCounts[g]; }).map(function(g){ return { name: g, value: gradeCounts[g] }; });
    var title = '总分等级结构';
    var isTierFallback = false;
    var totalPop = combinedStudentData.length || students.length;
    if (!data.length) {
        isTierFallback = true;
        var tiers = { '领先': 0, '中上': 0, '临界': 0, '后进': 0 };
        students.forEach(function(s) {
            var tier = getReportTierByRank(getClassReportRank(s, totalName), totalPop);
            if (tiers[tier] != null) tiers[tier]++;
        });
        data = Object.keys(tiers).filter(function(k){ return tiers[k]; }).map(function(k){ return { name: k, value: tiers[k] }; });
        title = '总分分层结构';
    }
    chart.setOption(getReportPieOption(title, data, [REPORT_CHART_THEME.green, REPORT_CHART_THEME.mint, REPORT_CHART_THEME.blue, REPORT_CHART_THEME.orange, REPORT_CHART_THEME.deepOrange, REPORT_CHART_THEME.red]));
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || !params.name) return;
        var key = params.name;
        var matched;
        if (isTierFallback) {
            matched = students.filter(function(s) {
                var tier = getReportTierByRank(getClassReportRank(s, totalName), totalPop);
                return tier === key;
            });
        } else {
            matched = scores.filter(function(s) { return s.grade === key; });
        }
        if (!matched.length) return;
        var titleText = '总分 ' + key + ' 共' + matched.length + '人';
        var names = matched.map(function(s, i) {
            return (i+1) + '. ' + (s.class || '') + ' ' + escapeHtml(s.name);
        }).join('<br>');
        showStudentListModal(titleText, names);
    });
}

function getClassReportTotalFullMark(totalName) {
    var fullMarks = expandSubjectFullMarks(getSubjectFullMarksFromInputs(), combinedStudentData);
    var subjectNames = getScoredSubjectNames(combinedStudentData, allSubjectHeaders);
    // 与得分率热力图共用英语固定100、生物地理和物化合并列不计的总满分规则。
    var totalFullMark = calculateTotalExamFullMark(subjectNames, fullMarks, totalName);
    if (totalFullMark <= 0) return null;
    var totalScores = (combinedStudentData || []).map(function(student) {
        var data = student && student.subjects ? student.subjects[totalName] : null;
        return data ? parseFloat(data.score) : NaN;
    }).filter(function(score) { return !isNaN(score) && score >= 0; });
    if (totalScores.length && Math.max.apply(null, totalScores) > totalFullMark + 0.01) return null;
    return totalFullMark;
}

function calculateClassScoreRateDistribution(scoreValues, totalFullMark) {
    totalFullMark = parseFloat(totalFullMark);
    if (isNaN(totalFullMark) || totalFullMark <= 0) return null;
    var rates = (scoreValues || []).map(function(value) { return parseFloat(value); }).filter(function(score) {
        return !isNaN(score) && score >= 0 && score <= totalFullMark;
    }).map(function(score) { return score / totalFullMark * 100; }).sort(function(a, b) { return a - b; });
    if (!rates.length) return null;
    var bins = [];
    for (var i = 0; i < 10; i++) {
        bins.push({ label: i === 9 ? '90%-100%' : (i * 10) + '%-' + (i * 10 + 9) + '%', minRate: i * 10, maxRate: i === 9 ? 100 : (i + 1) * 10, count: 0 });
    }
    rates.forEach(function(rate) { bins[Math.min(9, Math.floor(rate / 10))].count++; });
    function quantile(p) {
        var position = (rates.length - 1) * p;
        var lower = Math.floor(position);
        var upper = Math.ceil(position);
        if (lower === upper) return rates[lower];
        return rates[lower] + (rates[upper] - rates[lower]) * (position - lower);
    }
    function rounded(value) { return Math.round(value * 10) / 10; }
    var q1 = rounded(quantile(0.25));
    var median = rounded(quantile(0.5));
    var q3 = rounded(quantile(0.75));
    var medianBinLabel = bins[Math.min(9, Math.floor(median / 10))].label;
    var peakCount = Math.max.apply(null, bins.map(function(bin) { return bin.count; }));
    var peakBins = bins.filter(function(bin) { return bin.count === peakCount && peakCount > 0; });
    var summaryText = '中位数：' + median + '%（位于' + medianBinLabel + '）';
    return { bins: bins, rates: rates, validCount: rates.length, q1: q1, median: median, q3: q3, medianBinLabel: medianBinLabel, peakBins: peakBins, peakCount: peakCount, summaryText: summaryText };
}

function renderClassScoreDistributionChart(scores, totalFullMark) {
    var el = document.getElementById('classReportDistChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var vals = scores.filter(function(s){ return s.score != null; }).map(function(s){ return s.score; });
    if (!vals.length) { chart.setOption({ title: { text: '总分分布：暂无分数数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    var distribution = calculateClassScoreRateDistribution(vals, totalFullMark);
    if (!distribution) { chart.setOption({ title: { text: '总分得分率分布：请先完整配置本次考试各科满分', left: 'center', textStyle: { fontSize: 13, color: '#b45309' } } }); return; }
    var bins = distribution.bins;
    var chartTitle = getReportChartTitle('总分得分率分布：看集中度与尾部风险');
    chartTitle.subtext = distribution.summaryText;
    chartTitle.itemGap = 7;
    chartTitle.subtextStyle = { color: REPORT_CHART_THEME.axis, fontSize: 11, lineHeight: 18, fontWeight: 400 };
    chart.setOption({ title: chartTitle, tooltip: getReportTooltip(), grid: getReportChartGrid(42, 28, 98, 48), xAxis: getReportCategoryAxis(bins.map(function(b){ return b.label; }), 25), yAxis: getReportValueAxis('人数'), series: [{ type: 'bar', data: bins.map(function(b, index){ return { value: b.count, itemStyle: { color: index < 5 ? REPORT_CHART_THEME.red : (distribution.peakBins.indexOf(b) >= 0 ? REPORT_CHART_THEME.blue : REPORT_CHART_THEME.cyan) } }; }), barMaxWidth: 34, itemStyle: { borderRadius: [7,7,0,0] }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700, formatter: function(params) { return params.value > 0 ? params.value : ''; } } }] });
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || params.dataIndex == null) return;
        var binIndex = params.dataIndex;
        var label = bins[binIndex] ? bins[binIndex].label : '';
        var matched = scores.filter(function(s) {
            var score = parseFloat(s.score);
            if (isNaN(score) || score < 0 || score > totalFullMark) return false;
            var rate = score / totalFullMark * 100;
            return Math.min(9, Math.floor(rate / 10)) === binIndex;
        });
        if (!matched.length) return;
        var titleText = '总分得分率 ' + label + ' 共' + matched.length + '人';
        var names = matched.map(function(s, i) {
            return (i+1) + '. ' + (s.className || '') + ' ' + escapeHtml(s.name) + ' (' + s.score + '分)';
        }).join('<br>');
        showStudentListModal(titleText, names);
    });
}

function renderClassProgressBarChart(elId, title, rows, color) {
    var el = document.getElementById(elId);
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    if (!rows.length) { chart.setOption({ title: { text: title + '：暂无可对比数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    var ordered = rows.slice().reverse();
    setReportHorizontalBarOption(chart, { title: title, xName: '名次变化', names: ordered.map(function(r){ return r.name; }), values: ordered.map(function(r){ return Math.abs(r.change); }), color: color, right: 48 });
    chart.setOption({ series: [{ label: { formatter: '{c}名' } }] });
}

var REPORT_CHART_THEME = {
    title: '#123a63', text: '#1f2937', subText: '#64748b', axis: '#475569', split: '#e5e7eb', border: '#e2e8f0',
    blue: '#4e79a7', green: '#59a14f', red: '#e15759', orange: '#f28e2b', amber: '#edc948', purple: '#b07aa1',
    gray: '#94a3b8', cyan: '#76b7b2', slate: '#89b8b7',
    teal: '#037c80', mint: '#00c8b0', coral: '#ea5043', apricot: '#e89d79', deepOrange: '#fe891a',
    progressNormal: '#0081a1', progressAbnormal: '#cc1f23'
};

var SMART_CHART_PALETTE = [
    '#4e79a7','#f28e2b','#e15759','#037c80','#59a14f','#edc948',
    '#b07aa1','#ff9da7','#00c8b0','#9c755f','#89b8b7','#8cd17d',
    '#499894','#fe891a','#e89d79','#76b7b2','#bab0ac','#ea5043'
];
function getSmartChartColor(i) { return SMART_CHART_PALETTE[i % SMART_CHART_PALETTE.length]; }
function getSmartChartPalette(count, offset) {
    var n = Math.max(0, count || 0);
    var start = offset || 0;
    var colors = [];
    for (var i = 0; i < n; i++) colors.push(getSmartChartColor(i + start));
    return colors;
}
function getSemanticChartColor(type) {
    var key = String(type || '');
    if (/进步|升级|优秀|领先|正确|正向/.test(key)) return REPORT_CHART_THEME.green;
    if (/退步|降级|严重|风险|错误|预警|高风险/.test(key)) return REPORT_CHART_THEME.red;
    if (/轻微|临界|注意|重点|警示/.test(key)) return REPORT_CHART_THEME.orange;
    if (/稳定|持平|均衡|中性|无对比/.test(key)) return REPORT_CHART_THEME.gray;
    return REPORT_CHART_THEME.blue;
}
function getGradeChartColors(labels) {
    var map = { 'A+': REPORT_CHART_THEME.green, 'A': REPORT_CHART_THEME.mint, 'B+': REPORT_CHART_THEME.blue, 'B': REPORT_CHART_THEME.orange, 'C+': REPORT_CHART_THEME.deepOrange, 'C': REPORT_CHART_THEME.red, '领先': REPORT_CHART_THEME.green, '中上': REPORT_CHART_THEME.blue, '临界': REPORT_CHART_THEME.orange, '后进': REPORT_CHART_THEME.red };
    return (labels || []).map(function(label, i) { return map[label] || getSmartChartColor(i); });
}
function getSubjectChartColor(subjectName, fallbackIndex) {
    var text = String(subjectName || '');
    var hash = 0;
    for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return getSmartChartColor(text ? hash : (fallbackIndex || 0));
}

function getChoiceAnswerColor(answerKey) {
    var map = {
        'A': '#3b6ea8', 'B': '#f59e0b', 'C': '#8b5cf6', 'D': '#14b8a6',
        'E': '#ec4899', 'F': '#a16207', 'G': '#64748b', 'H': '#ca8a04',
        '空白': '#cbd5e1'
    };
    return map[String(answerKey || '')] || '#94a3b8';
}

function getReportChartTitle(text) {
    return { text: text, left: 'center', top: 4, textStyle: { fontSize: 14, fontWeight: 800, color: REPORT_CHART_THEME.title, lineHeight: 18 } };
}

function getReportChartGrid(left, right, top, bottom) {
    return { left: left == null ? 76 : left, right: right == null ? 36 : right, top: top == null ? 54 : top, bottom: bottom == null ? 36 : bottom, containLabel: true };
}

function getReportAxisLabel(rotate) {
    return { color: REPORT_CHART_THEME.axis, fontSize: 11, rotate: rotate || 0 };
}

function getReportValueAxis(name, max) {
    var axis = { type: 'value', name: name || '', nameTextStyle: { color: REPORT_CHART_THEME.axis, fontWeight: 700 }, axisLabel: getReportAxisLabel(), splitLine: { lineStyle: { color: REPORT_CHART_THEME.split, type: 'dashed' } } };
    if (max != null) axis.max = max;
    return axis;
}

function getReportCategoryAxis(data, rotate) {
    return { type: 'category', data: data || [], axisLabel: getReportAxisLabel(rotate), axisLine: { lineStyle: { color: REPORT_CHART_THEME.border } }, axisTick: { show: false } };
}

function getReportTooltip() {
    return { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(15,23,42,.92)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } };
}

function getReportBarSeries(name, data, color) {
    return { name: name || '', type: 'bar', data: data || [], color: color || getSmartChartColor(0), barMaxWidth: 22, itemStyle: { borderRadius: [0, 7, 7, 0] }, label: { show: true, position: 'right', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700 } };
}

function setReportHorizontalBarOption(chart, cfg) {
    var xAxis = Object.assign(getReportValueAxis(cfg.xName || ''), { nameLocation: 'middle', nameGap: 28 });
    chart.setOption({ title: getReportChartTitle(cfg.title), tooltip: getReportTooltip(), grid: getReportChartGrid(cfg.left, cfg.right, cfg.top, cfg.bottom == null ? 54 : cfg.bottom), xAxis: xAxis, yAxis: getReportCategoryAxis(cfg.names || []), series: [getReportBarSeries(cfg.seriesName || '', cfg.values || [], cfg.color)] });
}

function getReportPieOption(title, data, colors) {
    return { color: colors || getSmartChartPalette(Math.max((data || []).length, 5)), title: getReportChartTitle(title), tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { color: REPORT_CHART_THEME.axis, fontSize: 11 } }, series: [{ type: 'pie', radius: ['44%', '68%'], center: ['50%', '52%'], data: data || [], label: { formatter: '{b}\n{c}人', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700 }, itemStyle: { borderColor: '#fff', borderWidth: 2 } }] };
}

function renderSubjectTeachingReadableReport(classNames, subjectName, compareBatchId, tierMode) {
    if (typeof classNames === 'string') classNames = [classNames];
    tierMode = tierMode === 'grade' ? 'grade' : 'rank';
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content || !subjectName || !classNames.length) return false;
    var students = combinedStudentData.filter(function(s) { return classNames.indexOf(String(s.class)) >= 0; }).filter(function(s) { return !!getSubjectDataByAlias(s, subjectName); });
    if (!students.length) return false;
    var batch = DataPool.getCurrentBatch ? DataPool.getCurrentBatch() : null;    var referenceBatch = compareBatchId ? DataPool.batches.find(function(b) { return b.id === compareBatchId; }) : null;

    var fullMarks = expandSubjectFullMarks(getSubjectFullMarksFromInputs());
    var fm = fullMarks[subjectName];
    if (fm == null && subjectName === '英语') fm = (fullMarks['英语笔试'] || 0) + (fullMarks['听说'] || 0);
    var subjectPop = combinedStudentData.filter(function(s) { var sd = getSubjectDataByAlias(s, subjectName); return sd && validateSubjectScore(sd); }).length || combinedStudentData.length || students.length;
    var rows = students.map(function(s) {
        var sd = getSubjectDataByAlias(s, subjectName) || {};
        var score = parseFloat(sd.score);
        var rank = parseInt(sd.gradeRank, 10) || parseInt(sd.schoolRank, 10) || null;
        var rate = (!isNaN(score) && fm != null && fm > 0) ? score / fm : null;
        var grade = sd.grade ? String(sd.grade).trim().toUpperCase() : '';
        var tier = tierMode === 'grade' ? getReportTierBySubjectGrade(grade) : getReportTierByRank(rank, subjectPop);
        if (tier === '—') tier = getReportTierByRank(rank, subjectPop);
        return { name: getStudentDisplayName(s), rawName: s.name, className: String(s.class), score: isNaN(score) ? null : score, rate: rate, grade: grade, rank: rank, tier: tier, subScores: sd.subScores || {} };
    });
    var validScores = rows.filter(function(r){ return r.score != null; });
    var avgScore = validScores.length ? validScores.reduce(function(a,b){ return a + b.score; }, 0) / validScores.length : null;
    var weakItems = getSubjectItemAverageRates(rows);
    var choiceItems = getSubjectChoiceDistribution(rows);
    var flow = getSubjectGradeFlowForReport(rows, subjectName, compareBatchId);
    var title = subjectName + ' 单科教研图文报告';
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>' + escapeHtml(title) + '</h2><p>从班级对比、分层结构、小题得分率和等级流转快速定位教学重点。</p></div>');
    html.push('<div class="cr-meta"><div><b>科目：</b>' + escapeHtml(subjectName) + '</div><div><b>班级：</b>' + escapeHtml(classNames.join('、')) + '</div><div><b>分层：</b>' + (tierMode === 'grade' ? '等级' : '排名') + '</div>' + (referenceBatch ? '<div><b>对照：</b>' + escapeHtml(referenceBatch.label) + '</div>' : '') + '<div><b>本次：</b>' + escapeHtml(batch ? batch.label : '当前批次') + '</div><div><b>生成时间：</b>' + new Date().toLocaleString() + '</div></div></div>');
    html.push('<div class="sr-kpis">');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">参考人数</div><div class="sr-kpi-value">' + rows.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">均分</div><div class="sr-kpi-value">' + (avgScore == null ? '-' : avgScore.toFixed(1)) + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">满分参考</div><div class="sr-kpi-value">' + (fm || '-') + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">低均分小题</div><div class="sr-kpi-value">' + weakItems.filter(function(w){ return w.rate < 0.6; }).length + '</div></div>');
    html.push('</div>');
    html.push('<div class="sr-section"><h3>一、班级对比与分层结构</h3><div class="sr-grid">');
    html.push('<div id="subjectReportClassAvgChart" class="sr-chart sr-chart-large"></div>');
    html.push('<div id="subjectReportGradeChart" class="sr-chart sr-chart-large"></div>');
    html.push('</div></div>');
    html.push('<div class="sr-section"><h3>二、小题得分率与流转</h3><div class="sr-grid">');
    html.push('<div id="subjectReportItemRateChart" class="sr-chart sr-chart-wide"></div>');
    html.push('<div id="subjectReportFlowChart" class="sr-chart sr-chart-wide"></div>');
    html.push('</div></div>');
    html.push('<div class="sr-section"><h3>三、分层结构与流转名单</h3>');
    html.push(renderSubjectGradeNameTable(rows, subjectPop, tierMode));
    html.push(renderSubjectFlowNameTable(flow));
    html.push('</div>');
    html.push('<div class="sr-section"><h3>四、错题归因：选择题答案分布</h3>');
    html.push('<div id="subjectReportChoiceChart" class="sr-chart sr-chart-wide"></div>');
    html.push(renderSubjectChoiceDistributionTable(choiceItems));
    html.push('<div class="sr-note-box" style="margin-top:10px;">主观题建议由任课教师结合评分细则、典型答卷和课堂观察补充归因，本报告不自动编造主观题知识点。</div>');
    html.push('</div>');
    html.push('<div class="sr-section"><h3>五、低得分率小题明细</h3>');
    html.push('<table class="sr-table"><thead><tr><th>题号/模块</th><th>平均得分率</th><th>参考人数</th><th>判断</th></tr></thead><tbody>');
    weakItems.slice(0, 12).forEach(function(w) {
        var label = w.rate < 0.45 ? '共性高风险' : (w.rate < 0.6 ? '重点讲评' : '巩固提升');
        html.push('<tr><td>' + escapeHtml(w.item) + '</td><td>' + Math.round(w.rate * 100) + '%</td><td>' + w.count + '</td><td>' + label + '</td></tr>');
    });
    html.push('</tbody></table></div>');
    html.push('</div>');
    content.innerHTML = html.join('');
    output.dataset.backTarget = 'comprehensiveOutput';
    output.dataset.printTitle = [subjectName, '单科教研图文报告', classNames.join('、'), (batch ? batch.label : '当前批次'), getTodayString()].filter(Boolean).join('_');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderSubjectTeachingCharts(rows, classNames, subjectName, fm, weakItems, flow, subjectPop, choiceItems, tierMode);
    return true;
}

function getReportTierBySubjectGrade(grade) {
    var g = String(grade || '').trim().toUpperCase();
    if (g === 'A+' || g === 'A') return '领先';
    if (g === 'B+') return '中上';
    if (g === 'B') return '临界';
    if (g === 'C+' || g === 'C') return '后进';
    return '—';
}

function getSubjectItemAverageRates(rows) {
    var map = {};
    rows.forEach(function(r) {
        Object.keys(r.subScores || {}).forEach(function(itemName) {
            var item = r.subScores[itemName];
            if (!item || typeof item !== 'object') return;
            var score = parseFloat(item.score), maxScore = parseFloat(item.maxScore);
            if (isNaN(score) || isNaN(maxScore) || maxScore <= 0) return;
            if (!map[itemName]) map[itemName] = { item: itemName, score: 0, max: 0, count: 0 };
            map[itemName].score += score;
            map[itemName].max += maxScore;
            map[itemName].count++;
        });
    });
    return Object.keys(map).map(function(k) { var e = map[k]; return { item: e.item, rate: e.max > 0 ? e.score / e.max : 0, count: e.count }; }).sort(function(a,b){ return a.rate - b.rate; });
}

function getSubjectChoiceDistribution(rows) {
    function normAns(v) { return String(v || '').toUpperCase().replace(/[^A-H]/g, ''); }
    function isChoice(itemName, ans, correct) {
        var a = normAns(ans), c = normAns(correct);
        if (a && /^[A-H]{1,8}$/.test(a)) return true;
        if (c && /^[A-H]{1,8}$/.test(c)) return true;
        return /选择|单选|多选|客观/.test(String(itemName || ''));
    }
    var map = {};
    rows.forEach(function(r) {
        Object.keys(r.subScores || {}).forEach(function(itemName) {
            var item = r.subScores[itemName];
            if (!item || typeof item !== 'object') return;
            var ans = normAns(item.studentAnswer), correct = normAns(item.correctAnswer);
            if (!isChoice(itemName, ans, correct)) return;
            if (!map[itemName]) map[itemName] = { item: itemName, correct: correct, counts: {}, total: 0, wrong: 0 };
            var key = ans || '空白';
            map[itemName].counts[key] = (map[itemName].counts[key] || 0) + 1;
            map[itemName].total++;
            if (correct && ans !== correct) map[itemName].wrong++;
            if (!map[itemName].correct && correct) map[itemName].correct = correct;
        });
    });
    return Object.keys(map).map(function(k) {
        var e = map[k];
        var wrongChoices = Object.keys(e.counts).filter(function(a){ return a !== e.correct; }).sort(function(a,b){ return e.counts[b] - e.counts[a]; });
        return { item: e.item, correct: e.correct || '-', counts: e.counts, total: e.total, wrong: e.wrong, wrongRate: e.total ? e.wrong / e.total : 0, topWrong: wrongChoices[0] || '-' };
    }).sort(function(a,b){ return b.wrongRate - a.wrongRate || b.wrong - a.wrong; });
}

function renderSubjectChoiceDistributionTable(choiceItems) {
    if (!choiceItems.length) return '<div class="sr-note-box">当前数据未检测到选择题学生答案/正确答案字段，无法生成选择题答案分布。</div>';
    var html = '<table class="sr-table"><thead><tr><th>题号</th><th>正确答案</th><th>错选率</th><th>最高错选</th><th>答案分布</th><th>归因提示</th></tr></thead><tbody>';
    choiceItems.slice(0, 12).forEach(function(item) {
        var dist = Object.keys(item.counts).sort().map(function(k){ return k + '(' + item.counts[k] + ')'; }).join(' ');
        var hint = item.wrongRate >= 0.5 ? '高集中错选，优先讲评选项干扰点' : (item.wrongRate >= 0.3 ? '存在明显干扰项，建议课堂追问' : '整体掌握较好，个别纠错');
        html += '<tr><td>' + escapeHtml(item.item) + '</td><td>' + escapeHtml(item.correct) + '</td><td>' + Math.round(item.wrongRate * 100) + '%</td><td>' + escapeHtml(item.topWrong) + '</td><td>' + escapeHtml(dist) + '</td><td>' + hint + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
}

function getSubjectGradeFlowForReport(rows, subjectName, compareBatchId) {
    var flow = { up: 0, down: 0, stable: 0, none: 0, upNames: [], downNames: [], stableNames: [], noneNames: [] };
    if (!compareBatchId) { flow.none = rows.length; flow.noneNames = rows.map(function(r){ return r.name; }); return flow; }
    var cmpBatch = DataPool.batches.find(function(b) { return b.id === compareBatchId; });
    if (!cmpBatch) { flow.none = rows.length; flow.noneNames = rows.map(function(r){ return r.name; }); return flow; }
    var prevMap = {};
    cmpBatch.combinedStudentData.forEach(function(s) { prevMap[String(s.name || '').trim() + '||' + normalizeClassName(s.class || '')] = s; });
    var order = ['C','C+','B','B+','A','A+'];
    rows.forEach(function(r) {
        var ps = prevMap[String(r.rawName || '').trim() + '||' + normalizeClassName(r.className || '')];
        var psd = getSubjectDataByAlias(ps, subjectName);
        var prevGrade = psd ? String(psd.grade || '').trim().toUpperCase() : '';
        var curGrade = r.grade || '';
        var pi = order.indexOf(prevGrade), ci = order.indexOf(curGrade);
        if (pi < 0 || ci < 0) { flow.none++; flow.noneNames.push(r.name); return; }
        if (ci > pi) { flow.up++; flow.upNames.push(r.name + '（' + prevGrade + '→' + curGrade + '）'); }
        else if (ci < pi) { flow.down++; flow.downNames.push(r.name + '（' + prevGrade + '→' + curGrade + '）'); }
        else { flow.stable++; flow.stableNames.push(r.name + '（' + curGrade + '）'); }
    });
    return flow;
}

function renderSubjectGradeNameTable(rows, subjectPop, tierMode) {
    if (tierMode !== 'grade') {
        var tierOrder2 = ['领先','中上','临界','后进'];
        var tierGroups2 = { '领先': [], '中上': [], '临界': [], '后进': [] };
        rows.forEach(function(r){ if (tierGroups2[r.tier]) tierGroups2[r.tier].push(r.name); });
        var hasTier2 = tierOrder2.some(function(t){ return tierGroups2[t].length; });
        if (!hasTier2) return '<div class="sr-note-box">当前数据缺少可用于排名分层的单科排名。</div>';
        var tierHtml2 = '<table class="sr-table"><thead><tr><th>排名分层</th><th>人数</th><th>学生姓名</th></tr></thead><tbody>';
        tierOrder2.forEach(function(t) { tierHtml2 += '<tr><td>' + t + '</td><td>' + tierGroups2[t].length + '</td><td>' + escapeHtml(tierGroups2[t].join('、') || '-') + '</td></tr>'; });
        tierHtml2 += '</tbody></table>';
        return tierHtml2;
    }
    var order = ['A+','A','B+','B','C+','C'];
    var groups = {};
    order.forEach(function(g){ groups[g] = []; });
    rows.forEach(function(r){ if (groups[r.grade]) groups[r.grade].push(r.name); });
    var hasGrade = order.some(function(g){ return groups[g].length; });
    if (!hasGrade) {
        var tierOrder = ['领先','中上','临界','后进'];
        var tierGroups = { '领先': [], '中上': [], '临界': [], '后进': [] };
        rows.forEach(function(r){ var tier = getReportTierByRank(r.rank, subjectPop); if (tierGroups[tier]) tierGroups[tier].push(r.name); });
        var hasTier = tierOrder.some(function(t){ return tierGroups[t].length; });
        if (!hasTier) return '<div class="sr-note-box">当前数据未提供 A+/A/B+/B/C+/C 等级字段，也缺少可用于分层的单科排名。</div>';
        var tierHtml = '<table class="sr-table"><thead><tr><th>分层</th><th>人数</th><th>学生姓名</th></tr></thead><tbody>';
        tierOrder.forEach(function(t) { tierHtml += '<tr><td>' + t + '</td><td>' + tierGroups[t].length + '</td><td>' + escapeHtml(tierGroups[t].join('、') || '-') + '</td></tr>'; });
        tierHtml += '</tbody></table>';
        return tierHtml;
    }
    var html = '<table class="sr-table"><thead><tr><th>等级</th><th>人数</th><th>学生姓名</th></tr></thead><tbody>';
    order.forEach(function(g) {
        html += '<tr><td>' + g + '</td><td>' + groups[g].length + '</td><td>' + escapeHtml(groups[g].join('、') || '-') + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
}

function renderSubjectFlowNameTable(flow) {
    var rows = [
        { label: '等级进步', count: flow.up, names: flow.upNames },
        { label: '等级稳定', count: flow.stable, names: flow.stableNames },
        { label: '等级退步', count: flow.down, names: flow.downNames },
        { label: '无对比', count: flow.none, names: flow.noneNames }
    ];
    var html = '<table class="sr-table" style="margin-top:12px;"><thead><tr><th>流转类型</th><th>人数</th><th>学生姓名</th></tr></thead><tbody>';
    rows.forEach(function(r) {
        html += '<tr><td>' + r.label + '</td><td>' + r.count + '</td><td>' + escapeHtml((r.names || []).join('、') || '-') + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
}

function renderSubjectTeachingCharts(rows, classNames, subjectName, fm, weakItems, flow, subjectPop, choiceItems, tierMode) {
    if (typeof echarts === 'undefined') return;
    renderSubjectClassAvgChart(rows, classNames, fm);
    renderSubjectGradeDonutChart(rows, subjectPop, tierMode);
    renderSubjectItemRateChart(weakItems);
    renderSubjectFlowChart(flow);
    renderSubjectChoiceDistributionChart(choiceItems || [], rows);
}

function renderSubjectChoiceDistributionChart(choiceItems, allRows) {
    var el = document.getElementById('subjectReportChoiceChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var top = choiceItems.slice(0, 10);
    if (!top.length) { chart.setOption({ title: { text: '选择题答案分布：暂无可用答案数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    var keys = [];
    top.forEach(function(item) { Object.keys(item.counts).forEach(function(k){ if (keys.indexOf(k) < 0) keys.push(k); }); });
    var answerOrder = ['A','B','C','D','E','F','G','H','空白'];
    keys.sort(function(a, b) {
        var ai = answerOrder.indexOf(a), bi = answerOrder.indexOf(b);
        if (ai < 0) ai = 99;
        if (bi < 0) bi = 99;
        return ai - bi || String(a).localeCompare(String(b));
    });
    var rightColor = getSemanticChartColor('正确');
    var series = keys.map(function(k, idx) {
        var baseColor = getChoiceAnswerColor(k);
        return {
            name: k,
            type: 'bar',
            stack: 'answers',
            data: top.map(function(item) { return item.counts[k] || 0; }),
            itemStyle: {
                color: function(p) {
                    var itemInfo = top[p.dataIndex];
                    return (itemInfo && itemInfo.correct && k === itemInfo.correct) ? rightColor : baseColor;
                },
                borderColor: '#fff',
                borderWidth: 1
            },
            barMaxWidth: 32,
            barMinHeight: 8,
            emphasis: { focus: 'series' }
        };
    });
    chart.setOption({
        color: keys.map(function(k) { return getChoiceAnswerColor(k); }),
        title: getReportChartTitle('选择题答案分布：绿色为正确答案'),
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(15,23,42,.92)',
            borderWidth: 0,
            textStyle: { color: '#fff', fontSize: 12 },
            formatter: function(p) {
                var itemInfo = top[p.dataIndex];
                var correct = itemInfo && itemInfo.correct ? itemInfo.correct : '-';
                var isCorrect = itemInfo && itemInfo.correct && p.seriesName === itemInfo.correct;
                return escapeHtml(itemInfo ? itemInfo.item : '') + '<br>选项：<b>' + escapeHtml(p.seriesName) + '</b>' + (isCorrect ? '（正确）' : '') + '<br>人数：' + p.value + '<br>正确答案：' + escapeHtml(correct);
            }
        },
        legend: { top: 48, data: keys, textStyle: { color: REPORT_CHART_THEME.axis, fontSize: 11 }, itemWidth: 11, itemHeight: 8, itemGap: 10 },
        grid: getReportChartGrid(48, 28, 76, 48),
        xAxis: getReportCategoryAxis(top.map(function(i){ return i.item; }), 20),
        yAxis: getReportValueAxis('人数'),
        series: series
    });
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || params.dataIndex == null) return;
        var answerKey = params.seriesName;
        var itemInfo = top[params.dataIndex];
        if (!itemInfo || !allRows) return;
        var matched = allRows.filter(function(r) {
            var sub = r.subScores && r.subScores[itemInfo.item];
            if (!sub) return false;
            var ans = String(sub.studentAnswer || '').toUpperCase().replace(/[^A-H]/g, '');
            return ans === answerKey;
        });
        if (!matched.length) return;
        var isCorrect = itemInfo.correct && answerKey === itemInfo.correct;
        var titleText = itemInfo.item + ' - 选「' + answerKey + '」共' + matched.length + '人' + (isCorrect ? '（正确）' : '');
        var html = matched.map(function(r, i) {
            if (!r) return '';
            return (i+1) + '. ' + escapeHtml(r.className || '') + ' ' + escapeHtml(r.name || '');
        }).join('<br>');
        showStudentListModal(titleText, html);
    });
}

function renderSubjectClassAvgChart(rows, classNames, fm) {
    var el = document.getElementById('subjectReportClassAvgChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var data = classNames.map(function(cls) {
        var items = rows.filter(function(r){ return String(r.className) === String(cls) && r.score != null; });
        var avg = items.length ? items.reduce(function(a,b){ return a + b.score; }, 0) / items.length : null;
        var rate = avg != null && fm ? Math.round(avg / fm * 100) : null;
        return { cls: cls, avg: avg, rate: rate };
    });
    var useRate = fm != null && fm > 0;
    chart.setOption({ color: getSmartChartPalette(data.length), title: getReportChartTitle(useRate ? '各班单科得分率对比' : '各班单科均分对比'), tooltip: getReportTooltip(), grid: getReportChartGrid(42, 28, 54, 38), xAxis: getReportCategoryAxis(data.map(function(d){ return d.cls; })), yAxis: Object.assign(getReportValueAxis(useRate ? '得分率' : '均分', useRate ? 100 : null), { axisLabel: { color: REPORT_CHART_THEME.axis, fontSize: 11, formatter: useRate ? '{value}%' : '{value}' } }), series: [{ type: 'bar', data: data.map(function(d, i){ return { value: useRate ? d.rate : (d.avg == null ? null : Number(d.avg.toFixed(1))), itemStyle: { color: getSmartChartColor(i) } }; }), barMaxWidth: 30, itemStyle: { borderRadius: [7,7,0,0] }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700, formatter: function(p){ return p.value == null ? '-' : (useRate ? p.value + '%' : p.value); } } }] });
}

function renderSubjectGradeDonutChart(rows, subjectPop, tierMode) {
    var el = document.getElementById('subjectReportGradeChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var order = ['A+','A','B+','B','C+','C'];
    var counts = {};
    var data = [];
    var colors = [];
    var title = tierMode === 'grade' ? '单科等级结构' : '单科排名分层结构';
    if (tierMode === 'grade') {
        rows.forEach(function(r){ if (order.indexOf(r.grade) >= 0) counts[r.grade] = (counts[r.grade] || 0) + 1; });
        data = order.filter(function(g){ return counts[g]; }).map(function(g){ return { name: g, value: counts[g] }; });
        colors = getGradeChartColors(data.map(function(d){ return d.name; }));
    }
    if (tierMode !== 'grade' || !data.length) {
        var tiers = { '领先': 0, '中上': 0, '临界': 0, '后进': 0 };
        rows.forEach(function(r){ var tier = r.tier || getReportTierByRank(r.rank, subjectPop); if (!tiers.hasOwnProperty(tier)) tier = getReportTierByRank(r.rank, subjectPop); if (tiers.hasOwnProperty(tier)) tiers[tier]++; });
        data = ['领先','中上','临界','后进'].filter(function(t){ return tiers[t]; }).map(function(t){ return { name: t, value: tiers[t] }; });
        colors = getGradeChartColors(data.map(function(d){ return d.name; }));
        title = '单科排名分层结构';
    }
    if (!data.length) { chart.setOption({ title: { text: '单科分层结构：暂无等级/排名数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    var pieOption = getReportPieOption(title, data, colors);
    // 等级模式最多会出现 6 个扇区，外置标签比排名模式更密集。
    // 将圆环整体上移并缩小，底部单独留给图例，同时启用标签避让，保证两种分层方式都不与图例重叠。
    pieOption.legend = {
        type: 'scroll',
        left: 'center',
        bottom: 6,
        width: '88%',
        itemWidth: 12,
        itemHeight: 9,
        itemGap: 12,
        textStyle: { color: REPORT_CHART_THEME.axis, fontSize: 11 }
    };
    if (pieOption.series && pieOption.series[0]) {
        pieOption.series[0].radius = ['38%', '59%'];
        pieOption.series[0].center = ['50%', '43%'];
        pieOption.series[0].avoidLabelOverlap = true;
        pieOption.series[0].label = Object.assign({}, pieOption.series[0].label || {}, {
            fontSize: 11,
            minMargin: 5,
            edgeDistance: '7%',
            bleedMargin: 4
        });
        pieOption.series[0].labelLine = {
            show: true,
            length: 10,
            length2: 9,
            smooth: false,
            maxSurfaceAngle: 80
        };
        pieOption.series[0].labelLayout = {
            hideOverlap: true,
            moveOverlap: 'shiftY'
        };
    }
    chart.setOption(pieOption);
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || !params.name) return;
        var key = params.name;
        var matched;
        if (title.indexOf('分层') >= 0) {
            matched = rows.filter(function(r) { return r.tier === key || getReportTierByRank(r.rank, subjectPop) === key; });
        } else {
            matched = rows.filter(function(r) { return r.grade === key; });
        }
        if (!matched.length) return;
        var titleText = title + ' - ' + key + ' 共' + matched.length + '人';
        var html = matched.map(function(r, i) {
            return (i+1) + '. ' + escapeHtml(r.name) + '（' + r.className + '，' + (r.grade || r.rank + '名') + '）';
        }).join('<br>');
        showStudentListModal(titleText, html);
    });
}

function renderSubjectItemRateChart(weakItems) {
    var el = document.getElementById('subjectReportItemRateChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var top = weakItems.slice(0, 10);
    if (!top.length) { chart.setOption({ title: { text: '小题平均得分率：暂无小题数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    var ordered = top.slice().reverse();
    chart.setOption({ title: getReportChartTitle('小题平均得分率排序：越低越需优先讲评'), tooltip: getReportTooltip(), grid: getReportChartGrid(100, 44, 54, 40), xAxis: Object.assign(getReportValueAxis('平均得分率', 100), { nameLocation: 'middle', nameGap: 25 }), yAxis: getReportCategoryAxis(ordered.map(function(w){ return w.item; })), series: [{ type: 'bar', data: ordered.map(function(w){ var v = Math.round(w.rate * 100); return { value: v, itemStyle: { color: v < 45 ? getSemanticChartColor('高风险') : (v < 60 ? getSemanticChartColor('重点') : getSmartChartColor(0)) } }; }), barMaxWidth: 20, itemStyle: { borderRadius: [0,7,7,0] }, label: { show: true, position: 'right', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700, formatter: '{c}%' } }] });
}

function renderSubjectFlowChart(flow) {
    var el = document.getElementById('subjectReportFlowChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    chart.setOption({ color: [getSemanticChartColor('升级'), getSemanticChartColor('稳定'), getSemanticChartColor('降级'), getSemanticChartColor('无对比')], title: getReportChartTitle('等级流转统计：升级/降级一眼识别'), tooltip: getReportTooltip(), grid: getReportChartGrid(42, 28, 54, 36), xAxis: getReportCategoryAxis(['升级','稳定','降级','无对比']), yAxis: Object.assign(getReportValueAxis('人数'), { minInterval: 1 }), series: [{ type: 'bar', data: [{ value: flow.up, itemStyle: { color: getSemanticChartColor('升级') } }, { value: flow.stable, itemStyle: { color: getSemanticChartColor('稳定') } }, { value: flow.down, itemStyle: { color: getSemanticChartColor('降级') } }, { value: flow.none, itemStyle: { color: getSemanticChartColor('无对比') } }], barMaxWidth: 34, itemStyle: { borderRadius: [7,7,0,0] }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700 } }] });
    chart.off('click');
    chart.on('click', function(params) {
        if (!params || !params.name) return;
        var map = { '升级': flow.upNames, '稳定': flow.stableNames, '降级': flow.downNames, '无对比': flow.noneNames };
        var names = map[params.name];
        if (!names || !names.length) return;
        var titleText = '等级流转 - ' + params.name + ' 共' + names.length + '人';
        var html = names.map(function(n, i) { return (i+1) + '. ' + escapeHtml(n); }).join('<br>');
        showStudentListModal(titleText, html);
    });
}

function buildProgressAnalysisData(baseBatch, cmpBatch, className, subjectName) {
    if (!baseBatch || !cmpBatch) return null;
    var filterClass = className === '__all__' || !className ? null : className;
    var baseData = baseBatch.combinedStudentData || [];
    var cmpData = cmpBatch.combinedStudentData || [];
    var baseDataAll = baseData;
    var cmpDataAll = cmpData;
    if (filterClass) {
        baseData = baseData.filter(function(s) { return normalizeClassName(s.class) === normalizeClassName(filterClass); });
        cmpData = cmpData.filter(function(s) { return normalizeClassName(s.class) === normalizeClassName(filterClass); });
    }
    var isTotal = !subjectName || subjectName === '__total__';
    var totalName = isTotal ? getTotalSubjectName(baseBatch.allSubjectHeaders || allSubjectHeaders, baseData) : subjectName;
    if (!totalName) return null;
    var subjectDisplay = isTotal ? '总分' : subjectName;
    var baseMap = {}; baseData.forEach(function(s) { baseMap[String(s.name || '').trim() + '||' + normalizeClassName(s.class || '')] = s; });
    var cmpMap = {}; cmpData.forEach(function(s) { cmpMap[String(s.name || '').trim() + '||' + normalizeClassName(s.class || '')] = s; });
    function computeRankMap(data) {
        var list = [];
        data.forEach(function(s) {
            var sd = getSubjectDataByAlias(s, totalName);
            if (!sd) return;
            var sc = parseFloat(sd.score);
            if (isNaN(sc)) return;
            list.push({ key: String(s.name || '').trim() + '||' + normalizeClassName(s.class || ''), score: sc });
        });
        list.sort(function(a, b) { return b.score - a.score; });
        var rankMap = {};
        var currentRank = 1;
        for (var i = 0; i < list.length; i++) {
            if (i > 0 && list[i].score < list[i-1].score) currentRank = i + 1;
            rankMap[list[i].key] = currentRank;
        }
        return rankMap;
    }
    var baseRankMap = computeRankMap(baseDataAll);
    var cmpRankMap = computeRankMap(cmpDataAll);
    var results = [];
    Object.keys(baseMap).forEach(function(key) {
        var bs = baseMap[key], cs = cmpMap[key];
        if (!cs || !bs.class) return;
        var bsd = getSubjectDataByAlias(bs, totalName);
        var csd = getSubjectDataByAlias(cs, totalName);
        var baseScore = bsd && !isNaN(parseFloat(bsd.score)) ? parseFloat(bsd.score) : NaN;
        var cmpScore = csd && !isNaN(parseFloat(csd.score)) ? parseFloat(csd.score) : NaN;
        if (isNaN(baseScore) || isNaN(cmpScore)) return;
        var baseRank = baseRankMap[key] || '-';
        var cmpRank = cmpRankMap[key] || '-';
        results.push({ name: getStudentDisplayName(bs), rawName: bs.name, className: bs.class, baseScore: baseScore, cmpScore: cmpScore, diff: cmpScore - baseScore, baseRank: baseRank, cmpRank: cmpRank, rankDiff: (typeof baseRank === 'number' && typeof cmpRank === 'number') ? (baseRank - cmpRank) : '-' });
    });
    results.sort(function(a, b) { return b.diff - a.diff; });
    var classMap = {};
    results.forEach(function(r) { if (!classMap[r.className]) classMap[r.className] = []; classMap[r.className].push(r); });
    var classStats = Object.keys(classMap).sort().map(function(cls) {
        var items = classMap[cls];
        var validRankDiffs = items.filter(function(r) { return typeof r.rankDiff === 'number'; });
        return {
            className: cls,
            total: items.length,
            improved: items.filter(function(r){ return r.diff > 0; }).length,
            declined: items.filter(function(r){ return r.diff < 0; }).length,
            stable: items.filter(function(r){ return r.diff === 0; }).length,
            rankImproved: validRankDiffs.filter(function(r){ return r.rankDiff > 0; }).length,
            rankDeclined: validRankDiffs.filter(function(r){ return r.rankDiff < 0; }).length,
            rankStable: validRankDiffs.filter(function(r){ return r.rankDiff === 0; }).length,
            avgDiff: items.length ? items.reduce(function(a,b){ return a + b.diff; }, 0) / items.length : 0,
            avgRankDiff: validRankDiffs.length ? validRankDiffs.reduce(function(a,b){ return a + b.rankDiff; }, 0) / validRankDiffs.length : null
        };
    });
    return { baseBatch: baseBatch, cmpBatch: cmpBatch, className: filterClass, subjectName: subjectName, subjectDisplay: subjectDisplay, totalName: totalName, results: results, classStats: classStats };
}

function renderProgressReadableReport() {
    var baseId = document.getElementById('progressBaseBatch').value;
    var cmpId = document.getElementById('progressCompareBatch').value;
    if (!baseId || !cmpId || baseId === cmpId) return false;
    var baseBatch = DataPool.batches.find(function(b) { return b.id === baseId; });
    var cmpBatch = DataPool.batches.find(function(b) { return b.id === cmpId; });
    var className = document.getElementById('progressClassFilter').value || '__all__';
    var subjectName = document.getElementById('progressSubjectFilter').value || '__total__';
    var data = buildProgressAnalysisData(baseBatch, cmpBatch, className, subjectName);
    if (!data || !data.results.length) return false;
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content) return false;
    var improved = data.results.filter(function(r){ return r.diff > 0; });
    var declined = data.results.filter(function(r){ return r.diff < 0; });
    var rankImproved = data.results.filter(function(r){ return typeof r.rankDiff === 'number' && r.rankDiff > 0; }).sort(function(a,b){ return b.rankDiff - a.rankDiff; });
    var rankDeclined = data.results.filter(function(r){ return typeof r.rankDiff === 'number' && r.rankDiff < 0; }).sort(function(a,b){ return a.rankDiff - b.rankDiff; });
    var avgDiff = data.results.reduce(function(a,b){ return a + b.diff; }, 0) / data.results.length;
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>进退步量化图文报告</h2><p>从分数变化、名次变化与班级结构三个角度识别重点关注学生。</p></div>');
    html.push('<div class="cr-meta"><div><b>对照：</b>' + escapeHtml(data.baseBatch.label) + '</div><div><b>本次：</b>' + escapeHtml(data.cmpBatch.label) + '</div><div><b>范围：</b>' + escapeHtml(data.className || '全部班级') + '</div><div><b>指标：</b>' + escapeHtml(data.subjectDisplay) + '</div><div><b>生成时间：</b>' + new Date().toLocaleString() + '</div></div></div>');
    html.push('<div class="sr-kpis">');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">匹配人数</div><div class="sr-kpi-value">' + data.results.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">分数进步</div><div class="sr-kpi-value">' + improved.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">分数退步</div><div class="sr-kpi-value">' + declined.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">平均变化</div><div class="sr-kpi-value">' + (avgDiff >= 0 ? '+' : '') + avgDiff.toFixed(1) + '</div></div>');
    html.push('</div>');
    html.push('<div class="sr-section"><h3>一、进退步 Top10</h3><div class="sr-grid">');
    html.push('<div id="progressReportImproveChart" class="sr-chart sr-chart-large"></div>');
    html.push('<div id="progressReportDeclineChart" class="sr-chart sr-chart-large"></div>');
    html.push('</div></div>');
    html.push('<div class="sr-section"><h3>二、变化结构</h3><div class="sr-grid">');
    html.push('<div id="progressReportScatterChart" class="sr-chart sr-chart-wide"></div>');
    html.push('<div id="progressReportClassChart" class="sr-chart sr-chart-wide"></div>');
    html.push('</div></div>');
    window.progressReadableDetailMap = {};
    html.push('<div class="sr-section"><h3>三、重点学生明细</h3><table class="sr-table"><thead><tr><th>类型</th><th>班级</th><th>姓名</th><th>对照分/本次分</th><th>分数变化</th><th>名次变化</th></tr></thead><tbody>');
    rankImproved.slice(0, 10).forEach(function(r){ html.push(renderProgressReadableRow('名次进步', r)); });
    rankDeclined.slice(0, 10).forEach(function(r){ html.push(renderProgressReadableRow('名次退步', r)); });
    html.push('</tbody></table></div></div>');
    content.innerHTML = html.join('');
    output.dataset.backTarget = 'progressOutput';
    output.dataset.printTitle = ['进退步量化图文报告', data.baseBatch.label + '至' + data.cmpBatch.label, data.className || '全部班级', data.subjectDisplay, getTodayString()].filter(Boolean).join('_');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderProgressReadableCharts(data, rankImproved, rankDeclined);
    return true;
}

function renderProgressReadableRow(type, r) {
    var rankText = typeof r.rankDiff === 'number' ? (r.rankDiff > 0 ? '↑' + r.rankDiff : (r.rankDiff < 0 ? '↓' + Math.abs(r.rankDiff) : '→0')) : '-';
    var isImprove = type.indexOf('进步') >= 0;
    var color = isImprove ? '#16a34a' : '#dc2626';
    var bg = isImprove ? '#f0fdf4' : '#fef2f2';
    var key = 'p' + Object.keys(window.progressReadableDetailMap || {}).length;
    if (!window.progressReadableDetailMap) window.progressReadableDetailMap = {};
    window.progressReadableDetailMap[key] = { type: type, row: r };
    return '<tr onclick="showProgressReadableDetail(\'' + key + '\')" style="cursor:pointer;background:' + bg + ';" title="点击查看具体变化明细"><td><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:' + color + ';color:#fff;font-weight:700;">' + type + '</span></td><td>' + escapeHtml(r.className) + '</td><td style="font-weight:700;color:' + color + ';">' + escapeHtml(r.name) + '</td><td>' + r.baseScore.toFixed(1) + ' / ' + r.cmpScore.toFixed(1) + '</td><td style="font-weight:700;color:' + color + ';">' + (r.diff >= 0 ? '+' : '') + r.diff.toFixed(1) + '</td><td style="font-weight:700;color:' + color + ';">' + rankText + '</td></tr>';
}

function showProgressReadableDetail(key) {
    var entry = window.progressReadableDetailMap && window.progressReadableDetailMap[key];
    if (!entry) return;
    var r = entry.row;
    var isImprove = entry.type.indexOf('进步') >= 0;
    var color = isImprove ? '#16a34a' : '#dc2626';
    var rankText = typeof r.rankDiff === 'number' ? (r.rankDiff > 0 ? '↑' + r.rankDiff + '名' : (r.rankDiff < 0 ? '↓' + Math.abs(r.rankDiff) + '名' : '→0名')) : '-';
    var html = '';
    html += '<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;">';
    html += '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;">';
    html += '<div><div style="font-size:18px;font-weight:800;color:#1e293b;">' + escapeHtml(r.name) + '</div><div style="font-size:13px;color:#64748b;">班级：' + escapeHtml(r.className) + '</div></div>';
    html += '<span style="padding:4px 12px;border-radius:999px;background:' + color + ';color:#fff;font-weight:800;">' + entry.type + '</span>';
    html += '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tbody>';
    html += '<tr><td style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc;font-weight:700;">对照分</td><td style="border:1px solid #e5e7eb;padding:8px;">' + r.baseScore.toFixed(1) + '</td><td style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc;font-weight:700;">本次分</td><td style="border:1px solid #e5e7eb;padding:8px;">' + r.cmpScore.toFixed(1) + '</td></tr>';
    html += '<tr><td style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc;font-weight:700;">分数变化</td><td style="border:1px solid #e5e7eb;padding:8px;color:' + color + ';font-weight:800;">' + (r.diff >= 0 ? '+' : '') + r.diff.toFixed(1) + '</td><td style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc;font-weight:700;">名次变化</td><td style="border:1px solid #e5e7eb;padding:8px;color:' + color + ';font-weight:800;">' + rankText + '</td></tr>';
    html += '<tr><td style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc;font-weight:700;">原名次</td><td style="border:1px solid #e5e7eb;padding:8px;">' + escapeHtml(r.baseRank) + '</td><td style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc;font-weight:700;">现名次</td><td style="border:1px solid #e5e7eb;padding:8px;">' + escapeHtml(r.cmpRank) + '</td></tr>';
    html += '</tbody></table>';
    html += '<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:' + (isImprove ? '#f0fdf4' : '#fef2f2') + ';color:' + color + ';font-weight:700;">' + (isImprove ? '建议保留其近期有效学习策略，并关注是否能稳定保持。' : '建议教师尽快回看该生本次失分结构，优先确认是否存在单科波动或答题节奏问题。') + '</div>';
    html += '</div>';
    if (typeof showErrorNotebookModal === 'function') showErrorNotebookModal('进退步明细 - ' + r.name, html);
    else if (typeof showStudentListModal === 'function') showStudentListModal('进退步明细 - ' + r.name, html);
}

function renderProgressReadableCharts(data, rankImproved, rankDeclined) {
    if (typeof echarts === 'undefined') return;
    renderProgressTopBarChart('progressReportImproveChart', '名次进步 Top10', rankImproved.slice(0, 10), REPORT_CHART_THEME.progressNormal, true);
    renderProgressTopBarChart('progressReportDeclineChart', '名次退步 Top10', rankDeclined.slice(0, 10), REPORT_CHART_THEME.progressAbnormal, false);
    renderProgressScatterChart(data.results);
    renderProgressClassStackChart(data.classStats, data.results);
}

function renderProgressTopBarChart(elId, title, rows, color, improve) {
    var el = document.getElementById(elId);
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    if (!rows.length) { chart.setOption({ title: { text: title + '：暂无数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    var ordered = rows.slice().reverse();
    setReportHorizontalBarOption(chart, { title: title, xName: '名次变化', names: ordered.map(function(r){ return r.name; }), values: ordered.map(function(r){ return Math.abs(r.rankDiff); }), color: color, right: 56 });
    chart.setOption({ series: [{ label: { formatter: function(p){ return (improve ? '↑' : '↓') + p.value + '名'; } } }] });
}

function renderProgressScatterChart(rows) {
    var el = document.getElementById('progressReportScatterChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var points = rows.filter(function(r){ return typeof r.rankDiff === 'number'; }).map(function(r){ return { name: r.name, value: [Number(r.diff.toFixed(1)), r.rankDiff], className: r.className }; });
    if (!points.length) { chart.setOption({ title: { text: '分数变化 vs 名次变化：暂无排名数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
    chart.setOption({ title: getReportChartTitle('分数变化 vs 名次变化'), tooltip: { formatter: function(p){ return escapeHtml(p.data.name) + '<br>班级：' + escapeHtml(p.data.className) + '<br>分数变化：' + p.value[0] + '<br>名次变化：' + (p.value[1] > 0 ? '↑' + p.value[1] : (p.value[1] < 0 ? '↓' + Math.abs(p.value[1]) : '→0')); }, backgroundColor: 'rgba(15,23,42,.92)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } }, grid: getReportChartGrid(64, 32, 54, 58), xAxis: Object.assign(getReportValueAxis('分数变化'), { nameLocation: 'middle', nameGap: 32 }), yAxis: Object.assign(getReportValueAxis('名次变化'), { nameLocation: 'middle', nameGap: 42 }), series: [{ type: 'scatter', symbolSize: function(v){ return Math.max(7, Math.min(18, Math.abs(v[1]) / 2 + 7)); }, data: points, itemStyle: { color: function(p){ return p.value[1] > 0 ? REPORT_CHART_THEME.green : (p.value[1] < 0 ? REPORT_CHART_THEME.red : REPORT_CHART_THEME.gray); }, opacity: 0.82 } }] });
}

function renderProgressClassStackChart(classStats, allResults) {
    var el = document.getElementById('progressReportClassChart');
    if (!el) return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    if (!classStats.length) { chart.setOption({ title: { text: '班级名次变化结构：暂无数据', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }

    var stableColor = getSemanticChartColor('持平');
    var classNames = classStats.map(function(c) { return c.className; });
    var n = classStats.length;
    var barMaxWidth = n <= 2 ? 40 : (n <= 4 ? 32 : (n <= 8 ? 26 : 20));
    var barCategoryGap = n <= 2 ? '62%' : (n <= 4 ? '45%' : '28%');

    var maxTotal = 0;
    classStats.forEach(function(c) {
        var t = c.rankImproved + c.rankStable + c.rankDeclined;
        if (t > maxTotal) maxTotal = t;
    });

    function segmentLabel(params) {
        if (!params.value) return '';
        return params.value + '人';
    }

    function progressClassTooltipFormatter(items) {
        if (!items || !items.length) return '';
        var idx = items[0].dataIndex;
        var c = classStats[idx];
        var total = c.rankImproved + c.rankStable + c.rankDeclined;
        var lines = [escapeHtml(String(c.className)) + ' · 共' + total + '人'];
        items.forEach(function(it) {
            var v = it.value || 0;
            var pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
            lines.push(it.marker + it.seriesName + ' ' + v + '人（' + pct + '%）');
        });
        return lines.join('<br/>');
    }

    var seriesBase = { type: 'bar', stack: 'total', barMaxWidth: barMaxWidth, barCategoryGap: barCategoryGap, label: { show: true, position: 'inside', formatter: segmentLabel, color: '#fff', fontSize: 11, fontWeight: 600 }, emphasis: { focus: 'series' } };

    chart.setOption({
        title: getReportChartTitle('各班名次进退结构'),
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(15,23,42,.92)',
            borderWidth: 0,
            textStyle: { color: '#fff', fontSize: 12 },
            formatter: progressClassTooltipFormatter
        },
        legend: { top: 8, right: 18, orient: 'horizontal', textStyle: { color: REPORT_CHART_THEME.axis, fontSize: 11 } },
        grid: getReportChartGrid(68, 28, 54, 58),
        xAxis: Object.assign(getReportValueAxis('人数'), { max: Math.max(Math.ceil(maxTotal * 1.06), 5), nameLocation: 'middle', nameGap: 32 }),
        yAxis: getReportCategoryAxis(classNames),
        series: [
            Object.assign({}, seriesBase, { name: '进步', data: classStats.map(function(c) { return c.rankImproved; }), itemStyle: { color: REPORT_CHART_THEME.progressNormal, borderRadius: [4, 0, 0, 4] } }),
            Object.assign({}, seriesBase, { name: '持平', data: classStats.map(function(c) { return c.rankStable; }), itemStyle: { color: stableColor } }),
            Object.assign({}, seriesBase, { name: '退步', data: classStats.map(function(c) { return c.rankDeclined; }), itemStyle: { color: REPORT_CHART_THEME.progressAbnormal, borderRadius: [0, 4, 4, 0] } })
        ]
    });

    chart.off('click');
    chart.on('click', function(params) {
        if (!params || params.dataIndex == null) return;
        var clsName = classStats[params.dataIndex] ? classStats[params.dataIndex].className : null;
        var seriesName = params.seriesName;
        if (!clsName || !seriesName || !allResults) return;
        var matched = allResults.filter(function(r) {
            if (String(r.className) !== String(clsName)) return false;
            if (typeof r.rankDiff !== 'number') return false;
            if (seriesName === '进步') return r.rankDiff > 0;
            if (seriesName === '退步') return r.rankDiff < 0;
            return r.rankDiff === 0;
        });
        if (!matched.length) return;
        var titleText = clsName + ' - ' + seriesName + ' 共' + matched.length + '人';
        var html = matched.map(function(r, i) {
            var diffStr = (r.diff >= 0 ? '+' : '') + r.diff.toFixed(1);
            if (seriesName === '进步') {
                return (i + 1) + '. ' + escapeHtml(r.name) + '｜名次进步' + r.rankDiff + '名｜分数' + diffStr;
            }
            if (seriesName === '退步') {
                return (i + 1) + '. ' + escapeHtml(r.name) + '｜名次退步' + Math.abs(r.rankDiff) + '名｜分数' + diffStr;
            }
            return (i + 1) + '. ' + escapeHtml(r.name) + '｜名次持平｜分数' + diffStr;
        }).join('<br>');
        showStudentListModal(titleText, html);
    });
}

function normalizeGradeLabel(g) {
    return String(g || '').trim().replace(/＋/g, '+').replace(/[\s\u3000]/g, '').toUpperCase();
}

function getGradeFloorScore(subject, gradeLabel, studentList) {
    var target = normalizeGradeLabel(gradeLabel);
    if (!target || !subject) return null;
    var min = Infinity;
    var count = 0;
    (studentList || combinedStudentData || []).forEach(function(s) {
        var sd = getSubjectDataByAlias(s, subject);
        if (!sd) return;
        if (normalizeGradeLabel(sd.grade) !== target) return;
        var sc = parseFloat(sd.score);
        if (isNaN(sc)) return;
        count++;
        if (sc < min) min = sc;
    });
    if (!count) return null;
    return { score: min, count: count };
}

function getCriticalGradeFloorMeta(mode) {
    var map = {
        grade_ap: { label: 'A+', title: 'A+最低分' },
        grade_a: { label: 'A', title: 'A最低分' },
        grade_bp: { label: 'B+', title: 'B+最低分' },
        grade_b: { label: 'B', title: 'B最低分' }
    };
    return map[mode] || null;
}

function getCriticalSubjectFullMark(subject) {
    var fullMarks = expandSubjectFullMarks(getSubjectFullMarksFromInputs(), combinedStudentData);
    if (subject && fullMarks[subject] != null) return fullMarks[subject];
    var keys = Object.keys(fullMarks || {});
    for (var i = 0; i < keys.length; i++) {
        if (typeof pdfSubjectMatches === 'function' && pdfSubjectMatches(keys[i], subject)) return fullMarks[keys[i]];
    }
    return 100;
}

function setCriticalLineHint(text) {
    ['criticalLineHint', 'smartCriticalLineHint'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.textContent = text || '';
    });
}

function setCriticalPassLineValue(line) {
    var rounded = Math.round(Number(line) * 10) / 10;
    ['criticalPassLine', 'smartCriticalPassLine'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = rounded;
    });
}

function syncCriticalLineModeUi() {
    var mode = (document.getElementById('criticalLineMode') || {}).value || 'ratio';
    var hidePct = !!getCriticalGradeFloorMeta(mode);
    var wrap = document.getElementById('criticalLinePercentWrap');
    var smartWrap = document.getElementById('smartCriticalLinePercentWrap');
    if (wrap) wrap.style.display = hidePct ? 'none' : '';
    if (smartWrap) smartWrap.style.display = hidePct ? 'none' : '';
}

function refreshCriticalPassLine(opts) {
    opts = opts || {};
    var fromSmart = !!opts.fromSmart;
    var silent = !!opts.silent;
    var modeEl = document.getElementById(fromSmart ? 'smartCriticalLineMode' : 'criticalLineMode');
    var pctEl = document.getElementById(fromSmart ? 'smartCriticalLinePercent' : 'criticalLinePercent');
    var subjEl = document.getElementById(fromSmart ? 'smartCriticalSubjectFilter' : 'criticalSubjectFilter');
    var mode = modeEl ? modeEl.value : 'ratio';
    var subject = subjEl ? subjEl.value : '';
    var otherMode = document.getElementById(fromSmart ? 'criticalLineMode' : 'smartCriticalLineMode');
    var otherPct = document.getElementById(fromSmart ? 'criticalLinePercent' : 'smartCriticalLinePercent');
    if (otherMode && modeEl) otherMode.value = mode;
    if (otherPct && pctEl) otherPct.value = pctEl.value;
    syncCriticalLineModeUi();
    if (!subject) return null;
    var gradeMeta = getCriticalGradeFloorMeta(mode);
    if (gradeMeta) {
        var batchSel = document.getElementById(fromSmart ? 'smartCriticalBatch0' : 'criticalBatch0');
        var batch0 = batchSel && batchSel.value ? DataPool.batches.find(function(b) { return b.id === batchSel.value; }) : null;
        var floorList = (batch0 && batch0.combinedStudentData) || combinedStudentData;
        var floor = getGradeFloorScore(subject, gradeMeta.label, floorList);
        if (!floor) {
            setCriticalLineHint('该科目没有 ' + gradeMeta.label + ' 学生');
            if (!silent && typeof showToast === 'function') showToast('该科目没有等级为 ' + gradeMeta.label + ' 的学生，分数线未改', 'info');
            return null;
        }
        setCriticalPassLineValue(floor.score);
        setCriticalLineHint(gradeMeta.title + '，' + floor.count + '人');
        return floor.score;
    }
    var pct = parseFloat(pctEl && pctEl.value);
    if (isNaN(pct)) pct = 60;
    pct = Math.min(100, Math.max(1, pct));
    if (pctEl) pctEl.value = pct;
    if (otherPct) otherPct.value = pct;
    var fm = getCriticalSubjectFullMark(subject);
    var line = fm * pct / 100;
    setCriticalPassLineValue(line);
    setCriticalLineHint('满分' + fm + '×' + pct + '%');
    return line;
}

function resolveCriticalPassLine() {
    var el = document.getElementById('criticalPassLine');
    var v = parseFloat(el && el.value);
    if (!isNaN(v)) return v;
    var filled = refreshCriticalPassLine({ silent: true });
    if (filled != null) return filled;
    return 60;
}

function getCriticalLineSourceLabel() {
    var el = document.getElementById('criticalLineHint');
    return el ? String(el.textContent || '').trim() : '';
}

function bindCriticalLineControls() {
    if (bindCriticalLineControls._done) return;
    bindCriticalLineControls._done = true;
    function onAuto(fromSmart) {
        return function() { refreshCriticalPassLine({ fromSmart: fromSmart }); };
    }
    ['criticalSubjectFilter', 'criticalLineMode', 'criticalLinePercent', 'criticalBatch0'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', onAuto(false));
    });
    ['smartCriticalSubjectFilter', 'smartCriticalLineMode', 'smartCriticalLinePercent', 'smartCriticalBatch0'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', onAuto(true));
    });
    var pct = document.getElementById('criticalLinePercent');
    var smartPct = document.getElementById('smartCriticalLinePercent');
    if (pct) pct.addEventListener('input', onAuto(false));
    if (smartPct) smartPct.addEventListener('input', onAuto(true));
    function onManual(fromSmart) {
        return function() {
            var src = document.getElementById(fromSmart ? 'smartCriticalPassLine' : 'criticalPassLine');
            var dst = document.getElementById(fromSmart ? 'criticalPassLine' : 'smartCriticalPassLine');
            if (src && dst) dst.value = src.value;
            setCriticalLineHint('手填');
        };
    }
    var line = document.getElementById('criticalPassLine');
    var smartLine = document.getElementById('smartCriticalPassLine');
    if (line) line.addEventListener('input', onManual(false));
    if (smartLine) smartLine.addEventListener('input', onManual(true));
    syncCriticalLineModeUi();
}

var CRITICAL_CATEGORY_META = {
    improve: { key: 'improve', label: '进步超出临界范围', short: '进步出线', color: '#8FB8B0', bg: 'rgba(143,184,176,0.38)' },
    drop: { key: 'drop', label: '落后在临界范围之下', short: '落到线外', color: '#9B1C28', bg: 'rgba(226,58,74,0.18)' },
    newIn: { key: 'newIn', label: '新进临界', short: '新进临界', color: '#1B2A4A', bg: 'rgba(196,165,116,0.42)' },
    persist: { key: 'persist', label: '持续临界', short: '持续临界', color: '#1B2A4A', bg: 'rgba(27,42,74,0.12)' }
};
var CRITICAL_CATEGORY_ORDER = ['improve', 'drop', 'newIn', 'persist'];
var CRITICAL_ALLUVIAL_THEME = {
    bg: '#ffffff',
    navy: '#1B2A4A',
    above: '#4E8B82',
    in: '#A67C3A',
    below: '#C41D32'
};
var CRITICAL_ZONE_ORDER = ['above', 'in', 'below'];
function getCriticalZoneLabel(zone) {
    if (zone === 'above') return '线上';
    if (zone === 'in') return '临界';
    if (zone === 'below') return '线外';
    return '—';
}
function getCriticalZoneColor(zone) {
    if (zone === 'above') return CRITICAL_ALLUVIAL_THEME.above;
    if (zone === 'in') return CRITICAL_ALLUVIAL_THEME.in;
    if (zone === 'below') return CRITICAL_ALLUVIAL_THEME.below;
    return CRITICAL_ALLUVIAL_THEME.navy;
}

function getCriticalBatchesNewestFirst() {
    return (DataPool.batches || []).slice().sort(function(a, b) {
        var ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        var tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
    });
}

function fillCriticalBatchSelects() {
    var batches = getCriticalBatchesNewestFirst();
    var defaults = [batches[0] ? batches[0].id : '', batches[1] ? batches[1].id : '', batches[2] ? batches[2].id : ''];
    function fillOne(selId, slot, allowEmpty) {
        var sel = document.getElementById(selId);
        if (!sel) return;
        var prev = sel.value;
        sel.innerHTML = '';
        if (allowEmpty) {
            var eo = document.createElement('option');
            eo.value = '';
            eo.textContent = '不选';
            sel.appendChild(eo);
        }
        batches.forEach(function(b) {
            var o = document.createElement('option');
            o.value = b.id;
            o.textContent = b.label + ' (' + (b.combinedStudentData || []).length + '人)';
            sel.appendChild(o);
        });
        if (prev && Array.from(sel.options).some(function(o) { return o.value === prev; })) {
            sel.value = prev;
        } else {
            sel.value = defaults[slot] || '';
        }
        if (!allowEmpty && !sel.value && batches[0]) sel.value = batches[0].id;
    }
    fillOne('criticalBatch0', 0, false);
    fillOne('criticalBatch1', 1, true);
    fillOne('criticalBatch2', 2, true);
    fillOne('smartCriticalBatch0', 0, false);
    fillOne('smartCriticalBatch1', 1, true);
    fillOne('smartCriticalBatch2', 2, true);
}

function getCriticalSelectedExamSlots() {
    var ids = [
        (document.getElementById('criticalBatch0') || {}).value || '',
        (document.getElementById('criticalBatch1') || {}).value || '',
        (document.getElementById('criticalBatch2') || {}).value || ''
    ];
    var labels = ['本次', '上次', '上上次'];
    var seen = {};
    var slots = [];
    ids.forEach(function(id, i) {
        if (!id || seen[id]) return;
        var b = DataPool.batches.find(function(x) { return x.id === id; });
        if (!b) return;
        seen[id] = true;
        slots.push({
            id: b.id,
            slotLabel: labels[i],
            label: b.label,
            students: b.combinedStudentData || []
        });
    });
    if (!slots.length && (combinedStudentData || []).length) {
        slots.push({ id: '__current__', slotLabel: '本次', label: '本次', students: combinedStudentData });
    }
    return slots;
}

function getCriticalExamPassLine(exam, subject, mode, cardLine) {
    var gradeMeta = getCriticalGradeFloorMeta(mode);
    if (gradeMeta) {
        var floor = getGradeFloorScore(subject, gradeMeta.label, exam.students);
        return floor ? floor.score : null;
    }
    return cardLine;
}

function getCriticalStudentScore(exam, name, subject) {
    var list = exam.students || [];
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].name) !== String(name)) continue;
        var sd = getSubjectDataByAlias(list[i], subject);
        if (!sd) return NaN;
        var sc = parseFloat(sd.score);
        return isNaN(sc) ? NaN : sc;
    }
    return NaN;
}

function classifyCriticalZone(score, line, range) {
    if (line == null || isNaN(Number(line)) || isNaN(score)) return null;
    var diff = score - Number(line);
    if (Math.abs(diff) <= range) return 'in';
    if (diff > range) return 'above';
    return 'below';
}

function formatCriticalScoreSlash(pt) {
    if (!pt || isNaN(pt.score)) return '-';
    if (pt.line == null || isNaN(Number(pt.line))) return Number(pt.score).toFixed(1) + ' / -';
    return Number(pt.score).toFixed(1) + ' / ' + Number(pt.line).toFixed(1);
}

function classifyCriticalStudent(points) {
    var cur = points[0];
    if (!cur || cur.zone == null) return null;
    var prev = points[1] || null;
    if (cur.zone === 'in') {
        if (prev && prev.zone === 'in') return 'persist';
        return 'newIn';
    }
    if (cur.zone === 'above') {
        var hadLower = points.slice(1).some(function(p) { return p && (p.zone === 'in' || p.zone === 'below'); });
        return hadLower ? 'improve' : null;
    }
    if (cur.zone === 'below') {
        var hadHigher = points.slice(1).some(function(p) { return p && (p.zone === 'in' || p.zone === 'above'); });
        return hadHigher ? 'drop' : null;
    }
    return null;
}

function buildCriticalAlertData(className, subject, passLine, range) {
    var mode = (document.getElementById('criticalLineMode') || {}).value || 'ratio';
    var exams = getCriticalSelectedExamSlots();
    var lineSource = getCriticalLineSourceLabel();
    var examMeta = exams.map(function(ex) {
        var line = getCriticalExamPassLine(ex, subject, mode, passLine);
        var hint = lineSource || '';
        var gradeMeta = getCriticalGradeFloorMeta(mode);
        if (gradeMeta) {
            var floor = getGradeFloorScore(subject, gradeMeta.label, ex.students);
            hint = floor ? (gradeMeta.title + '，' + floor.count + '人') : ('该次无' + gradeMeta.label);
        }
        return { id: ex.id, slotLabel: ex.slotLabel, label: ex.label, line: line, hint: hint, students: ex.students };
    });
    var currentExam = examMeta[0];
    var currentLine = currentExam && currentExam.line != null ? currentExam.line : passLine;
    var multi = examMeta.length >= 2;

    function inClass(s) { return String(s.class) === String(className); }

    if (!multi) {
        var src = (currentExam && currentExam.students) || combinedStudentData || [];
        var students = src.filter(inClass).filter(function(s) {
            var sd = getSubjectDataByAlias(s, subject);
            if (!sd) return false;
            var score = parseFloat(sd.score);
            return !isNaN(score);
        }).map(function(s) {
            var score = parseFloat(getSubjectDataByAlias(s, subject).score);
            var diff = score - currentLine;
            return { name: getStudentDisplayName(s), rawName: s.name, className: s.class, score: score, diff: diff, status: diff >= 0 ? '暂过(危险)' : '未过(预警)' };
        }).filter(function(s) { return Math.abs(s.diff) <= range; }).sort(function(a, b) { return Math.abs(a.diff) - Math.abs(b.diff); });
        return { className: className, subject: subject, passLine: currentLine, range: range, lineSource: currentExam ? currentExam.hint : lineSource, multi: false, exams: examMeta, students: students, groups: null };
    }

    var nameMap = {};
    examMeta.forEach(function(ex) {
        (ex.students || []).filter(inClass).forEach(function(s) {
            if (!s || !s.name) return;
            if (!nameMap[s.name]) nameMap[s.name] = s;
        });
    });
    var groups = { improve: [], drop: [], newIn: [], persist: [] };
    var roster = [];
    Object.keys(nameMap).forEach(function(name) {
        var stu = nameMap[name];
        var points = examMeta.map(function(ex) {
            var score = getCriticalStudentScore(ex, name, subject);
            var zone = classifyCriticalZone(score, ex.line, range);
            return {
                examId: ex.id,
                slotLabel: ex.slotLabel,
                label: ex.label,
                score: score,
                line: ex.line,
                diff: (!isNaN(score) && ex.line != null) ? (score - ex.line) : NaN,
                zone: zone
            };
        });
        if (!points.some(function(p) { return p && p.zone; })) return;
        var cat = classifyCriticalStudent(points);
        var cur = points[0] || {};
        var row = {
            name: getStudentDisplayName(stu),
            rawName: name,
            className: stu.class,
            category: cat,
            categoryLabel: cat ? CRITICAL_CATEGORY_META[cat].label : '',
            points: points,
            score: cur.score,
            diff: cur.diff,
            line: cur.line
        };
        roster.push(row);
        if (!cat) return;
        groups[cat].push(row);
    });
    CRITICAL_CATEGORY_ORDER.forEach(function(k) {
        groups[k].sort(function(a, b) {
            var da = isNaN(a.diff) ? 99 : Math.abs(a.diff);
            var db = isNaN(b.diff) ? 99 : Math.abs(b.diff);
            return da - db;
        });
    });
    var listed = [];
    CRITICAL_CATEGORY_ORDER.forEach(function(k) { listed = listed.concat(groups[k]); });
    return {
        className: className,
        subject: subject,
        passLine: currentLine,
        range: range,
        lineSource: currentExam ? currentExam.hint : lineSource,
        multi: true,
        exams: examMeta,
        students: listed,
        groups: groups,
        alluvial: buildCriticalAlluvialModel(examMeta, roster)
    };
}

function buildCriticalAlluvialModel(examMeta, rosterRows) {
    var chrono = (examMeta || []).slice().reverse();
    var nodes = [];
    var nodeMap = {};
    var links = [];
    var linkMap = {};
    chrono.forEach(function(ex, depth) {
        CRITICAL_ZONE_ORDER.forEach(function(zone) {
            var id = String(ex.id) + '|' + zone;
            var node = {
                name: id,
                depth: depth,
                examId: ex.id,
                examLabel: ex.label,
                slotLabel: ex.slotLabel,
                zone: zone,
                zoneLabel: getCriticalZoneLabel(zone),
                labelText: getCriticalZoneLabel(zone),
                students: [],
                itemStyle: { color: getCriticalZoneColor(zone), borderWidth: 0 }
            };
            nodeMap[id] = node;
            nodes.push(node);
        });
    });
    (rosterRows || []).forEach(function(row) {
        var byExam = {};
        (row.points || []).forEach(function(p) { if (p && p.examId) byExam[p.examId] = p; });
        chrono.forEach(function(ex, depth) {
            var pt = byExam[ex.id];
            if (!pt || !pt.zone) return;
            nodeMap[String(ex.id) + '|' + pt.zone].students.push(row);
            if (depth === 0) return;
            var prevEx = chrono[depth - 1];
            var prevPt = byExam[prevEx.id];
            if (!prevPt || !prevPt.zone) return;
            var key = String(prevEx.id) + '|' + prevPt.zone + '->' + String(ex.id) + '|' + pt.zone;
            if (!linkMap[key]) {
                var fromColor = getCriticalZoneColor(prevPt.zone);
                linkMap[key] = {
                    source: String(prevEx.id) + '|' + prevPt.zone,
                    target: String(ex.id) + '|' + pt.zone,
                    value: 0,
                    students: [],
                    fromZone: prevPt.zone,
                    toZone: pt.zone,
                    fromLabel: prevEx.label + ' · ' + getCriticalZoneLabel(prevPt.zone),
                    toLabel: ex.label + ' · ' + getCriticalZoneLabel(pt.zone),
                    lineStyle: { color: fromColor }
                };
                links.push(linkMap[key]);
            }
            linkMap[key].students.push(row);
            linkMap[key].value += 1;
        });
    });
    nodes.forEach(function(n) {
        n.labelText = n.zoneLabel + ' ' + n.students.length;
    });
    var kept = nodes.filter(function(n) { return n.students.length; });
    var keptNames = {};
    kept.forEach(function(n) { keptNames[n.name] = true; });
    var keptLinks = links.filter(function(l) {
        return l.value > 0 && keptNames[l.source] && keptNames[l.target];
    });
    return { exams: chrono, nodes: kept, links: keptLinks };
}

function formatCriticalAlluvialStudentHtml(rows) {
    if (!rows || !rows.length) return '暂无学生';
    return rows.map(function(s, i) {
        var chrono = (s.points || []).slice().reverse();
        var path = chrono.map(function(p) {
            var z = p.zone ? getCriticalZoneLabel(p.zone) : '—';
            return escapeHtml(p.label) + ' ' + z + ' ' + formatCriticalDiff(p.diff);
        }).join(' → ');
        var cat = s.categoryLabel ? '｜' + escapeHtml(s.categoryLabel) : '';
        return (i + 1) + '. ' + escapeHtml(s.name) + cat + '<br><span style="color:#64748b;font-size:14px;">' + path + '</span>';
    }).join('<br>');
}

function buildCriticalExamHeaders(exams) {
    return (exams || []).slice().reverse();
}

function formatCriticalDiff(diff) {
    if (diff == null || isNaN(diff)) return '-';
    return (diff >= 0 ? '+' : '') + Number(diff).toFixed(1);
}

function buildCriticalCategoryTableHtml(data, tableClass) {
    var cls = tableClass ? (' class="' + tableClass + '"') : '';
    var headers = buildCriticalExamHeaders(data.exams);
    var html = '<table' + cls + '><thead><tr><th>类型</th><th>姓名</th>';
    headers.forEach(function(ex) {
        html += '<th>' + escapeHtml(ex.slotLabel) + '<br><span style="font-weight:400;font-size:11px;">' + escapeHtml(ex.label) + '（分/线）</span></th>';
    });
    html += '<th>本次离线</th></tr></thead><tbody>';
    if (!data.students.length) {
        html += '<tr><td colspan="' + (3 + headers.length) + '">所选对比下没有四类临界变化学生</td></tr>';
    } else {
        data.students.forEach(function(s) {
            var meta = CRITICAL_CATEGORY_META[s.category] || { bg: 'transparent', color: '#1B2A4A' };
            html += '<tr><td style="font-weight:700;background:' + meta.bg + ';color:' + meta.color + ';">' + escapeHtml(s.categoryLabel) + '</td><td>' + escapeHtml(s.name) + '</td>';
            headers.forEach(function(ex) {
                var pt = null;
                (s.points || []).forEach(function(p) { if (p.examId === ex.id) pt = p; });
                html += '<td>' + formatCriticalScoreSlash(pt) + '</td>';
            });
            html += '<td>' + formatCriticalDiff(s.diff) + '</td></tr>';
        });
    }
    html += '</tbody></table>';
    return html;
}

function buildCriticalExamLineSummary(data) {
    return (data.exams || []).map(function(ex) {
        var lineTxt = (ex.line == null || isNaN(Number(ex.line))) ? '无线' : (Number(ex.line).toFixed(1) + '分');
        return ex.slotLabel + '「' + ex.label + '」' + lineTxt + (ex.hint ? '（' + ex.hint + '）' : '');
    }).join(' ｜ ');
}

function renderCriticalReadableReport() {
    var className = document.getElementById('criticalClassFilter').value;
    var subject = document.getElementById('criticalSubjectFilter').value;
    var range = parseInt(document.getElementById('criticalRange').value, 10) || 5;
    if (!className || !subject) return false;
    var data = buildCriticalAlertData(className, subject, resolveCriticalPassLine(), range);
    if (!data.multi && !data.students.length) return false;
    if (data.multi && !(data.exams && data.exams.length)) return false;
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content) return false;
    var html = [];
    html.push('<div class="comp-readable-report">');
    if (!data.multi) {
        var above = data.students.filter(function(s){ return s.diff >= 0; });
        var below = data.students.filter(function(s){ return s.diff < 0; });
        html.push('<div class="cr-cover"><div><h2>临界生预警图文报告</h2><p>围绕分数线附近学生，识别暂过风险与未过冲线对象。</p></div>');
        html.push('<div class="cr-meta"><div><b>班级：</b>' + escapeHtml(className) + '</div><div><b>科目：</b>' + escapeHtml(subject) + '</div><div><b>分数线：</b>' + Number(data.passLine).toFixed(1) + (data.lineSource ? '（' + escapeHtml(data.lineSource) + '）' : '') + '</div><div><b>范围：</b>±' + range + '分</div></div></div>');
        html.push('<div class="sr-kpis">');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">临界总人数</div><div class="sr-kpi-value">' + data.students.length + '</div></div>');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">暂过危险</div><div class="sr-kpi-value">' + above.length + '</div></div>');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">未过预警</div><div class="sr-kpi-value">' + below.length + '</div></div>');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">最近距离</div><div class="sr-kpi-value">' + Math.abs(data.students[0].diff).toFixed(1) + '</div></div>');
        html.push('</div>');
        html.push('<div class="sr-section"><h3>一、临界距离与结构</h3><div class="sr-grid">');
        html.push('<div id="criticalReportDistanceChart" class="sr-chart sr-chart-wide"></div>');
        html.push('<div id="criticalReportStatusChart" class="sr-chart sr-chart-large"></div>');
        html.push('</div></div>');
        html.push('<div class="sr-section"><h3>二、临界生名单</h3><table class="sr-table"><thead><tr><th>姓名</th><th>分数</th><th>距离线</th><th>状态</th></tr></thead><tbody>');
        data.students.forEach(function(s) { html.push('<tr><td>' + escapeHtml(s.name) + '</td><td>' + s.score.toFixed(1) + '</td><td>' + formatCriticalDiff(s.diff) + '</td><td>' + s.status + '</td></tr>'); });
        html.push('</tbody></table></div></div>');
    } else {
        var g = data.groups || { improve: [], drop: [], newIn: [], persist: [] };
        html.push('<div class="cr-cover"><div><h2>临界生预警图文报告</h2><p>看全班从线上、临界到线外的流向。点击色带或节点可查看姓名。</p></div>');
        html.push('<div class="cr-meta"><div><b>班级：</b>' + escapeHtml(className) + '</div><div><b>科目：</b>' + escapeHtml(subject) + '</div><div><b>临界带：</b>±' + range + '分</div><div><b>各次分数线：</b>' + escapeHtml(buildCriticalExamLineSummary(data)) + '</div></div></div>');
        html.push('<div class="sr-kpis">');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">进步出线</div><div class="sr-kpi-value">' + g.improve.length + '</div></div>');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">落到线外</div><div class="sr-kpi-value">' + g.drop.length + '</div></div>');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">新进临界</div><div class="sr-kpi-value">' + g.newIn.length + '</div></div>');
        html.push('<div class="sr-kpi"><div class="sr-kpi-label">持续临界</div><div class="sr-kpi-value">' + g.persist.length + '</div></div>');
        html.push('</div>');
        html.push('<div class="sr-section"><h3>一、全班流向（线上 / 临界 / 线外）</h3>');
        html.push('<div id="criticalAlluvialChart" class="sr-alluvial-chart"></div></div>');
        html.push('<div class="sr-section"><h3>二、四类名单（各次分 / 该次线）</h3>');
        html.push(buildCriticalCategoryTableHtml(data, 'sr-table'));
        html.push('</div></div>');
    }
    content.innerHTML = html.join('');
    output.dataset.backTarget = 'criticalOutput';
    output.dataset.printTitle = ['临界生预警图文报告', className, subject, getTodayString()].filter(Boolean).join('_');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderCriticalReadableCharts(data);
    return true;
}

function renderCriticalTrackChart(elId, title, rows, range) {
    var el = document.getElementById(elId);
    if (!el || typeof echarts === 'undefined') return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    if (!rows || !rows.length) {
        chart.setOption({ title: { text: title + '：暂无学生', left: 'center', top: 'middle', textStyle: { fontSize: 13, color: '#64748b' } } });
        return;
    }
    var chrono = rows[0].points.slice().reverse();
    var xLabels = chrono.map(function(p) { return p.slotLabel; });
    var yAbs = [range + 2];
    var series = rows.map(function(s, i) {
        var pts = s.points.slice().reverse();
        pts.forEach(function(p) { if (!isNaN(p.diff)) yAbs.push(Math.abs(p.diff)); });
        return {
            name: s.name,
            type: 'line',
            data: pts.map(function(p) { return isNaN(p.diff) ? null : Number(p.diff.toFixed(1)); }),
            smooth: false,
            symbol: 'circle',
            symbolSize: 8,
            color: getSmartChartColor(i),
            lineStyle: { width: 2 },
            connectNulls: false
        };
    });
    var yMax = Math.max(Math.ceil(Math.max.apply(null, yAbs)), range + 1);
    var studentNames = rows.map(function(s) { return s.name; });
    chart.setOption({
        title: getReportChartTitle(title),
        tooltip: Object.assign(getReportTooltip(), { trigger: 'axis', axisPointer: { type: 'line' } }),
        legend: { type: 'scroll', bottom: 4, left: 'center', width: '90%', data: studentNames, textStyle: { fontSize: 10, color: REPORT_CHART_THEME.axis } },
        grid: getReportChartGrid(56, 28, 42, 72),
        xAxis: Object.assign(getReportCategoryAxis(xLabels), {
            boundaryGap: true,
            axisLabel: Object.assign(getReportAxisLabel(), { interval: 0, margin: 8, hideOverlap: true })
        }),
        yAxis: Object.assign(getReportValueAxis('分差'), {
            min: -yMax,
            max: yMax,
            nameLocation: 'middle',
            nameGap: 38,
            nameTextStyle: { color: REPORT_CHART_THEME.axis, fontWeight: 700, fontSize: 11 }
        }),
        series: series.concat([{
            name: '临界带',
            type: 'line',
            data: [],
            silent: true,
            tooltip: { show: false },
            legendHoverLink: false,
            showSymbol: false,
            markLine: {
                silent: true,
                symbol: 'none',
                label: { show: false },
                data: [{ yAxis: 0 }],
                lineStyle: { color: REPORT_CHART_THEME.slate, type: 'solid', width: 1 }
            },
            markArea: {
                silent: true,
                itemStyle: { color: 'rgba(242,142,43,0.14)' },
                data: [[{ yAxis: -range }, { yAxis: range }]]
            }
        }])
    });
}

function renderCriticalAlluvialChart(data) {
    var el = document.getElementById('criticalAlluvialChart');
    if (!el || typeof echarts === 'undefined') return;
    var chart = AppCore.charts.init(el, null, { renderer: 'svg' });
    var model = (data && data.alluvial) || { exams: [], nodes: [], links: [] };
    if (!model.nodes.length) {
        chart.setOption({
            backgroundColor: CRITICAL_ALLUVIAL_THEME.bg,
            title: { text: '暂无有效分数，无法绘制流向', left: 'center', top: 'middle', textStyle: { fontSize: 14, color: CRITICAL_ALLUVIAL_THEME.navy } }
        });
        return;
    }
    var exams = model.exams || [];
    var n = exams.length;
    var graphics = exams.map(function(ex, i) {
        var item = {
            type: 'text',
            top: 10,
            bounding: 'raw',
            style: {
                text: ex.label,
                fill: CRITICAL_ALLUVIAL_THEME.navy,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: AppCore.FONT
            }
        };
        if (n <= 1) item.left = 'center';
        else if (i === n - 1) item.right = '8%';
        else if (i === 0) item.left = '8%';
        else item.left = (8 + i * (84 / Math.max(n - 1, 1))) + '%';
        return item;
    });
    chart.setOption({
        backgroundColor: CRITICAL_ALLUVIAL_THEME.bg,
        tooltip: {
            trigger: 'item',
            formatter: function(p) {
                if (p.dataType === 'node' && p.data) {
                    return escapeHtml(p.data.examLabel) + ' · ' + p.data.zoneLabel + '：' + (p.data.students || []).length + '人<br>点击查看名单';
                }
                if (p.dataType === 'edge' && p.data) {
                    return escapeHtml(p.data.fromLabel) + ' → ' + escapeHtml(p.data.toLabel) + '：' + p.data.value + '人<br>点击查看名单';
                }
                return '';
            }
        },
        legend: { show: false },
        graphic: graphics,
        series: [{
            type: 'sankey',
            orient: 'horizontal',
            layoutIterations: 0,
            sort: null,
            draggable: false,
            nodeAlign: 'justify',
            nodeGap: 18,
            nodeWidth: 16,
            left: '8%',
            right: '8%',
            top: 42,
            bottom: 12,
            data: model.nodes,
            links: model.links,
            lineStyle: { color: 'source', curveness: 0.5, opacity: 0.52 },
            itemStyle: { borderWidth: 0 },
            label: {
                color: CRITICAL_ALLUVIAL_THEME.navy,
                fontSize: 12,
                fontWeight: 600,
                formatter: function(p) { return (p.data && p.data.labelText) || p.name; }
            },
            emphasis: {
                focus: 'adjacency',
                lineStyle: { opacity: 0.75 }
            }
        }]
    });
    chart.off('click');
    chart.on('click', function(params) {
        if (params.dataType === 'node' && params.data && params.data.students) {
            showStudentListModal(
                params.data.examLabel + ' · ' + params.data.zoneLabel + '（' + params.data.students.length + '人）',
                formatCriticalAlluvialStudentHtml(params.data.students)
            );
            return;
        }
        if (params.dataType === 'edge' && params.data && params.data.students) {
            showStudentListModal(
                params.data.fromLabel + ' → ' + params.data.toLabel + '（' + params.data.value + '人）',
                formatCriticalAlluvialStudentHtml(params.data.students)
            );
        }
    });
}

function renderCriticalReadableCharts(data) {
    if (typeof echarts === 'undefined') return;
    if (data.multi) {
        renderCriticalAlluvialChart(data);
        return;
    }
    var distEl = document.getElementById('criticalReportDistanceChart');
    if (distEl) {
        var distChart = AppCore.charts.init(distEl, null, { renderer: 'svg' });
        var ordered = data.students.slice().sort(function(a,b){ return a.diff - b.diff; });
        distChart.setOption({ title: getReportChartTitle('临界生距离分数线'), tooltip: getReportTooltip(), grid: getReportChartGrid(76, 48, 54, 36), xAxis: getReportValueAxis('距离线分差'), yAxis: getReportCategoryAxis(ordered.map(function(s){ return s.name; })), series: [{ type: 'bar', data: ordered.map(function(s){ return { value: Number(s.diff.toFixed(1)), itemStyle: { color: s.diff >= 0 ? REPORT_CHART_THEME.orange : REPORT_CHART_THEME.red } }; }), barMaxWidth: 22, itemStyle: { borderRadius: [0,7,7,0] }, label: { show: true, position: 'right', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700, formatter: function(p){ return (p.value >= 0 ? '+' : '') + p.value; } }, markLine: { symbol: 'none', data: [{ xAxis: 0 }], lineStyle: { color: REPORT_CHART_THEME.slate, type: 'dashed' } } }] });
    }
    var statusEl = document.getElementById('criticalReportStatusChart');
    if (statusEl) {
        var statusChart = AppCore.charts.init(statusEl, null, { renderer: 'svg' });
        var above = data.students.filter(function(s){ return s.diff >= 0; }).length;
        var below = data.students.length - above;
        statusChart.setOption(getReportPieOption('临界状态结构', [{ name: '暂过危险', value: above }, { name: '未过预警', value: below }], [REPORT_CHART_THEME.orange, REPORT_CHART_THEME.red]));
    }
}

function buildCorrelationReportData() {
    var className = document.getElementById('corrClassFilter').value;
    var xSubj = document.getElementById('corrXSubject').value;
    var ySubj = document.getElementById('corrYSubject').value;
    var balanceThreshold = parseInt(document.getElementById('corrBalanceThreshold').value, 10) || 20;
    if (!xSubj || !ySubj || xSubj === ySubj) return null;
    var students = className === '__all__' ? combinedStudentData : combinedStudentData.filter(function(s) { return String(s.class) === className; });
    var points = [];
    students.forEach(function(s) {
        var xSd = getSubjectDataByAlias(s, xSubj), ySd = getSubjectDataByAlias(s, ySubj);
        if (!xSd || !ySd) return;
        var xRank = parseInt(xSd.gradeRank, 10), yRank = parseInt(ySd.gradeRank, 10);
        if (isNaN(xRank) || isNaN(yRank) || xRank <= 0 || yRank <= 0) return;
        var diff = yRank - xRank;
        var absDiff = Math.abs(diff);
        points.push({ name: getStudentDisplayName(s), className: s.class, x: xRank, y: yRank, diff: diff, absDiff: absDiff, weakSubject: diff > 0 ? ySubj : (diff < 0 ? xSubj : '均衡'), level: absDiff <= balanceThreshold ? '均衡' : (absDiff <= balanceThreshold * 2 ? '轻微偏科' : '严重偏科') });
    });
    if (!points.length) return null;
    var n = points.length, sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    points.forEach(function(p) { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x; sumY2 += p.y * p.y; });
    var denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    var r = denom > 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    return { className: className, xSubj: xSubj, ySubj: ySubj, threshold: balanceThreshold, points: points, r: r };
}

function renderCorrelationReadableReport() {
    var data = buildCorrelationReportData();
    if (!data) return false;
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content) return false;
    var top = data.points.filter(function(p){ return p.level !== '均衡'; }).sort(function(a,b){ return b.absDiff - a.absDiff; }).slice(0, 10);
    var groups = { '均衡': 0, '轻微偏科': 0, '严重偏科': 0 };
    var weakGroups = {};
    data.points.forEach(function(p) { groups[p.level] = (groups[p.level] || 0) + 1; if (p.weakSubject !== '均衡') weakGroups[p.weakSubject] = (weakGroups[p.weakSubject] || 0) + 1; });
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>学科关联分析图文报告</h2><p>用排名散点、偏科指数和分组统计识别学科结构风险。</p></div>');
    html.push('<div class="cr-meta"><div><b>范围：</b>' + escapeHtml(data.className === '__all__' ? '全部班级' : data.className) + '</div><div><b>横轴：</b>' + escapeHtml(data.xSubj) + '</div><div><b>纵轴：</b>' + escapeHtml(data.ySubj) + '</div><div><b>均衡阈值：</b>≤' + data.threshold + '名</div></div></div>');
    html.push('<div class="sr-kpis">');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">参考人数</div><div class="sr-kpi-value">' + data.points.length + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">相关系数 r</div><div class="sr-kpi-value">' + (isNaN(data.r) ? '-' : data.r.toFixed(3)) + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">轻微偏科</div><div class="sr-kpi-value">' + groups['轻微偏科'] + '</div></div>');
    html.push('<div class="sr-kpi"><div class="sr-kpi-label">严重偏科</div><div class="sr-kpi-value">' + groups['严重偏科'] + '</div></div>');
    html.push('</div>');
    html.push('<div class="sr-section"><h3>一、关联散点与偏科结构</h3>');
    html.push('<div id="corrReportScatterChart" class="sr-chart sr-chart-wide"></div>');
    html.push('<table class="sr-table" style="margin-top:12px;"><thead><tr><th>姓名</th><th>班级</th><th>' + escapeHtml(data.xSubj) + '排名</th><th>' + escapeHtml(data.ySubj) + '排名</th><th>偏科指数</th><th>偏弱科目</th><th>程度</th></tr></thead><tbody>');
    top.forEach(function(p) { var color = p.level === '严重偏科' ? getSemanticChartColor('严重') : getSemanticChartColor('轻微'); html.push('<tr><td style="font-weight:700;color:' + color + ';">' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.className) + '</td><td>' + p.x + '</td><td>' + p.y + '</td><td>' + (p.diff > 0 ? '+' : '') + p.diff + '</td><td>' + escapeHtml(p.weakSubject) + '</td><td>' + p.level + '</td></tr>'); });
    if (!top.length) html.push('<tr><td colspan="7">暂无超出阈值的明显偏科学生</td></tr>');
    html.push('</tbody></table>');
    html.push('<div class="sr-grid" style="margin-top:12px;"><div id="corrReportLevelChart" class="sr-chart sr-chart-large"></div><div id="corrReportWeakChart" class="sr-chart sr-chart-large"></div></div></div>');
    html.push('<div class="sr-section"><h3>二、偏科程度 Top10</h3><div id="corrReportTopChart" class="sr-chart sr-chart-wide"></div>');
    html.push('</div></div>');
    content.innerHTML = html.join('');
    output.dataset.backTarget = 'corrOutput';
    output.dataset.printTitle = ['学科关联分析图文报告', data.className === '__all__' ? '全部班级' : data.className, data.xSubj + '-' + data.ySubj, getTodayString()].filter(Boolean).join('_');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderCorrelationReadableCharts(data, top, groups, weakGroups);
    return true;
}

function formatCorrStudentModalHtml(rows, xSubj, ySubj) {
    return (rows || []).map(function(p, i) {
        var diffStr = (p.diff > 0 ? '+' : '') + p.diff;
        var weak = p.weakSubject && p.weakSubject !== '均衡' ? (p.weakSubject + '较弱') : '均衡';
        return (i + 1) + '. ' + escapeHtml(p.name)
            + '｜' + escapeHtml(p.className || '')
            + '｜' + escapeHtml(xSubj) + '第' + p.x + '名'
            + '｜' + escapeHtml(ySubj) + '第' + p.y + '名'
            + '｜偏科指数' + diffStr
            + '｜' + escapeHtml(weak)
            + '｜' + escapeHtml(p.level || '');
    }).join('<br>');
}

function showCorrStudentList(title, rows, xSubj, ySubj) {
    if (!rows || !rows.length) return;
    showStudentListModal(title + ' 共' + rows.length + '人', formatCorrStudentModalHtml(rows, xSubj, ySubj));
}

function bindCorrChartClick(chart, handler) {
    if (!chart) return;
    chart.off('click');
    chart.on('click', handler);
}

function renderCorrelationReadableCharts(data, top, groups, weakGroups) {
    if (typeof echarts === 'undefined') return;
    var xSubj = data.xSubj, ySubj = data.ySubj, threshold = data.threshold;
    var scatterEl = document.getElementById('corrReportScatterChart');
    if (scatterEl && data && data.points && data.points.length) {
        var sChart = AppCore.charts.init(scatterEl, null, { renderer: 'svg' });
        var maxRank = 0;
        data.points.forEach(function(p) { maxRank = Math.max(maxRank, p.x, p.y); });
        var maxVal = Math.ceil((maxRank + 20) / 10) * 10;
        var balanced = [], mild = [], severe = [];
        data.points.forEach(function(p) {
            var entry = { value: [p.x, p.y], name: p.name, diff: p.diff, className: p.className, level: p.level, weakSubject: p.weakSubject, x: p.x, y: p.y };
            if (p.level === '均衡') balanced.push(entry);
            else if (p.level === '轻微偏科') mild.push(entry);
            else severe.push(entry);
        });
        sChart.setOption({
            title: getReportChartTitle(data.className === '__all__' ? '全部班级' : data.className + ' ' + xSubj + ' vs ' + ySubj + ' 散点图'),
            tooltip: { trigger: 'item', formatter: function(params) {
                if (!params || !params.data || !params.data.value) return '';
                var d = params.data;
                var weakSubj = d.diff > 0 ? ySubj : xSubj;
                return '<b>' + d.name + '</b><br/>' + xSubj + ': <b>' + d.value[0] + '</b><br/>' + ySubj + ': <b>' + d.value[1] + '</b><br/>偏科指数: ' + (d.diff > 0 ? '+' : '') + d.diff + ' (' + weakSubj + '较弱)';
            }},
            legend: { data: ['均衡', '轻微偏科', '严重偏科'], top: 28, left: 'center', textStyle: { fontSize: 12 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
            xAxis: { type: 'value', name: xSubj + ' / 年级排名', nameLocation: 'center', nameGap: 35, min: 0, max: maxVal, axisLabel: { fontSize: 11 }, nameTextStyle: { fontSize: 13, fontWeight: 'bold' }, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#eee' } } },
            yAxis: { type: 'value', name: ySubj + ' / 年级排名', nameLocation: 'center', nameGap: 40, min: 0, max: maxVal, axisLabel: { fontSize: 11 }, nameTextStyle: { fontSize: 13, fontWeight: 'bold' }, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#eee' } } },
            color: [getSemanticChartColor('均衡'), getSemanticChartColor('轻微'), getSemanticChartColor('严重')],
            series: [
                { type: 'scatter', name: '均衡', data: balanced.length ? balanced : [{}], symbolSize: 11, cursor: 'pointer', itemStyle: { color: getSemanticChartColor('均衡') }, markLine: { silent: true, symbol: 'none', data: [
                    [{ coord: [0, 0], lineStyle: { color: '#6366f1', type: 'solid', width: 1.5 } }, { coord: [maxVal, maxVal], lineStyle: { color: '#6366f1', type: 'solid', width: 1.5 } }],
                    [{ coord: [0, threshold], lineStyle: { color: '#22c55e', type: 'dashed', width: 1 } }, { coord: [Math.max(0, maxVal - threshold), maxVal], lineStyle: { color: '#22c55e', type: 'dashed', width: 1 } }],
                    [{ coord: [threshold, 0], lineStyle: { color: '#22c55e', type: 'dashed', width: 1 } }, { coord: [maxVal, Math.max(0, maxVal - threshold)], lineStyle: { color: '#22c55e', type: 'dashed', width: 1 } }]
                ]}},
                { type: 'scatter', name: '轻微偏科', data: mild, symbolSize: 11, cursor: 'pointer', itemStyle: { color: getSemanticChartColor('轻微') } },
                { type: 'scatter', name: '严重偏科', data: severe, symbolSize: 11, cursor: 'pointer', itemStyle: { color: getSemanticChartColor('严重') } }
            ],
            grid: { left: 65, right: 25, top: 62, bottom: 60 }
        });
        bindCorrChartClick(sChart, function(params) {
            if (!params || !params.seriesName) return;
            if (params.data && params.data.name) {
                showCorrStudentList(params.data.name, [params.data], xSubj, ySubj);
                return;
            }
            var matched = data.points.filter(function(p) { return p.level === params.seriesName; });
            showCorrStudentList(params.seriesName, matched, xSubj, ySubj);
        });
        sChart.resize();
    }
    var levelEl = document.getElementById('corrReportLevelChart');
    if (levelEl) {
        var levelChart = AppCore.charts.init(levelEl, null, { renderer: 'svg' });
        var levelOption = getReportPieOption('偏科程度结构', [{ name: '均衡', value: groups['均衡'] }, { name: '轻微偏科', value: groups['轻微偏科'] }, { name: '严重偏科', value: groups['严重偏科'] }], [getSemanticChartColor('均衡'), getSemanticChartColor('轻微'), getSemanticChartColor('严重')]);
        levelOption.series[0].cursor = 'pointer';
        levelChart.setOption(levelOption);
        bindCorrChartClick(levelChart, function(params) {
            if (!params || !params.name) return;
            var matched = data.points.filter(function(p) { return p.level === params.name; });
            showCorrStudentList(params.name, matched, xSubj, ySubj);
        });
    }
    var weakEl = document.getElementById('corrReportWeakChart');
    if (weakEl) {
        var weakChart = AppCore.charts.init(weakEl, null, { renderer: 'svg' });
        var weakData = Object.keys(weakGroups).map(function(k){ return { name: k, value: weakGroups[k] }; });
        var weakOption = getReportPieOption('偏弱科目分布', weakData, weakData.map(function(d, i) { return getSubjectChartColor(d.name, i); }));
        if (weakOption.series && weakOption.series[0]) weakOption.series[0].cursor = 'pointer';
        weakChart.setOption(weakOption);
        bindCorrChartClick(weakChart, function(params) {
            if (!params || !params.name) return;
            var matched = data.points.filter(function(p) { return p.weakSubject === params.name; });
            showCorrStudentList(params.name + '较弱', matched, xSubj, ySubj);
        });
    }
    var topEl = document.getElementById('corrReportTopChart');
    if (topEl) {
        var topChart = AppCore.charts.init(topEl, null, { renderer: 'svg' });
        if (!top.length) { topChart.setOption({ title: { text: '偏科程度 Top10：暂无超出阈值学生', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
        var ordered = top.slice().reverse();
        topChart.setOption({
            title: getReportChartTitle('偏科程度 Top10'),
            tooltip: getReportTooltip(),
            grid: getReportChartGrid(76, 56, 54, 36),
            xAxis: getReportValueAxis('排名差'),
            yAxis: getReportCategoryAxis(ordered.map(function(p){ return p.name; })),
            series: [{ type: 'bar', cursor: 'pointer', data: ordered.map(function(p){ return { value: p.absDiff, itemStyle: { color: p.level === '严重偏科' ? getSemanticChartColor('严重') : getSemanticChartColor('轻微') } }; }), barMaxWidth: 22, itemStyle: { borderRadius: [0,7,7,0] }, label: { show: true, position: 'right', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700, formatter: '{c}名' } }]
        });
        bindCorrChartClick(topChart, function(params) {
            if (!params || params.dataIndex == null) return;
            var p = ordered[params.dataIndex];
            if (!p) return;
            showCorrStudentList(p.name, [p], xSubj, ySubj);
        });
    }
}

function buildSeatingReadableData(className) {
    var saved=seatingModuleInstance?.className===className ? seatingModuleInstance : seatingStore.peek(className)?.latest;
    var profiles = buildSeatingProfiles(className,saved?.advancedSettings?.academic);
    if (!profiles.length) return null;
    var students = profiles.map(function(p) { return {name:p.name,rank:p.totalRank,percentile:p.totalPercentile,sampleCount:p.sampleCount,tier:p.tier,leads:p.leads || [],weaks:p.weaks || [],biased:p.biased,subjects:p.subjects}; });
    var byName=new Map(students.map(function(s){return [s.name,s];})),seatMap;
    if(saved?.seatMap)seatMap=saved.seatMap.map(function(name,i){return saved.seatIds?.[i]===null?{absent:true}:name==='🚫'?{blocked:true}:byName.get(name) || null;});
    else {
        seatMap=new Array(Math.max(Math.ceil(students.length/8)*8,8)).fill(null);
        students.forEach(function(s,i){var row=Math.floor(i/8),col=i%8;seatMap[row*8+(row%2===0?col:7-col)]=s;});
    }
    var tierCounts = Object.fromEntries(['L1','L2','L3','L4','L5','L6','L7','L8','数据不足'].map(function(t){return [t,0];}));
    students.forEach(function(s){ if (tierCounts[s.tier] != null) tierCounts[s.tier]++; });
    var metrics=null,context=null;try{var state=SeatingData.reconcile(profiles,saved || null);context=SeatingEngine.prepare(state.students,seatMap.map(function(s){return s?.blocked?'🚫':s?.name || null;}),Object.assign({groupSize:6},saved?.advancedSettings,{seatIds:saved?.seatIds}));metrics=SeatingEngine.evaluate(context,context.original);}catch(_){}
    var helpLinks = [];
    var subjectCounts = {};
    for (var i = 0; i < seatMap.length; i++) {
        if (i % 2 !== 0) continue;
        var a = seatMap[i], b = seatMap[i + 1];
        if (!a || !b || a.absent || b.absent || a.blocked || b.blocked || !context?.allowed[context.original[i]*context.n+context.original[i+1]]) continue;
        var subjects=SeatingData.complementDetails(a,b).map(function(d){return d.subject+':'+d.helper+'帮'+d.recipient;});
        if (subjects.length) {
            helpLinks.push({ a: a.name, b: b.name, subjects: subjects });
            subjects.forEach(function(x){ var sn = x.split(':')[0]; subjectCounts[sn] = (subjectCounts[sn] || 0) + 1; });
        }
    }
    return {scopeLabel:profiles[0].scopeLabel,examLabels:profiles[0].examLabels,metrics:metrics, className: className, students: students, seatMap: seatMap, rows: Math.ceil(seatMap.length / 8), tierCounts: tierCounts, helpLinks: helpLinks, subjectCounts: subjectCounts,actualPlacement:!!saved };
}

function renderSeatingReadableReport(className) {
    var data = buildSeatingReadableData(className);
    if (!data) return false;
    var output = document.getElementById('comprehensiveReadableReportOutput');
    var content = document.getElementById('comprehensiveReadableReportContent');
    if (!output || !content) return false;
    var html = [];
    html.push('<div class="comp-readable-report">');
    html.push('<div class="cr-cover"><div><h2>座位优化图文报告</h2><p>' + (data.actualPlacement ? '采用已保存的实际排位。' : '尚无已保存排位，以下为所选考试平均位置蛇形分布示例。') + '学科帮助按单科层差≥1且位置差≥10个百分点识别；总分层差≤2，缺失成绩不计。</p></div>');
    html.push('<div class="cr-meta"><div><b>成绩口径：</b>'+escapeHtml(data.scopeLabel)+'</div><div><b>考试：</b>'+escapeHtml(data.examLabels.join(' / '))+'</div><div><b>班级：</b>' + escapeHtml(className) + '</div><div><b>人数：</b>' + data.students.length + '</div><div><b>座位：</b>' + data.rows + '行 × 8列</div><div><b>帮扶关系：</b>' + data.helpLinks.length + '组</div></div></div>');
    if(data.metrics){var m=data.metrics;html.push('<p>双向互补 '+m.dual+' 对；单向帮助 '+m.oneWay+' 对；无互补高＋高 '+m.highCrowding+' 对、低＋低 '+m.lowCrowding+' 对、混搭 '+m.mixed+' 对；本组高分覆盖 '+m.own+'/'+m.activeGroups+' 组；左右高分强化 '+m.horizontal+' 对（近邻 '+m.horizontalClose+' 对），上下强化 '+m.vertical+' 对（近邻 '+m.verticalClose+' 对）。每组最多参与一次强化；学科帮助优先于无互补混搭，本组覆盖优先于邻组强化。</p>');}
    html.push('<div class="sr-kpis">');
    Object.keys(data.tierCounts).forEach(function(t){ html.push('<div class="sr-kpi"><div class="sr-kpi-label">' + t + '</div><div class="sr-kpi-value">' + data.tierCounts[t] + '</div></div>'); });
    html.push('</div>');
    html.push('<div class="sr-section"><h3>一、'+(data.actualPlacement?'当前座位表':'座位示例')+'</h3>' + renderSeatingReadableGrid(data) + '</div>');
    html.push('<div class="sr-section"><h3>二、分层与帮扶科目</h3><div class="sr-grid"><div id="seatingReportTierChart" class="sr-chart sr-chart-large"></div><div id="seatingReportHelpChart" class="sr-chart sr-chart-large"></div></div></div>');
    html.push('<div class="sr-section"><h3>三、推荐同桌帮扶关系</h3><table class="sr-table"><thead><tr><th>学生A</th><th>学生B</th><th>互帮科目/方向</th></tr></thead><tbody>');
    data.helpLinks.slice(0, 20).forEach(function(l){ html.push('<tr><td>' + escapeHtml(l.a) + '</td><td>' + escapeHtml(l.b) + '</td><td>' + escapeHtml(l.subjects.join('、')) + '</td></tr>'); });
    if (!data.helpLinks.length) html.push('<tr><td colspan="3">暂无明显同桌学科互补关系</td></tr>');
    html.push('</tbody></table></div></div>');
    content.innerHTML = html.join('');
    output.dataset.backTarget = 'comprehensiveOutput';
    output.dataset.printTitle = ['座位优化图文报告', className, getTodayString()].filter(Boolean).join('_');
    document.getElementById('comprehensiveOutput').style.display = 'none';
    document.getElementById('progressOutput').style.display = 'none';
    document.getElementById('criticalOutput').style.display = 'none';
    document.getElementById('corrOutput').style.display = 'none';
    hideStudentReadableReport();
    document.getElementById('comprehensivePlaceholder').style.display = 'none';
    output.style.display = 'block';
    renderSeatingReadableCharts(data);
    return true;
}

function renderSeatingReadableGrid(data) {
    var colors = {L1:'#dbeafe',L2:'#dce4ff',L3:'#d4ecff',L4:'#e0f2fe',L5:'#fef9c3',L6:'#ffedd5',L7:'#fee2e2',L8:'#fecaca'};
    var html = '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-top:10px;">';
    data.seatMap.forEach(function(s, idx) {
        if(s?.absent){html+='<div aria-hidden="true"></div>';return;}
        if(s?.blocked){html+='<div style="min-height:58px;border:1px solid #cbd5e1;border-radius:8px;background:#e2e8f0;display:grid;place-items:center;">禁用</div>';return;}
        if (!s) { html += '<div style="min-height:58px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;"></div>'; return; }
        html += '<div style="min-height:58px;border:1px solid #cbd5e1;border-radius:8px;background:' + (colors[s.tier] || '#fff') + ';padding:6px;text-align:center;font-size:11px;"><div style="font-weight:800;color:#0f172a;">' + escapeHtml(s.name) + '</div><div>' + escapeHtml(s.tier) + '</div><div style="color:#64748b;">' + (Number.isFinite(s.percentile) ? s.percentile.toFixed(1)+'% · '+s.sampleCount+'次' : '数据不足') + '</div></div>';
    });
    html += '</div><div style="text-align:center;margin-top:8px;color:#64748b;font-size:12px;">讲台</div>';
    return html;
}

function renderSeatingReadableCharts(data) {
    if (typeof echarts === 'undefined') return;
    var tierEl = document.getElementById('seatingReportTierChart');
    if (tierEl) {
        var tierChart = AppCore.charts.init(tierEl, null, { renderer: 'svg' });
        tierChart.setOption(getReportPieOption('学生分层结构', Object.keys(data.tierCounts).map(function(t){ return { name: t, value: data.tierCounts[t] }; }), [REPORT_CHART_THEME.green, REPORT_CHART_THEME.blue, REPORT_CHART_THEME.orange, REPORT_CHART_THEME.red, '#94a3b8']));
        tierChart.off('click');
        tierChart.on('click', function(params) {
            if (!params || !params.name) return;
            var tier = params.name;
            var matched = data.students.filter(function(s) { return s.tier === tier; });
            if (!matched.length) return;
            var titleText = '学生分层结构 - ' + tier + ' 共' + matched.length + '人';
            var html = matched.map(function(s, i) {
                return (i+1) + '. ' + escapeHtml(s.name) + ' （' + (s.rank ? s.rank+'名' : '数据不足') + '）';
            }).join('<br>');
            showStudentListModal(titleText, html);
        });
    }
    var helpEl = document.getElementById('seatingReportHelpChart');
    if (helpEl) {
        var helpChart = AppCore.charts.init(helpEl, null, { renderer: 'svg' });
        var subjects = Object.keys(data.subjectCounts).sort(function(a,b){ return data.subjectCounts[b] - data.subjectCounts[a]; });
        if (!subjects.length) { helpChart.setOption({ title: { text: '帮扶科目统计：暂无互补关系', left: 'center', textStyle: { fontSize: 13, color: '#64748b' } } }); return; }
        helpChart.setOption({ title: getReportChartTitle('帮扶科目统计'), tooltip: getReportTooltip(), grid: getReportChartGrid(42, 28, 54, 42), xAxis: getReportCategoryAxis(subjects), yAxis: getReportValueAxis('次数'), series: [{ type: 'bar', data: subjects.map(function(sn){ return data.subjectCounts[sn]; }), color: REPORT_CHART_THEME.purple, barMaxWidth: 28, itemStyle: { borderRadius: [7,7,0,0] }, label: { show: true, position: 'top', color: REPORT_CHART_THEME.text, fontSize: 11, fontWeight: 700 } }] });
        helpChart.off('click');
        helpChart.on('click', function(params) {
            if (!params || !params.name) return;
            var subject = params.name;
            var matched = data.helpLinks.filter(function(l) {
                return l.subjects.some(function(s) { return s.indexOf(subject + ':') === 0; });
            });
            if (!matched.length) return;
            var titleText = '帮扶科目 - ' + subject + ' 共' + matched.length + '组';
            var html = matched.map(function(l, i) {
                var detail = l.subjects.filter(function(s) { return s.indexOf(subject + ':') === 0; }).join('、');
                return (i+1) + '. ' + escapeHtml(l.a) + ' ↔ ' + escapeHtml(l.b) + '<br>&nbsp;&nbsp;&nbsp;' + escapeHtml(detail);
            }).join('<br>');
            showStudentListModal(titleText, html);
        });
    }
}
