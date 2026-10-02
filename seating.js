/* 座位管理：数据模型、交互布局、快照保存和事件绑定。
 * Classic script: reads the shared data pool only when an analysis is invoked.
 */
// ============================================================
//  座位 — 数据构建
// ============================================================
function buildSeatingProfiles(className) {
    var students = combinedStudentData.filter(function(s) { return String(s.class) === className; });
    if (students.length < 4) return [];
    var anchorSN = getTotalSubjectName(allSubjectHeaders, combinedStudentData);
    var totalPop = 100;
    if (anchorSN) { var afl = combinedStudentData.filter(function(s) { return s.subjects[anchorSN] && validateSubjectScore(s.subjects[anchorSN]); }); totalPop = afl.length || 100; }
    var allSubjNames = new Set();
    students.forEach(function(s) { Object.keys(s.subjects).forEach(function(sn) { if (sn !== anchorSN) allSubjNames.add(sn); }); });
    var subjNames = Array.from(allSubjNames).sort();
    var profiles = [];
    students.forEach(function(s) {
        var ts = s.subjects[anchorSN];
        var totalRank = ts ? (parseInt(ts.gradeRank, 10) || parseInt(ts.schoolRank, 10) || 999) : 999;
        var totalScore = ts ? (parseFloat(ts.score) || 0) : 0;
        var leads = [], weaks = [];
        subjNames.forEach(function(sn) { var sd = s.subjects[sn]; var r = sd ? (parseInt(sd.gradeRank, 10) || parseInt(sd.schoolRank, 10) || 999) : 999; if (r > 0 && r <= totalPop * 0.2) leads.push(sn); else if (r > totalPop * 0.75) weaks.push(sn); });
        var tier = totalRank <= totalPop * 0.2 ? '领先' : (totalRank <= totalPop * 0.6 ? '中上' : (totalRank <= totalPop * 0.75 ? '临界' : '后进'));
        var biased = leads.length > 0 && weaks.length > 0;
        profiles.push({ id: s.name, name: s.name, totalRank: totalRank, totalScore: totalScore, tier: tier, leads: leads, weaks: weaks, biased: biased, volatility: 0 });
    });
    profiles.sort(function(a,b) { return a.totalRank - b.totalRank; });
    profiles.forEach(function(p,i) { p.sid = 'S' + String(i + 1); });
    var ps = DataPool.trendParsedSheets;
    if (!ps || !ps.total || !ps.total.rows.length) { ps = buildParsedSheetsFromAllBatches(); if (ps) DataPool.trendParsedSheets = ps; }
    var hasTrend = ps && ps.total && ps.total.rows.length > 0;
    function fillTrendRanks(name, subjId) {
        if (!hasTrend) return [];
        var dataset = ps.subjects ? ps.subjects[subjId] : null;
        if (!dataset || !dataset.rows) return [];
        var row = dataset.rows.find(function(r) { return String(r[0]) === name; });
        if (!row) return [];
        var ranks = row.slice(1).map(function(v) { var x = parseFloat(v); return isNaN(x) ? '-' : x; });
        return ranks.length <= 3 ? ranks : ranks.slice(ranks.length - 3);
    }
    function fillTotalTrendRanks(name) {
        if (!hasTrend || !ps.total || !ps.total.rows) return [];
        var row = ps.total.rows.find(function(r) { return String(r[0]) === name; });
        if (!row) return [];
        var ranks = row.slice(1).map(function(v) { var x = parseFloat(v); return isNaN(x) ? '-' : x; });
        return ranks.length <= 3 ? ranks : ranks.slice(ranks.length - 3);
    }
    var trendSubjMap = { 'chinese':'语文','math':'数学','english':'英语','englishListening':'英语听说','physics':'物理','history':'历史','daofa':'道法','chemistry':'化学','biology':'生物','geography':'地理' };
    var reverseTrendSubjMap = {};
    Object.keys(trendSubjMap).forEach(function(k) { reverseTrendSubjMap[trendSubjMap[k]] = k; });
    profiles.forEach(function(p) {
        p.totalTrendRanks = fillTotalTrendRanks(p.name);
        p.subjTrendRanks = {};
        subjNames.forEach(function(sn) { var tId = reverseTrendSubjMap[sn]; if (tId) p.subjTrendRanks[sn] = fillTrendRanks(p.name, tId); else p.subjTrendRanks[sn] = []; });
    });
    return profiles;
}

// ============================================================
//  IndexedDB 座位快照存储
// ============================================================
async function persistSeatingSnapshots(snapshots) {
    try { await AppCore.storage.write('seating_snapshots', snapshots.slice(-10)); return true; }
    catch (error) { console.warn('保存座位快照失败', error); return false; }
}
async function restoreSeatingSnapshots() {
    try {
        const snapshots = AppCore.storage.decode(await AppCore.storage.read('seating_snapshots'), []);
        return Array.isArray(snapshots) ? snapshots : [];
    } catch (error) { console.warn('恢复座位快照失败', error); return []; }
}

// ============================================================
//  SeatingModule 类 — 将排位置.html 功能封装为独立模块
// ============================================================
var seatingModuleInstance = null;
var SeatingModule = (function() {
function SeatingModule(rootEl) {
    this.root = rootEl;
    this.uid = 'sm';
    this.students = [];
    this.seatMap = [];
    this.showTags = true;
    this.currentEditingName = '';
    this.dragged = { source: null, name: null, index: -1 };
    this.isClearing = false;
    this.historySnapshots = [];
    this.currentSnapshotIndex = -1;
    this.advancedSettings = {
        layout: 'default', groupSize: 6, customGroupSize: null,
        weights: { complement: 1.0, behavior: 1.0, group: 1.0, constraints: 1.0, balance: 1.0 }
    };
    this.GRADIENT_COLORS = ['#1a237e','#283593','#1565c0','#1976d2','#f57f17','#e65100','#bf360c','#b71c1c'];
    this.GRADIENT_LABELS = ['L1','L2','L3','L4','L5','L6','L7','L8'];
    this.GRADIENT_NAMES = ['L1','L2','L3','L4','L5','L6','L7','L8'];
}

SeatingModule.prototype.gradientText = function(n) {
    var g = parseInt(n, 10);
    if (g >= 1 && g <= 8) return this.GRADIENT_LABELS[g - 1];
    return 'L?';
};

SeatingModule.prototype.init = function(profiles) {
    var self = this;
    var totalPop = profiles.length || 1;
    this.students = profiles.map(function(p, i) {
        var subjects = {};
        if (p.subjTrendRanks) {
            Object.keys(p.subjTrendRanks).forEach(function(sn) {
                var trend = p.subjTrendRanks[sn] || [];
                subjects[sn] = { rank: trend.length > 0 ? trend[trend.length-1] : null, trend: trend };
            });
        }
        return {
            name: p.name, status: 'normal', tags: [], gradient: 0,
            compositeRank: totalPop > 0 ? (p.totalRank / totalPop) * 100 : 50,
            latestTotalRank: p.totalRank, totalTrend: p.totalTrendRanks || [],
            subjects: subjects,
            leadingSubjects: Array.isArray(p.leads) ? p.leads.join(', ') : (p.leads || ''),
            weakSubjects: Array.isArray(p.weaks) ? p.weaks.join(', ') : (p.weaks || ''),
            isSpecial: p.biased || false, level: p.tier || ''
        };
    });
    this.seatMap = new Array(Math.ceil(this.students.length / 8) * 8).fill(null);
    var seen = new Set();
    this.students = this.students.filter(function(s) { if (!s || !s.name || seen.has(s.name)) return false; seen.add(s.name); return true; });
    this.calculateGradients();
    this.assignInitialSeats();
    this.render();
    this.renderHistory();
    this.initModalPools();
    this.renderRightSidebarStats();
};

// 计算梯度
SeatingModule.prototype.calculateGradients = function() {
    if (!this.students.length) return;
    var hasTrend = this.students.filter(function(s) { return s.latestTotalRank !== null; });
    if (hasTrend.length === 0) {
        this.students.forEach(function(s, i) { s.gradient = Math.min(8, Math.floor(i / Math.ceil(this.students.length / 8)) + 1); }, this);
        return;
    }
    var sorted = this.students.slice().sort(function(a, b) { return (a.latestTotalRank || 999) - (b.latestTotalRank || 999); });
    var total = sorted.length;
    var perGroup = total / 8;
    var cutoffs = [];
    for (var g = 1; g <= 7; g++) cutoffs.push(Math.round(g * perGroup));
    sorted.forEach(function(s, i) {
        if (i < cutoffs[0]) s.gradient = 1;
        else if (i < cutoffs[1]) s.gradient = 2;
        else if (i < cutoffs[2]) s.gradient = 3;
        else if (i < cutoffs[3]) s.gradient = 4;
        else if (i < cutoffs[4]) s.gradient = 5;
        else if (i < cutoffs[5]) s.gradient = 6;
        else if (i < cutoffs[6]) s.gradient = 7;
        else s.gradient = 8;
        s.compositeRank = s.latestTotalRank ? (s.latestTotalRank / total) * 100 : 50;
    });
};
SeatingModule.prototype.getComplementScore = function(diff) {
    if (diff >= 5) return -200;
    if (diff === 0) return 25;
    if (diff === 1) return 50;
    if (diff === 2) return 80;
    if (diff === 3) return 100;
    if (diff === 4) return 60;
    return -200;
};
SeatingModule.prototype.isForbiddenPair = function(g1, g2) {
    if (Math.abs(g1 - g2) >= 5) return true;
    if (g1 === 8 && g2 === 8) return true;
    if ((g1 === 7 && g2 === 8) || (g1 === 8 && g2 === 7)) return true;
    return false;
};
SeatingModule.prototype.assignInitialSeats = function() {
    var seated = this.seatMap.filter(function(n) { return n && n !== '\u{1F6AB}'; });
    var unseated = this.students.filter(function(s) { return seated.indexOf(s.name) < 0; });
    if (unseated.length === 0) return;
    var pool = this.students.filter(function(s) { return s.status !== 'empty'; }).map(function(s) { return { name: s.name, gradient: s.gradient }; });
    var pairs = [];
    while (pool.length > 1) {
        pool.sort(function(a, b) { return a.gradient - b.gradient; });
        var bestPair = null, bestDiff = Infinity;
        for (var i = 0; i < Math.min(pool.length, 10); i++) {
            for (var j = i + 1; j < Math.min(pool.length, i + 10); j++) {
                var diff = Math.abs(pool[i].gradient - pool[j].gradient);
                var score = Math.abs(diff - 3);
                if (score < bestDiff || (score === bestDiff && Math.random() < 0.3)) { bestDiff = score; bestPair = [i, j]; }
            }
        }
        if (bestPair) { var pi = bestPair; pairs.push([pool[pi[0]].name, pool[pi[1]].name]); pool.splice(pi[1], 1); pool.splice(pi[0], 1); }
        else break;
    }
    if (pool.length === 1) pairs.push([pool[0].name, null]);
    var emptyIndices = [];
    this.seatMap.forEach(function(n, i) { if (!n || n === '\u{1F6AB}') emptyIndices.push(i); });
    pairs.forEach(function(pair, pi) {
        if (pi * 2 >= emptyIndices.length) return;
        var idx1 = emptyIndices[pi * 2], idx2 = emptyIndices[pi * 2 + 1];
        if (idx1 !== undefined && this.seatMap.indexOf(pair[0]) < 0) this.seatMap[idx1] = pair[0];
        if (idx2 !== undefined && pair[1] && this.seatMap.indexOf(pair[1]) < 0) this.seatMap[idx2] = pair[1];
    }, this);
};

// 初始化弹窗标签池
SeatingModule.prototype.initModalPools = function() {
    var physical = ['眼疾','个高','个矮','特殊学生'];
    var phyEl = this.root.querySelector('#sm-pool-physical');
    if (phyEl) phyEl.innerHTML = physical.map(function(t) { return '<div class="tag-item" data-sm-tag="'+t+'">'+t+'</div>'; }).join('');
    var behavior = ['爱说话','性格开朗','爱运动','自律'];
    var behEl = this.root.querySelector('#sm-pool-behavior');
    if (behEl) behEl.innerHTML = behavior.map(function(t) { return '<div class="tag-item" data-sm-tag="'+t+'">'+t+'</div>'; }).join('');
};

// 渲染主界面
SeatingModule.prototype.render = function() {
    this.root.innerHTML = this.buildLayoutHTML();
    this.renderUnseatedList();
    this.renderRightSidebarStats();
    this.bindEvents();
    this.renderGrid();
};

SeatingModule.prototype.buildLayoutHTML = function() {
    return '<div class="seating-layout">' +
        '<div class="seating-sidebar" id="sm-sidebar">' +
            '<div class="sb-card">' +
                '<div class="sb-card-title">\u{1F4CA} 数据源</div>' +
                '<p style="font-size:12px;color:#666;">来自成绩分析系统</p>' +
                '<button class="btn2 btn2-primary btn2-block" id="sm-btnRefresh">\u{1F504} 从当前数据刷新</button>' +
                '<button class="btn2 btn2-toggle btn2-block" id="sm-btnToggleTags" style="margin-top:6px">\u{1F4CB} 标签：开</button>' +
            '</div>' +
            '<div class="sb-card">' +
                '<div class="sb-card-title">\u2699\uFE0F 排位操作</div>' +
                '<button class="btn2-seat-primary" id="sm-btnOptimize">\u2728 智能排座</button>' +
                '<div class="mode-divider">\u{1F3AF} 专项优化</div>' +
                '<button class="btn2-mode mode-academic" data-sm-mode="academic">\u{1F4DA} 学业互补</button>' +
                '<button class="btn2-mode mode-behavior" data-sm-mode="behavior">\u{1F6E1}\uFE0F 行为管理</button>' +
                '<button class="btn2-mode mode-social" data-sm-mode="social">\u{1F465} 社交拓展</button>' +
                '<p class="mode-hint">基于L1-L8梯度，跨3级异质配对+4人小组互补</p>' +
                '<div class="mode-divider">\u{1F504} 轮换操作</div>' +
                '<div style="display:flex;gap:6px;margin-top:4px;">' +
                    '<select id="sm-rotationMode" style="flex:1;padding:7px 6px;border:1px solid var(--seating-border);border-radius:var(--seating-radius-sm);font-size:.72rem;background:var(--seating-surface);color:var(--seating-text2);cursor:pointer;">' +
                        '<option value="shift">后移一排</option>' +
                        '<option value="swap">同桌对调</option>' +
                        '<option value="serpentine">S型流动</option>' +
                        '<option value="fullCycle">大循环</option>' +
                    '</select>' +
                    '<button class="btn2 btn2-rotation" id="sm-btnRotate" style="flex-shrink:0;margin-top:0;padding:7px 10px;">\u25B6 执行</button>' +
                '</div>' +
                '<button class="btn2-advanced" id="sm-btnAdvanced">\u2699\uFE0F 高级排位</button>' +
                '<button class="btn2-clear" id="sm-btnClear">\u{1F5D1}\uFE0F 清空数据</button>' +
            '</div>' +
            '<div class="sb-card">' +
                '<div class="sb-card-title">\u{1F464} 待分配学生</div>' +
                '<div class="student-list" id="sm-unseatedList" data-sm-drop="unseated"></div>' +
            '</div>' +
             '<div class="sb-card">' +
                 '<div class="sb-card-title">\u{1F4E5} 导出与复原</div>' +
                 '<button class="btn2 btn2-toggle btn2-block" id="sm-btnExport">\u{1F4E4} 导出Excel</button>' +
                 '<button class="btn2 btn2-toggle btn2-block" style="margin-top:4px" id="sm-btnHelpGraph">帮扶关系图</button>' +
                 '<button class="btn2 btn2-toggle btn2-block" style="margin-top:4px" id="sm-btnImport">\u{1F4C2} 导入复原JSON</button>' +
             '</div>' +
            '<div class="sb-card">' +
                '<div class="sb-card-title">\u{1F4D6} 快照</div>' +
                '<button class="btn2 btn2-toggle btn2-block" id="sm-btnSnapshot">\u{1F4F7} 保存快照</button>' +
                '<div class="history-panel" id="sm-historyPanel"></div>' +
            '</div>' +
        '</div>' +
        '<div class="seating-content-wrapper">' +
            '<div class="seating-main" id="sm-main">' +
                '<div class="stage">\u8BB2 \u53F0</div>' +
                '<div class="seat-grid" id="sm-seatGrid"></div>' +
            '</div>' +
            '<div class="seating-bottom">' +
                '<div class="sb-card">' +
                    '<div class="sb-card-title">\u{1F4CA} 座位统计</div>' +
                    '<div id="sm-rightSidebarStats" style="font-size:0.8rem;"><div style="color:#999;">加载中...</div></div>' +
                '</div>' +
                '<div class="sb-card">' +
                    '<div class="sb-card-title">\u{1F5C2}\uFE0F 梯度分布</div>' +
                    '<div id="sm-gradientOverview" style="font-size:0.8rem;"><div style="color:#999;">加载中...</div></div>' +
                '</div>' +
                '<div class="sb-card">' +
                    '<div class="sb-card-title">\u2139\uFE0F 规则说明</div>' +
                    '<div style="font-size:0.75rem; line-height:1.8; color:#555;">' +
                        '<div><b>配对规则：</b>跨3级最优(L差=3)</div>' +
                        '<div><b>禁止配对：</b>L差\u22655, L7+L8 或 L8+L8</div>' +
                        '<div><b>4人小组：</b>邻桌梯度互补</div>' +
                        '<div><b>轮换：</b>后移一排 / 同桌对调 / S型流动 / 大循环</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
         // Modal overlay + modal
        '<div class="help-graph-overlay" id="sm-helpGraphOverlay">' +
            '<div class="help-graph-modal">' +
                '<div class="help-graph-header"><span>帮扶关系网络图</span><button class="btn2 btn2-ghost btn2-sm" id="sm-btnCloseHelpGraph">关闭</button></div>' +
                '<div class="help-graph-chart" id="sm-helpGraphChart"></div>' +
            '</div>' +
        '</div>' +
        '<div class="modal-overlay2" id="sm-overlay"></div>' +
        '<div class="modal2" id="sm-editModal">' +
            '<h2 id="sm-m-name">\u5B66\u751F\u4FE1\u606F</h2>' +
            '<div class="analysis-section" id="sm-analysisSection" style="display:none">' +
                '<div class="analysis-title">\u{1F4CA} 学情分析</div>' +
                '<div id="sm-analysisContent"></div>' +
            '</div>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">状态锁定</span>' +
                '<div class="tag-pool">' +
                    '<div class="tag-item" data-sm-status="fixed">\u{1F4CC} 固定位置</div>' +
                    '<div class="tag-item" data-sm-status="special">\u26A0\uFE0F 重点关注</div>' +
                    '<div class="tag-item" data-sm-status="empty">\u{1F6AB} 标记此座为空位</div>' +
                '</div>' +
            '</div>' +
            '<div class="tag-section" id="sm-gradientInfoSection">' +
                '<span class="tag-section-title">梯度信息（仅教师可见）</span>' +
                '<div id="sm-gradientInfoContent" style="font-size:0.8rem;padding:8px;background:var(--seating-bg);border-radius:4px;"></div>' +
            '</div>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">生理特征</span>' +
                '<div class="tag-pool" id="sm-pool-physical"></div>' +
            '</div>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">行为特征</span>' +
                '<div class="tag-pool" id="sm-pool-behavior"></div>' +
            '</div>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">注意事项</span>' +
                '<div class="tag-pool" id="sm-pool-notice" style="max-height:168px;overflow-y:auto;display:flex;flex-wrap:wrap;align-content:flex-start;"></div>' +
                '<input type="text" id="sm-conflictInput" placeholder="输入关系不和的学生姓名" style="width:100%;padding:6px;margin-top:8px;border:1px solid #ddd;border-radius:4px;font-size:0.75rem;">' +
                '<button class="btn2" style="margin-top:8px;background:#fff;border:1px solid #ddd;color:#666;font-size:0.75rem;padding:6px;" id="sm-btnAddConflict">添加关系不和</button>' +
                '<input type="text" id="sm-chatInput" placeholder="输入爱上课说话的学生姓名" style="width:100%;padding:6px;margin-top:8px;border:1px solid #ddd;border-radius:4px;font-size:0.75rem;">' +
                '<button class="btn2" style="margin-top:8px;background:#fff;border:1px solid #ddd;color:#666;font-size:0.75rem;padding:6px;" id="sm-btnAddChat">添加爱说话搭档</button>' +
            '</div>' +
            '<button class="btn2 btn2-blue" style="margin-top:30px" id="sm-btnCloseModal">确认并保存</button>' +
        '</div>' +
        // Advanced modal
        '<div class="modal-overlay2" id="sm-advancedOverlay"></div>' +
        '<div class="modal2" id="sm-advancedModal" style="width:480px;">' +
            '<h2>\u2699\uFE0F 高级排位模式</h2>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">教室布局模式</span>' +
                '<div class="tag-pool">' +
                    '<div class="tag-item selected" id="sm-layout-default" data-sm-layout="default">\u{1F4BA} 标准双人桌</div>' +
                '</div>' +
            '</div>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">分组设置</span>' +
                '<div style="margin-bottom:10px;">' +
                    '<label style="font-size:0.8rem;color:#666;">每组人数：</label>' +
                    '<select id="sm-groupSize" style="width:100%;padding:6px;margin-top:4px;border:1px solid #ddd;border-radius:4px;font-size:0.75rem;">' +
                        '<option value="4">4人一组</option>' +
                        '<option value="6" selected>6人一组（默认）</option>' +
                        '<option value="8">8人一组</option>' +
                        '<option value="custom">自定义...</option>' +
                    '</select>' +
                '</div>' +
                '<div id="sm-customGroupSection" style="display:none;">' +
                    '<label style="font-size:0.8rem;color:#666;">自定义分组人数：</label>' +
                    '<input type="number" id="sm-customGroupSize" min="2" max="12" placeholder="输入人数" style="width:100%;padding:6px;margin-top:4px;border:1px solid #ddd;border-radius:4px;font-size:0.75rem;">' +
                '</div>' +
            '</div>' +
            '<div class="tag-section">' +
                '<span class="tag-section-title">优化目标权重调整</span>' +
                '<div style="margin-bottom:8px;"><label style="font-size:0.7rem;color:#666;">互补配对：<span id="sm-complementWeight">1.0</span></label><input type="range" id="sm-complementSlider" min="0" max="2" step="0.1" value="1.0" style="width:100%;"></div>' +
                '<div style="margin-bottom:8px;"><label style="font-size:0.7rem;color:#666;">行为管理：<span id="sm-behaviorWeight">1.0</span></label><input type="range" id="sm-behaviorSlider" min="0" max="2" step="0.1" value="1.0" style="width:100%;"></div>' +
                '<div style="margin-bottom:8px;"><label style="font-size:0.7rem;color:#666;">小组验证：<span id="sm-groupWeight">1.0</span></label><input type="range" id="sm-groupSlider" min="0" max="2" step="0.1" value="1.0" style="width:100%;"></div>' +
                '<div style="margin-bottom:8px;"><label style="font-size:0.7rem;color:#666;">约束条件：<span id="sm-constraintsWeight">1.0</span></label><input type="range" id="sm-constraintsSlider" min="0" max="2" step="0.1" value="1.0" style="width:100%;"></div>' +
                '<div style="margin-bottom:8px;"><label style="font-size:0.7rem;color:#666;">全局均衡：<span id="sm-balanceWeight">1.0</span></label><input type="range" id="sm-balanceSlider" min="0" max="2" step="0.1" value="1.0" style="width:100%;"></div>' +
            '</div>' +
            '<button class="btn2 btn2-blue" style="margin-top:20px" id="sm-btnApplyAdvanced">应用高级设置</button>' +
            '<button class="btn2 btn2-toggle" style="margin-top:8px" id="sm-btnResetAdvanced">重置为默认</button>' +
            '<button class="btn2 btn2-toggle" style="margin-top:8px" id="sm-btnCloseAdvanced">取消</button>' +
        '</div>' +
    '</div>';
};

SeatingModule.prototype.bindEvents = function() {
    var self = this;
    // Refresh
    var btnRefresh = this.root.querySelector('#sm-btnRefresh');
    if (btnRefresh) btnRefresh.onclick = function() { self.loadFromCurrentData(); };
    // Toggle tags
    var btnTags = this.root.querySelector('#sm-btnToggleTags');
    if (btnTags) btnTags.onclick = function() { self.toggleTagVisibility(); };
    // Optimize
    var btnOpt = this.root.querySelector('#sm-btnOptimize');
    if (btnOpt) btnOpt.onclick = function() { self.runOptimization('overall'); };
    // Mode buttons (event delegation)
    this.root.querySelectorAll('[data-sm-mode]').forEach(function(el) {
        el.onclick = function() { self.runOptimization(el.getAttribute('data-sm-mode')); };
    });
    // Rotate
    var btnRot = this.root.querySelector('#sm-btnRotate');
    if (btnRot) btnRot.onclick = function() { self.executeRotation(); };
    // Advanced
    var btnAdv = this.root.querySelector('#sm-btnAdvanced');
    if (btnAdv) btnAdv.onclick = function() { self.showAdvancedOptions(); };
    // Clear
    var btnClr = this.root.querySelector('#sm-btnClear');
    if (btnClr) btnClr.onclick = function() { self.clearAll(); };
    // Export
    var btnExp = this.root.querySelector('#sm-btnExport');
    if (btnExp) btnExp.onclick = function() { self.exportData(); };
    var btnHelpGraph = this.root.querySelector('#sm-btnHelpGraph');
    if (btnHelpGraph) btnHelpGraph.onclick = function() { self.showHelpGraph(); };
    var btnCloseHelpGraph = this.root.querySelector('#sm-btnCloseHelpGraph');
    if (btnCloseHelpGraph) btnCloseHelpGraph.onclick = function() { self.closeHelpGraph(); };
    var helpGraphOverlay = this.root.querySelector('#sm-helpGraphOverlay');
    if (helpGraphOverlay) helpGraphOverlay.onclick = function(e) { if (e.target === helpGraphOverlay) self.closeHelpGraph(); };
    // Import
    var btnImp = this.root.querySelector('#sm-btnImport');
    if (btnImp) btnImp.onclick = function() { self.importRecoveryData(); };
    // Snapshots
    var btnSnap = this.root.querySelector('#sm-btnSnapshot');
    if (btnSnap) btnSnap.onclick = function() { self.saveSnapshot(); };
    // Modal
    var overlay = this.root.querySelector('#sm-overlay');
    if (overlay) overlay.onclick = function() { self.closeModal(); };
    var btnClose = this.root.querySelector('#sm-btnCloseModal');
    if (btnClose) btnClose.onclick = function() { self.closeModal(); };
    // Modal status tags (event delegation)
    this.root.querySelectorAll('[data-sm-status]').forEach(function(el) {
        el.onclick = function() { self.updateStatus(el.getAttribute('data-sm-status')); };
    });
    // Modal tag pools (event delegation)
    this.root.querySelectorAll('#sm-pool-physical, #sm-pool-behavior').forEach(function(pool) {
        pool.onclick = function(e) {
            var target = e.target;
            if (target && target.classList.contains('tag-item') && target.getAttribute('data-sm-tag')) {
                self.toggleTag(target.getAttribute('data-sm-tag'));
            }
        };
    });
    // Conflict / Chat
    var btnConf = this.root.querySelector('#sm-btnAddConflict');
    if (btnConf) btnConf.onclick = function() { self.addConflict(); };
    var conflictInput = this.root.querySelector('#sm-conflictInput');
    if (conflictInput) conflictInput.onkeypress = function(e) { if (e.key === 'Enter') self.addConflict(); };
    var btnChat = this.root.querySelector('#sm-btnAddChat');
    if (btnChat) btnChat.onclick = function() { self.addChatPartner(); };
    var chatInput = this.root.querySelector('#sm-chatInput');
    if (chatInput) chatInput.onkeypress = function(e) { if (e.key === 'Enter') self.addChatPartner(); };
    // Advanced modal
    var advOverlay = this.root.querySelector('#sm-advancedOverlay');
    if (advOverlay) advOverlay.onclick = function() { self.closeAdvancedModal(); };
    var btnCloseAdv = this.root.querySelector('#sm-btnCloseAdvanced');
    if (btnCloseAdv) btnCloseAdv.onclick = function() { self.closeAdvancedModal(); };
    var btnApply = this.root.querySelector('#sm-btnApplyAdvanced');
    if (btnApply) btnApply.onclick = function() { self.applyAdvancedSettings(); };
    var btnReset = this.root.querySelector('#sm-btnResetAdvanced');
    if (btnReset) btnReset.onclick = function() { self.resetAdvancedSettings(); };
    // Layout selection
    this.root.querySelectorAll('[data-sm-layout]').forEach(function(el) {
        el.onclick = function() { self.selectLayout(el.getAttribute('data-sm-layout')); };
    });
    // Weight sliders
    ['complement','behavior','group','constraints','balance'].forEach(function(key) {
        var slider = self.root.querySelector('#sm-' + key + 'Slider');
        if (slider) slider.oninput = function() { self.updateWeight(key, this.value); };
    });
    // Group size
    var groupSel = this.root.querySelector('#sm-groupSize');
    if (groupSel) groupSel.onchange = function() {
        var customSection = self.root.querySelector('#sm-customGroupSection');
        if (customSection) customSection.style.display = this.value === 'custom' ? 'block' : 'none';
    };
};

SeatingModule.prototype.loadFromCurrentData = function() {
    var cls = document.getElementById('seatingClassFilter');
    if (!cls) { showAlert('班级选择器未找到'); return; }
    var className = cls.value;
    var profiles = buildSeatingProfiles(className);
    if (!profiles.length) { showAlert('该班级无有效数据或人数不足4人'); return; }
    this.init(profiles);
};

// 渲染座位网格
SeatingModule.prototype.renderGrid = function() {
    var grid = this.root.querySelector('#sm-seatGrid');
    if (!grid) return;
    grid.className = 'seat-grid' + (this.showTags ? '' : ' tag-hidden');
    grid.innerHTML = '';
    var self = this;
    var rows = Math.ceil(this.seatMap.length / 8);
    for (var row = 0; row < rows; row++) {
        for (var col = 0; col < 8; col++) {
            var idx = row * 8 + col;
            if (col === 2 || col === 4 || col === 6) {
                var corridor = document.createElement('div');
                corridor.className = 'corridor';
                corridor.innerHTML = '<div class="corridor-label">走廊</div>';
                grid.appendChild(corridor);
            }
            var name = this.seatMap[idx];
            var seat = document.createElement('div');
            seat.className = 'seat';
            if (name === '\u{1F6AB}') {
                seat.classList.add('empty-seat');
                seat.innerHTML = '<div style="color:#999;font-size:1.2rem">\u{1F6AB}</div><div style="color:#999;font-size:0.7rem">空位</div>';
                seat.onclick = function(i) { return function() { if (confirm('是否取消此位置的空位标记？')) { self.seatMap[i] = null; self.saveAndRender(); } }; }(idx);
            } else if (name) {
                seat.setAttribute('draggable', 'true');
                seat.ondragstart = function(i, n) { return function(e) { self.dragged = { source: 'seat', name: n, index: i }; e.dataTransfer.setData('text/plain', n); }; }(idx, name);
                seat.ondragover = function(e) { e.preventDefault(); seat.classList.add('drag-over'); };
                seat.ondragleave = function() { seat.classList.remove('drag-over'); };
                seat.ondrop = function(i) { return function(e) {
                    e.preventDefault(); seat.classList.remove('drag-over');
                    if (self.dragged.source === 'seat') { var tmp = self.seatMap[self.dragged.index]; self.seatMap[self.dragged.index] = self.seatMap[i]; self.seatMap[i] = tmp; }
                    else if (self.dragged.source === 'list') { var origIdx = self.seatMap.indexOf(self.dragged.name); if (origIdx > -1) self.seatMap[origIdx] = null; self.seatMap[i] = self.dragged.name; }
                    self.dragged = { source: null, name: null, index: -1 }; self.saveAndRender();
                }; }(idx);
                var s = this.students.find(function(x) { return x.name === name; });
                if (s) {
                    if (s.status === 'fixed') seat.style.border = '2px solid var(--seating-fixed-green)';
                    if (s.status === 'special') seat.style.border = '2px solid var(--seating-special-yellow)';
                    var tagsHtml = '';
                    if (this.showTags) {
                        var g = s.gradient || 0;
                        var gColor = g >= 1 && g <= 8 ? this.GRADIENT_COLORS[g-1] : '#999';
                        tagsHtml += '<span class="gradient-badge" style="background:' + gColor + '">' + (g ? this.GRADIENT_LABELS[g-1] : '?') + '</span>';
                        var deskPartner = this.getDeskPartner(idx);
                        if (deskPartner) {
                            var p = this.students.find(function(x) { return x.name === deskPartner; });
                            if (p) {
                                var pg = p.gradient || 0;
                                var diff = s.gradient && p.gradient ? Math.abs(s.gradient - p.gradient) : 0;
                                tagsHtml += '<span class="mini-tag">同桌:' + this.gradientText(pg) + ' 互补:' + this.getComplementScore(diff) + '</span>';
                            }
                        }
                        s.tags.filter(function(t) { return t.indexOf('关系不和') < 0 && t.indexOf('爱说话:') < 0; }).forEach(function(t) {
                            var cls = 'mini-tag';
                            if (t.indexOf('自律') >= 0) cls += ' good';
                            if (t.indexOf('爱说话') >= 0) cls += ' bad';
                            tagsHtml += '<span class="' + cls + '">' + t + '</span>';
                        });
                    }
                    seat.innerHTML = '<div class="seat-name">' + s.name + '</div><div class="tag-display-area">' + tagsHtml + '</div>' + (s.status === 'fixed' ? '<div class="seat-locked">\u{1F4CC}</div>' : '');
                    seat.onclick = function(n) { return function() { self.openModal(n); }; }(s.name);
                }
            } else {
                seat.innerHTML = '<span style="color:#ddd;font-size:12px">' + (idx + 1) + '</span>';
                seat.ondragover = function(e) { e.preventDefault(); seat.classList.add('drag-over'); };
                seat.ondragleave = function() { seat.classList.remove('drag-over'); };
                seat.ondrop = function(i) { return function(e) {
                    e.preventDefault(); seat.classList.remove('drag-over');
                    if (self.dragged.source === 'list') { var origIdx = self.seatMap.indexOf(self.dragged.name); if (origIdx > -1) self.seatMap[origIdx] = null; self.seatMap[i] = self.dragged.name; self.dragged = { source: null, name: null, index: -1 }; self.saveAndRender(); }
                }; }(idx);
                seat.onclick = function(i) { return function() { if (confirm('是否将此位置标记为空位？')) { self.seatMap[i] = '\u{1F6AB}'; self.saveAndRender(); } }; }(idx);
            }
            grid.appendChild(seat);
        }
    }
};

SeatingModule.prototype.getDeskPartner = function(index) {
    var row = Math.floor(index / 8);
    var col = index % 8;
    var partnerCol = col % 2 === 0 ? col + 1 : col - 1;
    if (partnerCol < 0 || partnerCol > 7) return null;
    var partnerIdx = row * 8 + partnerCol;
    var name = this.seatMap[partnerIdx];
    return name && name !== '\u{1F6AB}' ? name : null;
};
SeatingModule.prototype.getFourPersonGroup = function(index) {
    var row = Math.floor(index / 8);
    var col = index % 8;
    var pairStart = col % 2 === 0 ? col : col - 1;
    var members = [];
    for (var r = Math.max(0, row - 1); r <= Math.min(Math.ceil(this.seatMap.length / 8) - 1, row + 1); r++) {
        for (var c = pairStart; c <= pairStart + 1 && c < 8; c++) {
            var idx = r * 8 + c;
            var n = this.seatMap[idx];
            if (n && n !== '\u{1F6AB}') members.push({ name: n, index: idx });
        }
    }
    return members;
};
SeatingModule.prototype.openModal = function(name) {
    var self = this;
    this.currentEditingName = name;
    var s = this.students.find(function(x) { return x.name === name; });
    if (!s) return;
    var nameEl = this.root.querySelector('#sm-m-name');
    if (nameEl) nameEl.textContent = name;
    var modal = this.root.querySelector('#sm-editModal');
    if (modal) modal.classList.add('active');
    var overlay = this.root.querySelector('#sm-overlay');
    if (overlay) overlay.style.display = 'block';
    this.updateAnalysis(s);
    var g = s.gradient || 0;
    var gColor = g >= 1 && g <= 8 ? this.GRADIENT_COLORS[g-1] : '#999';
    var gLabel = g >= 1 && g <= 8 ? this.GRADIENT_LABELS[g-1] : '未计算';
    var seatIdx = this.seatMap.indexOf(s.name);
    var deskPartner = seatIdx >= 0 ? this.getDeskPartner(seatIdx) : null;
    var partnerG = deskPartner ? (this.students.find(function(x) { return x.name === deskPartner; })?.gradient || 0) : 0;
    var diff = g && partnerG ? Math.abs(g - partnerG) : 0;
    var compScore = this.getComplementScore(diff);
    var subjectCount = Object.keys(s.subjects || {}).length;
    var groupMembers = seatIdx >= 0 ? this.getFourPersonGroup(seatIdx).filter(function(m) { return m.name !== s.name; }) : [];
    var groupHtml = groupMembers.map(function(m) { var mg = self.students.find(function(x) { return x.name === m.name; })?.gradient || 0; return '<span class="mini-tag">' + m.name + '(' + self.gradientText(mg) + ')</span>'; }).join(' ');
    var gradientHtml = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span class="gradient-badge" style="background:' + gColor + '">' + gLabel + '</span><span><strong>梯度：</strong>' + gLabel + ' | 总分排名：' + (s.latestTotalRank || '?') + '/' + this.students.length + '</span></div>' +
        '<div style="margin-top:4px;"><strong>同桌：</strong>' + (deskPartner || '无') + (deskPartner ? ' | 同桌梯度：' + this.gradientText(partnerG) + ' | 互补分值：' + compScore + (diff >= 5 ? '<span style="color:red;margin-left:8px;"> ⚠️ 禁止配对！</span>' : '') : '') + '</div>' +
        '<div style="margin-top:4px;"><strong>四人小组：</strong>' + (groupHtml || '未就座') + '</div>' +
        (s.leadingSubjects ? '<div style="margin-top:4px;"><strong>领先科目：</strong><span class="mini-tag good">' + s.leadingSubjects + '</span></div>' : '') +
        (s.weakSubjects ? '<div style="margin-top:4px;"><strong>薄弱科目：</strong><span class="mini-tag bad">' + s.weakSubjects + '</span></div>' : '') +
        (subjectCount > 0 ? '<div style="margin-top:4px;font-size:0.7rem;color:#999;">已解析 ' + subjectCount + ' 科趋势数据</div>' : '');
    var giEl = this.root.querySelector('#sm-gradientInfoContent');
    if (giEl) giEl.innerHTML = gradientHtml;
    this.root.querySelectorAll('.tag-item').forEach(function(el) { el.classList.remove('selected'); });
    s.tags.forEach(function(st) { self.root.querySelectorAll('.tag-item[data-sm-tag="' + st + '"]').forEach(function(el) { el.classList.add('selected'); }); });
    [['opt-fixed','fixed'],['opt-special','special']].forEach(function(p) {
        var el = self.root.querySelector('#sm-' + p[0]);
        if (el) el.classList.toggle('selected', s.status === p[1]);
    });
    this.updateNoticeTags(s);
};
SeatingModule.prototype.updateStatus = function(stat) {
    var self = this;
    var s = this.students.find(function(x) { return x.name === this.currentEditingName; }, this);
    if (!s) return;
    if (stat === 'empty') {
        if (confirm('将此位置设为空位？' + s.name + '将回到待分配名单。')) {
            var idx = this.seatMap.indexOf(s.name);
            if (idx !== -1) { this.seatMap[idx] = '\u{1F6AB}'; this.saveAndRender(); this.closeModal(); }
        }
        return;
    }
    s.status = s.status === stat ? 'normal' : stat;
    this.saveAndRender();
    this.openModal(this.currentEditingName);
};
SeatingModule.prototype.updateAnalysis = function(s) {
    var section = this.root.querySelector('#sm-analysisSection');
    var hasSubjects = s.subjects && Object.keys(s.subjects).length > 0;
    if (!hasSubjects && !s.totalTrend) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = 'block';
    var html = '';
    html += '<div class="analysis-item"><strong>总分排名趋势:</strong> ' + ((s.totalTrend || []).join(' → ') || '无') + '</div>';
    html += '<div class="analysis-item"><strong>最新总分排名:</strong> 第' + (s.latestTotalRank || '?') + '名 / 共' + this.students.length + '人</div>';
    html += '<div class="analysis-item"><strong>梯度等级:</strong> ' + this.gradientText(s.gradient) + '</div>';
    if (s.leadingSubjects) html += '<div class="analysis-item"><strong>领先科目:</strong> <span class="strength">' + s.leadingSubjects + '</span></div>';
    if (s.weakSubjects) html += '<div class="analysis-item"><strong>薄弱科目:</strong> <span class="weakness">' + s.weakSubjects + '</span></div>';
    if (hasSubjects) {
        html += '<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px;"><strong>各科排名趋势:</strong></div>';
        Object.keys(s.subjects).forEach(function(sub) {
            var data = s.subjects[sub];
            if (!data || !data.trend) return;
            html += '<div class="analysis-item"><strong>' + sub + ':</strong> ' + data.trend.join(' → ') + ' (最新: 第' + data.rank + '名)</div>';
        });
    }
    var acEl = this.root.querySelector('#sm-analysisContent');
    if (acEl) acEl.innerHTML = html;
};

// 智能排位优化
SeatingModule.prototype.runOptimization = function(type) {
    this.saveSnapshot();
    var modeButtons = this.root.querySelectorAll('.btn2-mode');
    modeButtons.forEach(function(btn) { btn.classList.remove('active'); });
    var activeBtn = this.root.querySelector('.btn2-mode.mode-' + type);
    if (activeBtn) activeBtn.classList.add('active');
    if (!this.students.length) { showAlert('当前没有学生数据'); return; }
    var movableCount = this.students.filter(function(s) { return s.status !== 'fixed' && s.status !== 'empty'; }).length;
    if (movableCount <= 1) { showAlert('可移动学生数量不足，无法进行优化。'); return; }
    this.calculateGradients();
    var optimizer = new this.SeatingOptimizer(this.students, this.seatMap, this.advancedSettings, this);
    var result = optimizer.optimizeForTarget(type);
    var nextMap = result.solution || this.seatMap;
    if (this.areSeatMapsEqual(nextMap, this.seatMap)) { showAlert('优化后座位无变化。'); return; }
    this.seatMap = nextMap;
    this.saveAndRender();
    showAlert('优化完成！最终得分: ' + result.score.toFixed(2));
};

// SeatingOptimizer 遗传算法优化器（内嵌）
SeatingModule.prototype.SeatingOptimizer = function(students, seatMap, advancedSettings, parent) {
    this.students = students;
    this.initialMap = seatMap;
    this.parent = parent;
    this.config = { populationSize: 100, maxIterations: 100, mutationRate: 0.25, elitismCount: 6 };
    this.weights = {};
    this.studentMap = new Map(students.map(function(s) { return [s.name, s]; }));
    this.rows = Math.ceil(seatMap.length / 8);
    this.cols = 8;
    this.advancedSettings = advancedSettings;
};
SeatingModule.prototype.SeatingOptimizer.prototype.optimizeForTarget = function(type) {
    var baseWeights = { academic: { complement: 0.35, behavior: 0.1, group: 0.1, constraints: 0.15, balance: 0.3 }, behavior: { complement: 0.05, behavior: 0.45, group: 0.05, constraints: 0.15, balance: 0.3 }, social: { complement: 0.1, behavior: 0.1, group: 0.35, constraints: 0.15, balance: 0.3 }, overall: { complement: 0.25, behavior: 0.15, group: 0.15, constraints: 0.15, balance: 0.3 } };
    var targetWeights = baseWeights[type] || baseWeights.overall;
    this.weights = {};
    var self = this;
    Object.keys(targetWeights).forEach(function(key) { var aw = self.advancedSettings.weights[key] || 1.0; self.weights[key] = targetWeights[key] * aw; });
    var totalWeight = Object.values(this.weights).reduce(function(s, w) { return s + w; }, 0);
    Object.keys(this.weights).forEach(function(key) { self.weights[key] = self.weights[key] / totalWeight; });
    return this.optimize();
};
SeatingModule.prototype.SeatingOptimizer.prototype.optimize = function() {
    var population = this.initializePopulation();
    var bestSolution = null, bestScore = -Infinity, stagnantGenerations = 0;
    var self = this;
    for (var i = 0; i < this.config.maxIterations; i++) {
        var evaluated = population.map(function(solution) { return { solution: solution, score: self.evaluateSolution(solution) }; });
        evaluated.sort(function(a, b) { return b.score - a.score; });
        if (evaluated[0].score > bestScore) { bestScore = evaluated[0].score; bestSolution = evaluated[0].solution; stagnantGenerations = 0; }
        else { stagnantGenerations++; }
        if (stagnantGenerations >= 15) break;
        var progress = i / this.config.maxIterations;
        this.config.mutationRate = progress < 0.3 ? 0.3 : progress > 0.7 ? 0.1 : 0.2;
        var selected = this.select(evaluated);
        var children = this.crossover(selected);
        var mutated = this.mutate(children);
        population = evaluated.slice(0, this.config.elitismCount).map(function(e) { return e.solution; }).concat(mutated).slice(0, this.config.populationSize);
    }
    return { solution: bestSolution, score: bestScore };
};
SeatingModule.prototype.SeatingOptimizer.prototype.initializePopulation = function() {
    var population = [];
    var half = Math.floor(this.config.populationSize / 2);
    for (var i = 0; i < half; i++) population.push(this.createGreedySolution(i));
    for (var i = half; i < this.config.populationSize; i++) population.push(this.createRandomSolution());
    return population;
};
SeatingModule.prototype.SeatingOptimizer.prototype.createGreedySolution = function(variant) {
    var self = this;
    var solution = this.initialMap.slice();
    var movable = this.students.filter(function(s) { return s.status !== 'empty' && s.status !== 'fixed'; });
    var pool = movable.map(function(s) { return { name: s.name, gradient: s.gradient }; });
    var pairs = [];
    while (pool.length > 1) {
        pool.sort(function(a, b) { return a.gradient - b.gradient; });
        var bestPair = null, bestDiff = Infinity;
        for (var i = 0; i < Math.min(pool.length, 10); i++) {
            for (var j = i + 1; j < Math.min(pool.length, i + 10); j++) {
                var diff = Math.abs(pool[i].gradient - pool[j].gradient);
                var score = Math.abs(diff - 3);
                if (score < bestDiff || (score === bestDiff && Math.random() < 0.3)) { bestDiff = score; bestPair = [i, j]; }
            }
        }
        if (bestPair) { pairs.push([pool[bestPair[0]].name, pool[bestPair[1]].name]); pool.splice(bestPair[1], 1); pool.splice(bestPair[0], 1); }
        else break;
    }
    if (pool.length === 1) pairs.push([pool[0].name, null]);
    var fixedPositions = new Set();
    this.students.filter(function(s) { return s.status === 'fixed'; }).forEach(function(s) { var idx = self.initialMap.indexOf(s.name); if (idx >= 0) fixedPositions.add(idx); }, this);
    var emptyIndices = [];
    solution.forEach(function(n, i) { if (!n && !fixedPositions.has(i)) emptyIndices.push(i); });
    pairs.forEach(function(pair) {
        if (pair[0] && solution.indexOf(pair[0]) < 0) { var ei = emptyIndices.shift(); if (ei !== undefined) solution[ei] = pair[0]; }
        if (pair[1] && solution.indexOf(pair[1]) < 0) { var ei2 = emptyIndices.shift(); if (ei2 !== undefined) solution[ei2] = pair[1]; }
    });
    return solution;
};
SeatingModule.prototype.SeatingOptimizer.prototype.createRandomSolution = function() {
    var solution = this.initialMap.slice();
    var fixedMap = new Set();
    this.students.filter(function(s) { return s.status === 'fixed'; }).forEach(function(s) { var idx = solution.indexOf(s.name); if (idx >= 0) fixedMap.add(idx); });
    var movable = this.students.filter(function(s) { return s.status !== 'fixed' && s.status !== 'empty'; }).map(function(s) { return s.name; });
    var availableSeats = [];
    solution.forEach(function(name, i) { if (!fixedMap.has(i) && (name === null || movable.indexOf(name) >= 0)) availableSeats.push(i); });
    for (var i = movable.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = movable[i]; movable[i] = movable[j]; movable[j] = tmp; }
    availableSeats.forEach(function(idx) { if (!fixedMap.has(idx)) solution[idx] = null; });
    for (var k = 0; k < movable.length && k < availableSeats.length; k++) solution[availableSeats[k]] = movable[k];
    return solution;
};
SeatingModule.prototype.SeatingOptimizer.prototype.evaluateSolution = function(solution) {
    var scores = { subjectComp: 0, gradientDiff: 0, behavior: 0, group: 0, constraints: 0, balance: 0 };
    var totalStudents = solution.filter(function(n) { return n && n !== '\u{1F6AB}'; }).length;
    if (totalStudents < 2) return 0;
    var getCoords = function(idx) { return { row: Math.floor(idx / 8), col: idx % 8 }; };
    var self = this;
    var evaluatedDesks = new Set();
    var evaluatedGroups = new Set();
    var isFB = this.parent.isForbiddenPair.bind(this.parent);
    var getCS = this.parent.getComplementScore.bind(this.parent);
    for (var i = 0; i < solution.length; i++) {
        var name = solution[i];
        if (!name || name === '\u{1F6AB}') continue;
        var student = this.studentMap.get(name);
        if (!student) continue;
        var coords = getCoords(i);
        if (student.status === 'fixed' && this.initialMap[i] !== name) scores.constraints -= 500;
        var partnerIdx = (coords.col % 2 === 0 ? coords.col + 1 : coords.col - 1);
        if (partnerIdx >= 0 && partnerIdx <= 7) {
            var pi = coords.row * 8 + partnerIdx;
            if (pi >= 0 && pi < solution.length && pi > i) {
                var pName = solution[pi];
                if (pName && pName !== '\u{1F6AB}') {
                    var p = this.studentMap.get(pName);
                    if (p) {
                        var g1 = student.gradient || 0, g2 = p.gradient || 0;
                        var diff = Math.abs(g1 - g2);
                        if (isFB(g1, g2)) scores.gradientDiff -= 1000;
                        else scores.gradientDiff += getCS(diff);
                        if (student.tags.some(function(t) { return t === '关系不和:' + pName; })) scores.behavior -= 150;
                        if (student.tags.some(function(t) { return t === '爱说话:' + pName; })) scores.behavior -= 80;
                        if (p.tags.some(function(t) { return t === '关系不和:' + name; })) scores.behavior -= 150;
                        if (p.tags.some(function(t) { return t === '爱说话:' + name; })) scores.behavior -= 80;
                        if (student.tags.indexOf('性格开朗') >= 0 !== p.tags.indexOf('性格开朗') >= 0) scores.behavior += 50;
                        var compCount = this.countComplementSubjects(student, p);
                        scores.subjectComp += compCount * 210;
                    }
                }
            }
        }
        var pairStart = coords.col % 2 === 0 ? coords.col : coords.col - 1;
        var groupKey = coords.row + '-' + pairStart;
        if (!evaluatedGroups.has(groupKey) && pairStart >= 0 && pairStart + 1 < 8) {
            evaluatedGroups.add(groupKey);
            var members = [];
            for (var r = coords.row; r <= coords.row + 1 && r < this.rows; r++) {
                for (var c = pairStart; c <= pairStart + 1 && c < 8; c++) {
                    var idxG = r * 8 + c;
                    var nG = solution[idxG];
                    if (nG && nG !== '\u{1F6AB}') { var sG = this.studentMap.get(nG); if (sG) members.push(sG); }
                }
            }
            if (members.length >= 3) {
                var groupValid = true, groupScore = 0;
                for (var mi = 0; mi < members.length; mi++) {
                    var m = members[mi];
                    var mIdx = solution.indexOf(m.name);
                    var mCoords = getCoords(mIdx);
                    var neighbors = members.filter(function(other) {
                        if (other.name === m.name) return false;
                        var oIdx = solution.indexOf(other.name);
                        var oCoords = getCoords(oIdx);
                        return Math.sqrt(Math.pow(mCoords.row - oCoords.row, 2) + Math.pow(mCoords.col - oCoords.col, 2)) <= 2.5;
                    });
                    var maxComp = 0, hasZero = false;
                    neighbors.forEach(function(n) {
                        var diffN = Math.abs((m.gradient || 0) - (n.gradient || 0));
                        var cs = getCS(diffN);
                        if (cs < 0) hasZero = true;
                        maxComp = Math.max(maxComp, cs);
                    });
                    if (maxComp < 25) { groupValid = false; groupScore -= 100; }
                    if (hasZero) { groupValid = false; groupScore -= 100; }
                }
                if (groupValid) scores.group += 200;
                else scores.group -= 300;
            }
        }
    }
    var quadrants = [0, 0, 0, 0], quadCounts = [0, 0, 0, 0];
    for (var qi = 0; qi < solution.length; qi++) {
        var qName = solution[qi];
        if (!qName || qName === '\u{1F6AB}') continue;
        var qs = this.studentMap.get(qName);
        if (!qs) continue;
        var qCoords = getCoords(qi);
        var qIdx = (qCoords.col < 4 ? 0 : 1) + (qCoords.row < this.rows / 2 ? 0 : 2);
        quadrants[qIdx] += qs.gradient || 5;
        quadCounts[qIdx]++;
    }
    var quadAvgs = quadrants.map(function(sum, i) { return quadCounts[i] > 0 ? sum / quadCounts[i] : 5; });
    var avgGrad = quadAvgs.reduce(function(s, v) { return s + v; }, 0) / 4;
    var variance = quadAvgs.reduce(function(s, v) { return s + Math.pow(v - avgGrad, 2); }, 0) / 4;
    if (variance <= 0.5) scores.balance += 150;
    else if (variance <= 1.0) scores.balance += 80;
    else if (variance >= 2.0) scores.balance -= 150;
    else scores.balance -= 20;
    for (var r = 0; r < this.rows; r++) {
        var highCount = 0, lowCount = 0;
        for (var c = 0; c < 8; c++) {
            var idxR = r * 8 + c, nR = solution[idxR];
            if (!nR || nR === '\u{1F6AB}') continue;
            var sR = this.studentMap.get(nR);
            if (!sR) continue;
            if ((sR.gradient || 5) <= 4) lowCount++; else highCount++;
        }
        var rowTotal = highCount + lowCount;
        if (rowTotal >= 4) { var ratio = Math.min(lowCount, highCount) / rowTotal; if (ratio < 0.2) scores.balance -= 120; else if (ratio < 0.33) scores.balance -= 60; }
    }
    var crossCount = 0, deskTotal = 0;
    for (var di = 0; di < solution.length; di++) {
        var pCol = di % 2 === 0 ? di % 8 + 1 : di % 8 - 1;
        if (pCol < 0 || pCol > 7) continue;
        var pIdx = Math.floor(di / 8) * 8 + pCol;
        if (pIdx <= di || pIdx >= solution.length) continue;
        var n1 = solution[di], n2 = solution[pIdx];
        if (!n1 || n1 === '\u{1F6AB}' || !n2 || n2 === '\u{1F6AB}') continue;
        var s1 = this.studentMap.get(n1), s2 = this.studentMap.get(n2);
        if (!s1 || !s2) continue;
        deskTotal++;
        if (Math.abs((s1.gradient || 0) - (s2.gradient || 0)) >= 2) crossCount++;
    }
    if (deskTotal > 0) scores.balance += (crossCount / deskTotal) * 200 - 100;
    var combinedComplement = scores.subjectComp * 0.92 + scores.gradientDiff * 0.08;
    return combinedComplement * this.weights.complement + scores.behavior * this.weights.behavior + scores.group * this.weights.group + scores.constraints * this.weights.constraints + scores.balance * (this.weights.balance || 0.15);
};
SeatingModule.prototype.SeatingOptimizer.prototype.countComplementSubjects = function(s1, s2) {
    var subjects1 = s1.subjects || {}, subjects2 = s2.subjects || {};
    var allSubjects = new Set([].concat(Object.keys(subjects1)).concat(Object.keys(subjects2)));
    var count = 0, total = this.students.length, median = total / 2;
    allSubjects.forEach(function(sub) {
        var t1 = subjects1[sub], t2 = subjects2[sub];
        if (!t1 || !t2) return;
        var r1 = t1.rank, r2 = t2.rank;
        if (r1 === undefined || r2 === undefined) return;
        if ((r1 <= median) !== (r2 <= median)) count++;
    });
    return count;
};
SeatingModule.prototype.SeatingOptimizer.prototype.select = function(evaluated) {
    var total = evaluated.reduce(function(sum, ind) { return sum + Math.max(0, ind.score + 1000); }, 0);
    if (total === 0) return evaluated.map(function(e) { return e.solution; }).slice(0, this.config.populationSize);
    var selected = [];
    for (var i = 0; i < this.config.populationSize; i++) {
        var pick = Math.random() * total, current = 0;
        for (var j = 0; j < evaluated.length; j++) {
            current += Math.max(0, evaluated[j].score + 1000);
            if (current > pick) { selected.push(evaluated[j].solution); break; }
        }
    }
    return selected;
};
SeatingModule.prototype.SeatingOptimizer.prototype.crossover = function(parents) {
    var children = [];
    for (var i = 0; i < parents.length - 1; i += 2) {
        var p1 = parents[i].slice(), p2 = parents[i + 1].slice();
        var pt = Math.floor(Math.random() * p1.length);
        children.push(this.repair(p1.slice(0, pt).concat(p2.slice(pt))), this.repair(p2.slice(0, pt).concat(p1.slice(pt))));
    }
    return children;
};
SeatingModule.prototype.SeatingOptimizer.prototype.mutate = function(solutions) {
    var self = this;
    return solutions.map(function(sol) {
        if (Math.random() < self.config.mutationRate) {
            var s = sol.slice();
            var movableIndices = s.map(function(name, i) { return name && name !== '\u{1F6AB}' && self.studentMap.get(name)?.status !== 'fixed' ? i : -1; }).filter(function(i) { return i !== -1; });
            if (movableIndices.length >= 2) {
                var i1 = movableIndices[Math.floor(Math.random() * movableIndices.length)];
                var i2 = movableIndices[Math.floor(Math.random() * movableIndices.length)];
                var tmp = s[i1]; s[i1] = s[i2]; s[i2] = tmp;
            }
            return s;
        }
        return sol;
    });
};
SeatingModule.prototype.SeatingOptimizer.prototype.repair = function(child) {
    var movableNames = this.students.filter(function(s) { return s.status !== 'fixed'; }).map(function(s) { return s.name; });
    var counts = {}, extra = [];
    child.forEach(function(name, i) { if (name && name !== '\u{1F6AB}' && movableNames.indexOf(name) >= 0) { counts[name] = (counts[name] || 0) + 1; if (counts[name] > 1) extra.push(i); } });
    var missing = movableNames.filter(function(name) { return !counts[name]; });
    extra.forEach(function(idx) { if (missing.length > 0) child[idx] = missing.pop(); });
    return child;
};

// 轮换操作
SeatingModule.prototype.executeRotation = function() {
    if (!this.students.length) { showAlert('没有学生数据！'); return; }
    var modeEl = this.root.querySelector('#sm-rotationMode');
    var mode = modeEl ? modeEl.value : 'shift';
    this.saveSnapshot();
    var rows = Math.ceil(this.seatMap.length / 8);
    var labels = { shift: '后移一排', swap: '同桌对调', serpentine: 'S型流动', fullCycle: '大循环' };
    var newMap;
    switch (mode) {
        case 'shift':
            newMap = new Array(this.seatMap.length).fill(null);
            for (var r = 0; r < rows; r++) for (var c = 0; c < 8; c++) { var n = this.seatMap[r * 8 + c]; if (n && n !== '\u{1F6AB}') newMap[((r + 1) % rows) * 8 + c] = n; }
            break;
        case 'swap':
            newMap = new Array(this.seatMap.length).fill(null);
            for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < 8; c2++) { var n2 = this.seatMap[r2 * 8 + c2]; if (n2 && n2 !== '\u{1F6AB}') newMap[((r2 + 1) % rows) * 8 + (c2 % 2 === 0 ? c2 + 1 : c2 - 1)] = n2; }
            break;
        case 'serpentine':
            newMap = new Array(this.seatMap.length).fill(null);
            for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < 8; c3++) { var n3 = this.seatMap[r3 * 8 + c3]; if (n3 && n3 !== '\u{1F6AB}') newMap[((r3 + 1) % rows) * 8 + (r3 % 2 === 0 ? (c3 + 1) % 8 : (c3 - 1 + 8) % 8)] = n3; }
            break;
        case 'fullCycle': {
            var path = [];
            for (var r4 = 0; r4 < rows; r4++) { if (r4 % 2 === 0) { for (var c4 = 0; c4 < 8; c4++) path.push(r4 * 8 + c4); } else { for (var c5 = 7; c5 >= 0; c5--) path.push(r4 * 8 + c5); } }
            var names = path.map(function(i) { return this.seatMap[i]; }, this);
            newMap = new Array(this.seatMap.length).fill(null);
            for (var pi = 0; pi < path.length; pi++) { var n4 = names[pi]; if (n4 && n4 !== '\u{1F6AB}') newMap[path[(pi + 2) % path.length]] = n4; }
            break;
        }
    }
    this.seatMap = newMap;
    this.saveAndRender();
    showAlert('"' + (labels[mode] || mode) + '" 轮换完成！');
};

// 快照管理（IndexedDB）
SeatingModule.prototype.saveSnapshot = function() {
    var snapshot = { id: Date.now(), label: '快照 ' + (this.historySnapshots.length + 1) + ' (' + new Date().toLocaleString() + ')', students: deepClone(this.students), seatMap: this.seatMap.slice() };
    this.historySnapshots.push(snapshot);
    if (this.historySnapshots.length > 10) this.historySnapshots = this.historySnapshots.slice(-10);
    this.currentSnapshotIndex = this.historySnapshots.length - 1;
    persistSeatingSnapshots(this.historySnapshots);
    this.renderHistory();
    showAlert('快照已保存！');
};
SeatingModule.prototype.loadSnapshot = function(index) {
    if (index < 0 || index >= this.historySnapshots.length) return;
    var snap = this.historySnapshots[index];
    if (!confirm('确定回滚到"' + snap.label + '"？当前数据将被覆盖。')) return;
    this.students = deepClone(snap.students);
    this.seatMap = snap.seatMap.slice();
    this.currentSnapshotIndex = index;
    persistSeatingSnapshots(this.historySnapshots);
    this.render();
    this.renderHistory();
    showAlert('已回滚到"' + snap.label + '"');
};
SeatingModule.prototype.renderHistory = function() {
    var panel = this.root.querySelector('#sm-historyPanel');
    if (!panel) return;
    panel.innerHTML = '';
    if (!this.historySnapshots.length) { panel.innerHTML = '<div style="color:#999;font-size:0.75rem;padding:4px;">暂无历史快照</div>'; return; }
    var self = this;
    this.historySnapshots.forEach(function(snap, i) {
        var div = document.createElement('div');
        div.className = 'history-item';
        if (i === self.currentSnapshotIndex) div.style.background = '#e3f2fd';
        div.innerHTML = '<span>' + snap.label + '</span>';
        div.onclick = function() { self.loadSnapshot(i); };
        panel.appendChild(div);
    });
};
SeatingModule.prototype.restoreSnapshots = function(snapshots) {
    this.historySnapshots = snapshots || [];
    this.currentSnapshotIndex = -1;
};

// 导出、统计、标签管理
SeatingModule.prototype.exportData = function() {
    if (!this.students.length) { showAlert('没有学生数据可导出！'); return; }
    var wb = XLSX.utils.book_new();
    var seatingData = [['列','第1列','第2列','走廊1','第3列','第4列','走廊2','第5列','第6列','走廊3','第7列','第8列']];
    var numRows = Math.ceil(this.seatMap.length / 8);
    for (var r = 0; r < numRows; r++) {
        var rowData = ['第' + (r + 1) + '行'];
        for (var c = 0; c < 8; c++) {
            var idx = r * 8 + c;
            rowData.push(this.seatMap[idx] || '');
            if (c === 1 || c === 3 || c === 5) rowData.push('---');
        }
        seatingData.push(rowData);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seatingData), '座位安排');
    var studentHeader = ['姓名','状态','座位位置','梯度','总分排名','综合排名%','领先科目','薄弱科目','标签'];
    var studentData = [studentHeader];
    this.students.forEach(function(student) {
        var pos = this.seatMap.indexOf(student.name);
        var seatPos = pos !== -1 ? (Math.floor(pos / 8) + 1) + '行' + ((pos % 8) + 1) + '列' : '未分配';
        studentData.push([student.name || '', student.status || '', seatPos, this.gradientText(student.gradient), student.latestTotalRank || '?', (student.compositeRank || 0).toFixed(1) + '%', student.leadingSubjects || '', student.weakSubjects || '', (student.tags || []).join(', ')]);
    }, this);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(studentData), '学生详细信息');
    var complementData = [['学生A','学生B','座位关系','距离','梯度差','互补分值','是否禁止']];
    for (var i = 0; i < this.seatMap.length; i++) {
        var n1 = this.seatMap[i];
        if (!n1 || n1 === '\u{1F6AB}') continue;
        var s1 = this.students.find(function(x) { return x.name === n1; });
        if (!s1) continue;
        for (var j = i + 1; j < this.seatMap.length; j++) {
            var n2 = this.seatMap[j];
            if (!n2 || n2 === '\u{1F6AB}') continue;
            var s2 = this.students.find(function(x) { return x.name === n2; });
            if (!s2) continue;
            var dist = Math.sqrt(Math.pow(Math.floor(i / 8) - Math.floor(j / 8), 2) + Math.pow((i % 8) - (j % 8), 2));
            if (dist > 3.5) continue;
            var g1 = s1.gradient || 0, g2 = s2.gradient || 0;
            var diff = Math.abs(g1 - g2);
            complementData.push([n1, n2, this.getSeatRelation({ row: Math.floor(i / 8), col: i % 8 }, { row: Math.floor(j / 8), col: j % 8 }), dist.toFixed(2), this.gradientText(g1) + '-' + this.gradientText(g2) + ' (差' + diff + ')', this.getComplementScore(diff), this.isForbiddenPair(g1, g2) ? '⚠️ 禁止' : '允许']);
        }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(complementData), '学科互补分析');
    var stats = this.calculateSeatingStats();
    var statsData = [['统计项','数值','说明']];
    Object.keys(stats).forEach(function(key) { statsData.push([key, stats[key].value, stats[key].description]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statsData), '统计汇总');
    XLSX.writeFile(wb, '座位安排_' + new Date().toLocaleDateString().replace(/\//g, '-') + '.xlsx');
    showAlert('导出成功！');
};
SeatingModule.prototype.showHelpGraph = function() {
    if (!window.echarts) { showAlert('图表库未加载，无法显示帮扶关系图'); return; }
    if (!this.students.length) { showAlert('没有学生数据可展示'); return; }
    var overlay = this.root.querySelector('#sm-helpGraphOverlay');
    var chartEl = this.root.querySelector('#sm-helpGraphChart');
    if (!overlay || !chartEl) return;
    overlay.style.display = 'flex';
    var self = this;
    setTimeout(function() { self.renderHelpGraph(chartEl); }, 40);
};
SeatingModule.prototype.closeHelpGraph = function() {
    var overlay = this.root.querySelector('#sm-helpGraphOverlay');
    var chartEl = this.root.querySelector('#sm-helpGraphChart');
    if (chartEl) safeDisposeChart(chartEl);
    if (overlay) overlay.style.display = 'none';
};
SeatingModule.prototype.renderHelpGraph = function(chartEl) {
    var chart = AppCore.charts.init(chartEl, null, { renderer: 'svg' });
    var self = this;
    var seatedNames = this.seatMap.filter(function(n) { return n && n !== '\u{1F6AB}'; });
    var nodes = this.students.map(function(s) {
        var g = s.gradient || 0;
        return {
            id: s.name,
            name: s.name,
            value: s.latestTotalRank || '',
            category: Math.max(0, g - 1),
            symbolSize: seatedNames.indexOf(s.name) >= 0 ? 42 : 32,
            itemStyle: { color: g >= 1 && g <= 8 ? self.GRADIENT_COLORS[g - 1] : '#94a3b8' },
            tooltip: {
                formatter: function() {
                    return '<b>' + s.name + '</b><br/>梯度: ' + self.gradientText(s.gradient) + '<br/>总分排名: ' + (s.latestTotalRank || '?') + '<br/>优势: ' + (s.leadingSubjects || '无') + '<br/>薄弱: ' + (s.weakSubjects || '无');
                }
            }
        };
    });
    var links = [];
    var added = new Set();
    function addLink(a, b, label, score, color, dashed) {
        if (!a || !b || a === b) return;
        var key = [a, b].sort().join('||') + '||' + label;
        if (added.has(key)) return;
        added.add(key);
        links.push({ source: a, target: b, value: score || 1, label: { show: !!label, formatter: label, fontSize: 10 }, lineStyle: { color: color || '#64748b', width: Math.max(1, Math.min(5, Math.abs(score || 1) / 80)), type: dashed ? 'dashed' : 'solid', opacity: 0.78 } });
    }
    var currentDeskPairs = [];
    for (var i = 0; i < this.seatMap.length; i++) {
        var n1 = this.seatMap[i];
        if (!n1 || n1 === '\u{1F6AB}') continue;
        var pIdx = i % 2 === 0 ? i + 1 : i - 1;
        if (pIdx <= i || pIdx < 0 || pIdx >= this.seatMap.length) continue;
        var n2 = this.seatMap[pIdx];
        if (!n2 || n2 === '\u{1F6AB}') continue;
        currentDeskPairs.push([n1, n2]);
    }
    currentDeskPairs.forEach(function(pair) {
        addLink(pair[0], pair[1], '当前同桌', 35, '#cbd5e1', false);
    });
    this.buildRecommendedHelpLinks().forEach(function(edge) {
        addLink(edge.source, edge.target, edge.label, edge.score, edge.color, false);
    });
    this.students.forEach(function(s) {
        (s.tags || []).forEach(function(t) {
            var m = String(t).match(/^(关系不和|爱说话):(.+)$/);
            if (!m) return;
            var target = m[2];
            if (!self.getStudent(target)) return;
            addLink(s.name, target, m[1], m[1] === '关系不和' ? -150 : -80, '#dc2626', true);
        });
    });
    var categories = this.GRADIENT_LABELS.map(function(label) { return { name: label }; });
    chart.setOption({
        tooltip: { trigger: 'item' },
        legend: { data: this.GRADIENT_LABELS, top: 0, textStyle: { fontSize: 11 } },
        series: [{
            type: 'graph', layout: 'force', roam: true, draggable: true,
            categories: categories, data: nodes, links: links,
            force: { repulsion: 180, edgeLength: [80, 150], gravity: 0.08 },
            label: { show: true, position: 'right', fontSize: 11 },
            edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 6,
            emphasis: { focus: 'adjacency' }
        }]
    });
    chart.resize();
};
SeatingModule.prototype.buildRecommendedHelpLinks = function() {
    var self = this;
    var candidates = [];
    var active = this.students.filter(function(s) { return s && s.status !== 'empty'; });
    function hasBadRelation(a, b) {
        var tagsA = a.tags || [], tagsB = b.tags || [];
        return tagsA.indexOf('关系不和:' + b.name) >= 0 || tagsB.indexOf('关系不和:' + a.name) >= 0 || tagsA.indexOf('爱说话:' + b.name) >= 0 || tagsB.indexOf('爱说话:' + a.name) >= 0;
    }
    for (var i = 0; i < active.length; i++) {
        for (var j = i + 1; j < active.length; j++) {
            var a = active[i], b = active[j];
            var g1 = a.gradient || 0, g2 = b.gradient || 0;
            if (!g1 || !g2) continue;
            var diff = Math.abs(g1 - g2);
            if (diff >= 5) continue;
            if (self.isForbiddenPair(g1, g2)) continue;
            if (hasBadRelation(a, b)) continue;
            var subjComp = self.countHelpSubjects(a, b);
            if (!subjComp) continue;
            var diffScore = diff === 2 || diff === 3 ? 90 : (diff === 1 || diff === 4 ? 45 : 10);
            var score = subjComp * 120 + diffScore;
            var label = '帮扶' + subjComp + '/L差' + diff;
            candidates.push({ source: a.name, target: b.name, score: score, diff: diff, subjComp: subjComp, label: label, color: diff === 2 || diff === 3 ? '#16a34a' : '#2563eb' });
        }
    }
    candidates.sort(function(a, b) { return b.score - a.score; });
    var degree = {};
    var selected = [];
    candidates.forEach(function(edge) {
        var da = degree[edge.source] || 0;
        var db = degree[edge.target] || 0;
        if (da >= 2 || db >= 2) return;
        selected.push(edge);
        degree[edge.source] = da + 1;
        degree[edge.target] = db + 1;
    });
    return selected.slice(0, Math.max(12, Math.ceil(active.length * 0.8)));
};
SeatingModule.prototype.countHelpSubjects = function(s1, s2) {
    var aLead = String(s1.leadingSubjects || '').split(/[,，、]\s*/).filter(Boolean);
    var aWeak = String(s1.weakSubjects || '').split(/[,，、]\s*/).filter(Boolean);
    var bLead = String(s2.leadingSubjects || '').split(/[,，、]\s*/).filter(Boolean);
    var bWeak = String(s2.weakSubjects || '').split(/[,，、]\s*/).filter(Boolean);
    var count = 0;
    aLead.forEach(function(sn) { if (bWeak.indexOf(sn) >= 0) count++; });
    bLead.forEach(function(sn) { if (aWeak.indexOf(sn) >= 0) count++; });
    return count;
};
SeatingModule.prototype.importRecoveryData = function() {
    var self = this;
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(event) {
            try {
                var data = JSON.parse(event.target.result);
                if (!data.students || !data.seatMap) { showAlert('文件格式错误！'); return; }
                if (!confirm('确定导入？当前数据将被覆盖。')) return;
                self.students = data.students;
                self.seatMap = data.seatMap;
                self.saveAndRender();
                showAlert('数据复原成功！');
            } catch (err) { showAlert('文件解析失败：' + err.message); }
        };
        reader.readAsText(file);
    };
    input.click();
};
SeatingModule.prototype.getSeatRelation = function(c1, c2) {
    if (c1.row === c2.row && Math.abs(c1.col - c2.col) === 1) return '同桌';
    if (c1.row === c2.row && Math.abs(c1.col - c2.col) === 2) return '同排邻近';
    if (Math.abs(c1.row - c2.row) === 1 && c1.col === c2.col) return '前后桌';
    if (Math.abs(c1.row - c2.row) === 1 && Math.abs(c1.col - c2.col) === 1) return '斜对角';
    return '邻近';
};
SeatingModule.prototype.calculateSeatingStats = function() {
    var totalSeats = this.seatMap.length || 64;
    var occupiedSeats = this.seatMap.filter(function(s) { return s && s !== '\u{1F6AB}'; }).length;
    var emptySeats = totalSeats - occupiedSeats;
    var fixedStudents = this.students.filter(function(s) { return s.status === 'fixed'; }).length;
    var specialStudents = this.students.filter(function(s) { return s.status === 'special'; }).length;
    var gradientDist = {};
    this.students.forEach(function(s) { var g = s.gradient || 0; gradientDist[g] = (gradientDist[g] || 0) + 1; });
    var forbiddenPairs = 0;
    for (var i = 0; i < this.seatMap.length; i++) {
        var name = this.seatMap[i];
        if (!name || name === '\u{1F6AB}') continue;
        var s = this.students.find(function(x) { return x.name === name; });
        if (!s) continue;
        var partnerIdx = i % 2 === 0 ? i + 1 : i - 1;
        if (partnerIdx < 0 || partnerIdx >= this.seatMap.length) continue;
        var pn = this.seatMap[partnerIdx];
        if (!pn || pn === '\u{1F6AB}') continue;
        var p = this.students.find(function(x) { return x.name === pn; });
        if (p && this.isForbiddenPair(s.gradient || 0, p.gradient || 0)) forbiddenPairs++;
    }
    var result = {
        '学生总数': { value: this.students.length, description: '系统中的学生总数' },
        '已分配座位': { value: occupiedSeats, description: '已安排座位的学生数' },
        '空余座位': { value: emptySeats, description: '未分配的座位数' },
        '固定位置学生': { value: fixedStudents, description: '位置固定的学生数' },
        '重点关注学生': { value: specialStudents, description: '重点关注的学生数' },
        '禁止配对同桌': { value: forbiddenPairs, description: '违反配对规则的同桌对数' },
        '座位利用率': { value: ((occupiedSeats / totalSeats) * 100).toFixed(1) + '%', description: '座位使用率' }
    };
    for (var g = 1; g <= 8; g++) { var count = gradientDist[g] || 0; result[this.GRADIENT_LABELS[g-1] + '人数'] = { value: count, description: this.GRADIENT_LABELS[g-1] + '梯度学生数' }; }
    return result;
};
SeatingModule.prototype.areSeatMapsEqual = function(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
};
SeatingModule.prototype.toggleTag = function(tag) {
    var s = this.students.find(function(x) { return x.name === this.currentEditingName; }, this);
    if (!s) return;
    var idx = s.tags.indexOf(tag);
    if (idx > -1) s.tags.splice(idx, 1); else s.tags.push(tag);
    this.saveAndRender();
    this.openModal(this.currentEditingName);
};
SeatingModule.prototype.updateNoticeTags = function(s) {
    var pool = this.root.querySelector('#sm-pool-notice');
    if (pool) pool.innerHTML = s.tags.filter(function(t) { return t.indexOf('关系不和') >= 0 || t.indexOf('说话') >= 0; }).map(function(t) { return '<div class="tag-item selected">' + t + '</div>'; }).join('');
};
SeatingModule.prototype.toggleTagVisibility = function() {
    this.showTags = !this.showTags;
    var btn = this.root.querySelector('#sm-btnToggleTags');
    if (btn) btn.innerHTML = '\u{1F4CB} 标签：' + (this.showTags ? '开' : '关');
    var btn2 = this.root.querySelector('#sm-btnToggleTags2');
    if (btn2) btn2.innerHTML = '\u{1F4CB} ' + (this.showTags ? '开' : '关');
    this.renderGrid();
};
SeatingModule.prototype.closeModal = function() {
    var modal = this.root.querySelector('#sm-editModal');
    if (modal) modal.classList.remove('active');
    var overlay = this.root.querySelector('#sm-overlay');
    if (overlay) overlay.style.display = 'none';
};
SeatingModule.prototype.dropOnUnseatedList = function(e) {
    e.preventDefault();
    if (this.dragged.source === 'seat') { this.seatMap[this.dragged.index] = null; this.dragged = { source: null, name: null, index: -1 }; this.saveAndRender(); }
};
SeatingModule.prototype.renderUnseatedList = function() {
    var container = this.root.querySelector('#sm-unseatedList');
    if (!container) return;
    var seatedNames = this.seatMap.filter(function(n) { return n && n !== '\u{1F6AB}'; });
    var unseatedStudents = this.students.filter(function(s) { return seatedNames.indexOf(s.name) < 0; });
    container.innerHTML = '';
    var self = this;
    unseatedStudents.forEach(function(s) {
        var item = document.createElement('div');
        item.className = 'student-item';
        item.setAttribute('draggable', 'true');
        item.textContent = s.name;
        item.ondragstart = function(e) { self.dragged = { source: 'list', name: s.name, index: -1 }; e.dataTransfer.setData('text/plain', s.name); item.classList.add('dragging'); };
        item.ondragend = function() { item.classList.remove('dragging'); };
        container.appendChild(item);
    });
};
SeatingModule.prototype.addConflict = function() {
    var input = this.root.querySelector('#sm-conflictInput');
    if (!input) return;
    var name = input.value.trim();
    if (!name) return;
    var s = this.students.find(function(x) { return x.name === this.currentEditingName; }, this);
    var conflictStudent = this.students.find(function(x) { return x.name === name; });
    if (!conflictStudent) { showAlert('未找到该学生！'); return; }
    if (s) {
        var tag = '关系不和:' + name;
        if (s.tags.indexOf(tag) < 0) s.tags.push(tag);
        var reverseTag = '关系不和:' + s.name;
        if (conflictStudent.tags.indexOf(reverseTag) < 0) conflictStudent.tags.push(reverseTag);
        input.value = '';
        this.saveAndRender();
        this.openModal(this.currentEditingName);
    }
};
SeatingModule.prototype.addChatPartner = function() {
    var input = this.root.querySelector('#sm-chatInput');
    if (!input) return;
    var name = input.value.trim();
    if (!name) return;
    var s = this.students.find(function(x) { return x.name === this.currentEditingName; }, this);
    var partner = this.students.find(function(x) { return x.name === name; });
    if (!partner) { showAlert('未找到该学生！'); return; }
    if (s) {
        var tag = '爱说话:' + name;
        if (s.tags.indexOf(tag) < 0) s.tags.push(tag);
        var reverseTag = '爱说话:' + s.name;
        if (partner.tags.indexOf(reverseTag) < 0) partner.tags.push(reverseTag);
        input.value = '';
        this.saveAndRender();
        this.openModal(this.currentEditingName);
    }
};
SeatingModule.prototype.clearAll = function() {
    if (confirm('确定清空所有数据吗？包括学生、座位和历史快照。')) {
        this.students = []; this.seatMap = []; this.historySnapshots = [];
        persistSeatingSnapshots([]);
        this.render();
        this.renderHistory();
    }
};
SeatingModule.prototype.showAdvancedOptions = function() {
    var overlay = this.root.querySelector('#sm-advancedOverlay');
    var modal = this.root.querySelector('#sm-advancedModal');
    if (overlay) overlay.style.display = 'block';
    if (modal) modal.classList.add('active');
    this.loadAdvancedSettings();
};
SeatingModule.prototype.closeAdvancedModal = function() {
    var overlay = this.root.querySelector('#sm-advancedOverlay');
    var modal = this.root.querySelector('#sm-advancedModal');
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.classList.remove('active');
};
SeatingModule.prototype.loadAdvancedSettings = function() {
    var layoutEl = this.root.querySelector('#sm-layout-' + this.advancedSettings.layout);
    if (layoutEl) layoutEl.classList.add('selected');
    var gsEl = this.root.querySelector('#sm-groupSize');
    if (gsEl) gsEl.value = [4,6,8].indexOf(this.advancedSettings.groupSize) >= 0 ? String(this.advancedSettings.groupSize) : 'custom';
    var customSection = this.root.querySelector('#sm-customGroupSection');
    if ([4,6,8].indexOf(this.advancedSettings.groupSize) < 0) { if (customSection) customSection.style.display = 'block'; var csEl = this.root.querySelector('#sm-customGroupSize'); if (csEl) csEl.value = this.advancedSettings.customGroupSize || 6; }
    var self = this;
    Object.keys(this.advancedSettings.weights).forEach(function(key) {
        var slider = self.root.querySelector('#sm-' + key + 'Slider');
        var span = self.root.querySelector('#sm-' + key + 'Weight');
        if (slider && span) { slider.value = self.advancedSettings.weights[key]; span.textContent = self.advancedSettings.weights[key].toFixed(1); }
    });
};
SeatingModule.prototype.selectLayout = function(layout) {
    this.root.querySelectorAll('[id^="sm-layout-"]').forEach(function(el) { el.classList.remove('selected'); });
    var el = this.root.querySelector('#sm-layout-' + layout);
    if (el) el.classList.add('selected');
    this.advancedSettings.layout = layout;
};
SeatingModule.prototype.updateWeight = function(type, value) {
    var span = this.root.querySelector('#sm-' + type + 'Weight');
    if (span) span.textContent = parseFloat(value).toFixed(1);
    this.advancedSettings.weights[type] = parseFloat(value);
};
SeatingModule.prototype.applyAdvancedSettings = function() {
    var gsEl = this.root.querySelector('#sm-groupSize');
    if (gsEl) {
        if (gsEl.value === 'custom') {
            var csEl = this.root.querySelector('#sm-customGroupSize');
            var customSize = parseInt(csEl ? csEl.value : '6');
            if (!customSize || customSize < 2 || customSize > 12) { showAlert('请输入2-12之间的分组人数'); return; }
            this.advancedSettings.groupSize = customSize;
            this.advancedSettings.customGroupSize = customSize;
        } else {
            this.advancedSettings.groupSize = parseInt(gsEl.value);
            this.advancedSettings.customGroupSize = null;
        }
    }
    this.generateStandardLayout();
    this.closeAdvancedModal();
};
SeatingModule.prototype.applyLayoutSettings = function() { this.generateStandardLayout(); };
SeatingModule.prototype.generateStandardLayout = function() {
    this.seatMap = new Array(Math.max(Math.ceil(this.students.length / 8) * 8, 8)).fill(null);
    var gridEl = this.root.querySelector('#sm-seatGrid');
    if (gridEl) gridEl.style.gridTemplateColumns = '1fr 1fr 40px 1fr 1fr 40px 1fr 1fr 40px 1fr 1fr';
    this.saveAndRender();
};
SeatingModule.prototype.resetAdvancedSettings = function() {
    if (!confirm('确定要重置所有高级设置为默认值吗？')) return;
    this.advancedSettings = { layout: 'default', groupSize: 6, customGroupSize: null, weights: { complement: 1.0, behavior: 1.0, group: 1.0, constraints: 1.0, balance: 1.0 } };
    this.loadAdvancedSettings();
};
SeatingModule.prototype.getStudent = function(name) { return this.students.find(function(s) { return s.name === name; }); };
SeatingModule.prototype.getSeatCoords = function(index) { return { row: Math.floor(index / 8), col: index % 8 }; };
SeatingModule.prototype.getDistance = function(idx1, idx2) {
    var c1 = this.getSeatCoords(idx1), c2 = this.getSeatCoords(idx2);
    return Math.sqrt(Math.pow(c1.row - c2.row, 2) + Math.pow(c1.col - c2.col, 2));
};
SeatingModule.prototype.saveAndRender = function() { this.renderGrid(); this.renderUnseatedList(); this.renderRightSidebarStats(); };
SeatingModule.prototype.renderRightSidebarStats = function() {
    var statsEl = this.root.querySelector('#sm-rightSidebarStats');
    var gradEl = this.root.querySelector('#sm-gradientOverview');
    if (!statsEl || !gradEl) return;
    if (!this.students.length) { statsEl.innerHTML = '<div style="color:#999;">暂无学生数据</div>'; gradEl.innerHTML = '<div style="color:#999;">暂无梯度数据</div>'; return; }
    var occupiedSeats = this.seatMap.filter(function(s) { return s && s !== '\u{1F6AB}'; }).length;
    var fixedCount = this.students.filter(function(s) { return s.status === 'fixed'; }).length;
    var specialCount = this.students.filter(function(s) { return s.status === 'special'; }).length;
    var forbiddenPairs = 0;
    for (var i = 0; i < this.seatMap.length; i++) {
        var name = this.seatMap[i];
        if (!name || name === '\u{1F6AB}') continue;
        var pi = i % 2 === 0 ? i + 1 : i - 1;
        if (pi < 0 || pi >= this.seatMap.length) continue;
        var pn = this.seatMap[pi];
        if (!pn || pn === '\u{1F6AB}') continue;
        var s1 = this.students.find(function(x) { return x.name === name; });
        var s2 = this.students.find(function(x) { return x.name === pn; });
        if (s1 && s2 && this.isForbiddenPair(s1.gradient || 0, s2.gradient || 0)) forbiddenPairs++;
    }
    statsEl.innerHTML = '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #eee;"><span>学生总数</span><span><b>' + this.students.length + '</b></span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #eee;"><span>已分配座位</span><span><b>' + occupiedSeats + '</b></span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #eee;"><span>固定位置</span><span><b>' + fixedCount + '</b></span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #eee;"><span>重点关注</span><span><b>' + specialCount + '</b></span></div>' +
        '<div style="display:flex;justify-content:space-between;padding:3px 0;' + (forbiddenPairs > 0 ? 'color:#e74c3c;' : '') + '"><span>禁止配对</span><span><b>' + forbiddenPairs + '</b></span></div>';
    var gradDist = {};
    this.students.forEach(function(s) { var g = s.gradient || 0; gradDist[g] = (gradDist[g] || 0) + 1; });
    var gradHtml = '';
    for (var g = 1; g <= 8; g++) {
        var count = gradDist[g] || 0;
        gradHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #eee;"><span><span class="gradient-badge" style="background:' + this.GRADIENT_COLORS[g-1] + '">' + this.GRADIENT_LABELS[g-1] + '</span></span><span><b>' + count + '</b>人</span></div>';
    }
    gradEl.innerHTML = gradHtml;
};

return SeatingModule;
})();

// ============================================================
//  座位 Tab 刷新
// ============================================================
function refreshSeatingTab() {
    var sel = document.getElementById('seatingClassFilter');
    if (!sel) return;
    sel.innerHTML = '';
    var clsSet = new Set();
    combinedStudentData.forEach(function(s) { if (s.class) clsSet.add(s.class); });
    var clsList = Array.from(clsSet).sort();
    clsList.forEach(function(c) { var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
    // Sync with comprehensive tab class filter
    var comprehensiveSel = document.getElementById('comprehensiveClassFilter');
    if (comprehensiveSel && comprehensiveSel.value && clsList.indexOf(comprehensiveSel.value) >= 0) sel.value = comprehensiveSel.value;
    else if (clsList.length) sel.value = clsList[0];
}

// Connect seating refresh button
document.getElementById('seatingRefreshBtn').addEventListener('click', function() {
    if (!combinedStudentData.length) { showAlert('请先上传成绩数据'); return; }
    var className = document.getElementById('seatingClassFilter').value;
    var profiles = buildSeatingProfiles(className);
    if (!profiles.length) { showAlert('该班级无有效数据或人数不足4人'); return; }
    if (!seatingModuleInstance) {
        seatingModuleInstance = new SeatingModule(document.getElementById('seating-module-root'));
    }
    // Restore snapshots from IndexedDB
    restoreSeatingSnapshots().then(function(snapshots) {
        seatingModuleInstance.restoreSnapshots(snapshots);
        seatingModuleInstance.init(profiles);
    });
});

// Also load data when class filter changes (optional auto-reload)
document.getElementById('seatingClassFilter').addEventListener('change', function() {
    // Just update the batch info, actual load is manual
    var className = this.value;
    var count = combinedStudentData.filter(function(s) { return String(s.class) === className; }).length;
    var infoEl = document.getElementById('batchInfoSeating');
    if (infoEl) infoEl.textContent = className + ' (' + count + ' 名学生)';
});

// Restore seating snapshots on startup
setTimeout(function() {
    restoreSeatingSnapshots().then(function(snapshots) {
        if (snapshots && snapshots.length > 0 && seatingModuleInstance) {
            seatingModuleInstance.restoreSnapshots(snapshots);
        }
    });
}, 200);
