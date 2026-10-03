/* 座位管理：数据模型、交互布局、快照保存和事件绑定。
 * Classic script: reads the shared data pool only when an analysis is invoked.
 */
// ============================================================
//  座位 — 数据构建
// ============================================================
function buildSeatingProfiles(className) {
    return SeatingData.buildProfiles(combinedStudentData, allSubjectHeaders, className,
        getTotalSubjectName(allSubjectHeaders, combinedStudentData), DataPool.batches,
        typeof COMBINED_SUBJECT_NAMES !== 'undefined' ? Array.from(COMBINED_SUBJECT_NAMES) : []);
}
var seatingStore = SeatingData.createStore(AppCore.storage, {
    getItem: function(key) { return window.localStorage.getItem(key); },
    setItem: function(key, value) { window.localStorage.setItem(key, value); }
}, window.location.pathname.replace(/[^/]*$/, ''));
var seatingLoadEpoch = 0;

// ============================================================
//  IndexedDB 座位快照存储
// ============================================================
async function persistSeatingSnapshots(snapshots) {
    try { await AppCore.storage.write('seating_snapshots', snapshots); return true; }
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

SeatingModule.prototype.init = function(profiles, options) {
    options = options || {};
    this.className = options.className || profiles[0]?.className || document.getElementById('seatingClassFilter').value || '未分班';
    this.profiles = AppCore.clone(profiles);
    var saved = options.saved || (options.preserve ? this.captureState('成绩刷新') : null);
    var state = SeatingData.reconcile(profiles, saved);
    this.students = state.students;
    this.seatMap = state.seatMap;
    if (saved) {
        this.latestSnapshot=saved;
        this.advancedSettings = AppCore.clone(saved.advancedSettings || this.advancedSettings);
        this.showTags = saved.showTags !== false;
    } else {
        this.seatMap.fill(null);
        this.assignInitialSeats();
    }
    this.render(); this.renderHistory(); this.initModalPools(); this.renderRightSidebarStats();
};

// Overall class-relative position already accounts for score ties and missing data.
SeatingModule.prototype.calculateGradients = function() {
    this.students.forEach(function(s) {
        s.gradient = Number.isFinite(s.compositeRank) ? Math.min(8, Math.floor(s.compositeRank / 12.5) + 1) : 0;
    });
};
SeatingModule.prototype.getComplementScore = function(diff) {
    if (!Number.isFinite(diff) || diff < 0) return 0;
    if (diff >= 5) return -200;
    if (diff === 0) return 25;
    if (diff === 1) return 50;
    if (diff === 2) return 80;
    if (diff === 3) return 100;
    if (diff === 4) return 60;
    return -200;
};
SeatingModule.prototype.isForbiddenPair = function(g1, g2) {
    if (!g1 || !g2) return false;
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
                '<p class="mode-hint">本次班内相对位置 L1–L8；优势科目与薄弱科目配对，缺失成绩不参与</p>' +
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
                '<button class="btn2-clear" id="sm-btnClear">\u{1F5D1}\uFE0F 清空排位</button>' +
            '</div>' +
            '<div class="sb-card">' +
                '<div class="sb-card-title">\u{1F464} 待分配学生</div>' +
                '<div class="student-list" id="sm-unseatedList" data-sm-drop="unseated"></div>' +
            '</div>' +
             '<div class="sb-card">' +
                 '<div class="sb-card-title">\u{1F4E5} 导出与复原</div>' +
                 '<button class="btn2 btn2-toggle btn2-block" id="sm-btnExport">\u{1F4E4} 导出Excel</button>' +
                 '<button class="btn2 btn2-toggle btn2-block" style="margin-top:4px" id="sm-btnHelpGraph">帮扶关系图</button>' +
                 '<button class="btn2 btn2-toggle btn2-block" style="margin-top:4px" id="sm-btnRecoveryExport">导出复原JSON</button>' +
                 '<button class="btn2 btn2-toggle btn2-block" style="margin-top:4px" id="sm-btnImport">\u{1F4C2} 导入复原JSON</button>' +
             '</div>' +
            '<div class="sb-card">' +
                '<div class="sb-card-title">\u{1F4D6} 自动快照</div>' +
                '<p id="sm-saveStatus" role="status" aria-live="polite" style="font-size:12px;margin-bottom:6px;">每次改动自动保存，刷新后可恢复</p>' +
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
                        '<div><b>学习小组：</b>按高级设置分组</div>' +
                        '<div><b>成绩口径：</b>本次班内有效成绩，同分并列；优势相对位置≤20%，薄弱≥75%，缺失不计</div>' +
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
    var btnRecovery=this.root.querySelector('#sm-btnRecoveryExport');
    if(btnRecovery)btnRecovery.onclick=function(){self.exportRecoveryData();};
    // Import
    var btnImp = this.root.querySelector('#sm-btnImport');
    if (btnImp) btnImp.onclick = function() { self.importRecoveryData(); };
    // Snapshots
    var btnSnap = this.root.querySelector('#sm-btnSnapshot');
    if (btnSnap) btnSnap.onclick = function() { self.saveSnapshot(); };
    var unseated=this.root.querySelector('#sm-unseatedList');
    if(unseated){unseated.ondragover=function(e){e.preventDefault();};unseated.ondrop=function(e){self.dropOnUnseatedList(e);};}
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
    return loadSeatingClass(document.getElementById('seatingClassFilter').value);
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
            let seat = document.createElement('div');
            seat.className = 'seat';
            if (name === '\u{1F6AB}') {
                seat.classList.add('empty-seat');
                seat.innerHTML = '<div style="color:#999;font-size:1.2rem">\u{1F6AB}</div><div style="color:#999;font-size:0.7rem">空位</div>';
                seat.onclick = function(i) { return function() { if (confirm('是否取消此位置的空位标记？')) { self.seatMap[i] = null; self.saveAndRender(); } }; }(idx);
            } else if (name) {
                seat.setAttribute('draggable', String(this.getStudent(name)?.status !== 'fixed'));
                seat.ondragstart = function(i, n) { return function(e) { self.dragged = { source: 'seat', name: n, index: i }; e.dataTransfer.setData('text/plain', n); }; }(idx, name);
                seat.ondragover = function(e) { e.preventDefault(); seat.classList.add('drag-over'); };
                seat.ondragleave = function() { seat.classList.remove('drag-over'); };
                seat.ondrop = function(i) { return function(e) {
                    e.preventDefault(); seat.classList.remove('drag-over');
                    self.moveStudent(self.dragged.name,i);self.dragged={source:null,name:null,index:-1};
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
                                var diff = s.gradient && p.gradient ? Math.abs(s.gradient - p.gradient) : null;
                                tagsHtml += '<span class="mini-tag">同桌:' + this.gradientText(pg) + ' · 梯度分:' + this.getComplementScore(diff) + '</span><span class="mini-tag">学科互补:' + this.countHelpSubjects(s,p) + '科</span>';
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
                    self.moveStudent(self.dragged.name,i);self.dragged={source:null,name:null,index:-1};
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
    var group = SeatingData.groups(this.seatMap, this.advancedSettings.groupSize).find(function(indices) { return indices.indexOf(index) >= 0; }) || [];
    return group.filter(function(i) { return this.seatMap[i] && this.seatMap[i] !== '🚫'; }, this)
        .map(function(i) { return {name:this.seatMap[i],index:i}; }, this);
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
    var diff = g && partnerG ? Math.abs(g - partnerG) : null;
    var compScore = this.getComplementScore(diff);
    var subjectCount = Object.keys(s.subjects || {}).length;
    var groupMembers = seatIdx >= 0 ? this.getFourPersonGroup(seatIdx).filter(function(m) { return m.name !== s.name; }) : [];
    var groupHtml = groupMembers.map(function(m) { var mg = self.students.find(function(x) { return x.name === m.name; })?.gradient || 0; return '<span class="mini-tag">' + m.name + '(' + self.gradientText(mg) + ')</span>'; }).join(' ');
    var gradientHtml = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span class="gradient-badge" style="background:' + gColor + '">' + gLabel + '</span><span><strong>梯度：</strong>' + gLabel + ' | 班内综合名次：' + (s.latestTotalRank || '?') + '/' + (s.totalPopulation || '?') + '</span></div>' +
        '<div style="margin-top:4px;"><strong>同桌：</strong>' + (deskPartner || '无') + (deskPartner ? ' | 同桌梯度：' + this.gradientText(partnerG) + ' | 梯度配对分值：' + compScore + ' | 学科互补：' + this.countHelpSubjects(s,this.getStudent(deskPartner)) + '科' + (diff >= 5 ? '<span style="color:red;margin-left:8px;"> ⚠️ 禁止配对！</span>' : '') : '') + '</div>' +
        '<div style="margin-top:4px;"><strong>四人小组：</strong>' + (groupHtml || '未就座') + '</div>' +
        (s.leadingSubjects ? '<div style="margin-top:4px;"><strong>领先科目：</strong><span class="mini-tag good">' + s.leadingSubjects + '</span></div>' : '') +
        (s.weakSubjects ? '<div style="margin-top:4px;"><strong>薄弱科目：</strong><span class="mini-tag bad">' + s.weakSubjects + '</span></div>' : '') +
        (subjectCount > 0 ? '<div style="margin-top:4px;font-size:0.7rem;color:#999;">已解析 ' + subjectCount + ' 科趋势数据</div>' : '');
    var giEl = this.root.querySelector('#sm-gradientInfoContent');
    if (giEl) giEl.innerHTML = gradientHtml;
    this.root.querySelectorAll('.tag-item').forEach(function(el) { el.classList.remove('selected'); });
    s.tags.forEach(function(st) { self.root.querySelectorAll('.tag-item[data-sm-tag="' + st + '"]').forEach(function(el) { el.classList.add('selected'); }); });
    [['opt-fixed','fixed'],['opt-special','special']].forEach(function(p) {
        var el = self.root.querySelector('[data-sm-status="' + p[1] + '"]');
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
    var section=this.root.querySelector('#sm-analysisSection');if(section)section.style.display='block';
    var position=Number.isFinite(s.compositeRank)?s.compositeRank.toFixed(1)+'%（越小越靠前）':'数据不足';
    var html='<div class="analysis-item"><strong>本次班内相对位置：</strong>'+position+'</div>'+
        '<div class="analysis-item"><strong>综合依据：</strong>'+escapeHtml(s.totalSource || '总分')+'；有效人数 '+(s.totalPopulation || 0)+'</div>'+
        '<div class="analysis-item"><strong>班内综合名次：</strong>'+(s.latestTotalRank ?? '—')+'；梯度 '+this.gradientText(s.gradient)+'</div>'+
        '<div class="analysis-item"><strong>原年级总分名次：</strong>'+(s.gradeRank ?? '—')+'（仅展示，不作班内百分比的分母）</div>'+
        '<div class="analysis-item"><strong>近三批次班内总分名次：</strong>'+escapeHtml((s.totalTrend || []).join(' → ') || '无')+'</div>';
    Object.entries(s.subjects || {}).forEach(function(pair) {
        var sn=pair[0],sd=pair[1],pct=Number.isFinite(sd.percentile)?sd.percentile.toFixed(1)+'%':'数据不足';
        html+='<div class="analysis-item"><strong>'+escapeHtml(sn)+':</strong> 本次得分 '+(sd.score ?? '—')+'；班内名次 '+(sd.rank ?? '—')+'/'+(sd.population || 0)+'；相对位置 '+pct+
            '<br><span style="color:#666">'+escapeHtml(sd.source || '')+'；历史班内名次 '+escapeHtml((sd.trend || []).join(' → ') || '无')+'</span></div>';
    });
    var el=this.root.querySelector('#sm-analysisContent');if(el)el.innerHTML=html;
};

// 智能排位优化
SeatingModule.prototype.runOptimization = function(type) {
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
    if(!SeatingData.validMap(nextMap,this.students,this.seatMap)){showAlert('排座校验失败，原排位已保留');return;}
    this.seatMap = nextMap;
    this.saveAndRender('智能排座：'+type);
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
    Object.keys(targetWeights).forEach(function(key) { var aw = self.advancedSettings.weights[key] ?? 1.0; self.weights[key] = targetWeights[key] * aw; });
    var totalWeight = Object.values(this.weights).reduce(function(s, w) { return s + w; }, 0);
    if(totalWeight===0)return {solution:this.initialMap.slice(),score:0};
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
    var movable = this.students.filter(function(s) { return s.status !== 'empty' && s.status !== 'fixed' && this.initialMap.includes(s.name); },this);
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
    solution=solution.map(function(n,i){return fixedPositions.has(i) || n==='🚫' ? n : null;});
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
    var movable = this.students.filter(function(s) { return s.status !== 'fixed' && s.status !== 'empty' && this.initialMap.includes(s.name); },this).map(function(s) { return s.name; });
    var availableSeats = [];
    solution.forEach(function(name, i) { if (!fixedMap.has(i) && (name === null || movable.indexOf(name) >= 0)) availableSeats.push(i); });
    for (var i = movable.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = movable[i]; movable[i] = movable[j]; movable[j] = tmp; }
    availableSeats.forEach(function(idx) { if (!fixedMap.has(idx)) solution[idx] = null; });
    for (var k = 0; k < movable.length && k < availableSeats.length; k++) solution[availableSeats[k]] = movable[k];
    return solution;
};
SeatingModule.prototype.SeatingOptimizer.prototype.evaluateSolution = function(solution) {
    if(!SeatingData.validMap(solution,this.students,this.initialMap))return -Infinity;
    var scores = { subjectComp: 0, gradientDiff: 0, behavior: 0, group: 0, constraints: 0, balance: 0 };
    var totalStudents = solution.filter(function(n) { return n && n !== '\u{1F6AB}'; }).length;
    if (totalStudents < 2) return 0;
    var getCoords = function(idx) { return { row: Math.floor(idx / 8), col: idx % 8 }; };
    var self = this;
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
                        if(g1 && g2){if(isFB(g1,g2))scores.gradientDiff-=1000;else scores.gradientDiff+=getCS(diff);}
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
    }
    SeatingData.groups(solution,this.advancedSettings.groupSize).forEach(function(indices) {
        var members=indices.map(function(i){return self.studentMap.get(solution[i]);}).filter(Boolean);
        if(members.length<3)return;
        var allHavePartner=members.every(function(member){return members.some(function(other){return other!==member && self.countComplementSubjects(member,other)>0;});});
        scores.group+=allHavePartner?200:0;
    });
    var quadrants = [0, 0, 0, 0], quadCounts = [0, 0, 0, 0];
    for (var qi = 0; qi < solution.length; qi++) {
        var qName = solution[qi];
        if (!qName || qName === '\u{1F6AB}') continue;
        var qs = this.studentMap.get(qName);
        if (!qs || !qs.gradient) continue;
        var qCoords = getCoords(qi);
        var qIdx = (qCoords.col < 4 ? 0 : 1) + (qCoords.row < this.rows / 2 ? 0 : 2);
        quadrants[qIdx] += qs.gradient;
        quadCounts[qIdx]++;
    }
    var quadAvgs = quadrants.map(function(sum, i) { return quadCounts[i] > 0 ? sum / quadCounts[i] : null; }).filter(Number.isFinite);
    if(quadAvgs.length>1) {
        var avgGrad = quadAvgs.reduce(function(s, v) { return s + v; }, 0) / quadAvgs.length;
        var variance = quadAvgs.reduce(function(s, v) { return s + Math.pow(v - avgGrad, 2); }, 0) / quadAvgs.length;
        if (variance <= 0.5) scores.balance += 150;
        else if (variance <= 1.0) scores.balance += 80;
        else if (variance >= 2.0) scores.balance -= 150;
        else scores.balance -= 20;
    }
    for (var r = 0; r < this.rows; r++) {
        var highCount = 0, lowCount = 0;
        for (var c = 0; c < 8; c++) {
            var idxR = r * 8 + c, nR = solution[idxR];
            if (!nR || nR === '\u{1F6AB}') continue;
            var sR = this.studentMap.get(nR);
            if (!sR || !sR.gradient) continue;
            if (sR.gradient <= 4) lowCount++; else highCount++;
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
        if (!s1 || !s2 || !s1.gradient || !s2.gradient) continue;
        deskTotal++;
        if (Math.abs(s1.gradient - s2.gradient) >= 2) crossCount++;
    }
    if (deskTotal > 0) scores.balance += (crossCount / deskTotal) * 200 - 100;
    var combinedComplement = scores.subjectComp * 0.92 + scores.gradientDiff * 0.08;
    return combinedComplement * this.weights.complement + scores.behavior * this.weights.behavior + scores.group * this.weights.group + scores.constraints * this.weights.constraints + scores.balance * (this.weights.balance ?? 0.15);
};
SeatingModule.prototype.SeatingOptimizer.prototype.countComplementSubjects = function(a,b) { return SeatingData.complementDetails(a,b).length; };
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
SeatingModule.prototype.SeatingOptimizer.prototype.repair = function(child) { return SeatingData.repairMap(child,this.students,this.initialMap); };

// 轮换操作
SeatingModule.prototype.executeRotation = function() {
    if(!this.students.length)return;
    var mode=this.root.querySelector('#sm-rotationMode').value, original=this.seatMap.slice(), rows=Math.ceil(original.length/8), path=[];
    if(mode==='swap') {
        for(var i=0;i<original.length;i+=2) {
            if(this.getStudent(original[i])?.status==='fixed' || this.getStudent(original[i+1])?.status==='fixed' || original[i]==='🚫' || original[i+1]==='🚫')continue;
            this.seatMap[i]=original[i+1];this.seatMap[i+1]=original[i];
        }
    } else {
        if(mode==='shift'){for(var c=0;c<8;c++)for(var r=0;r<rows;r++)path.push(r*8+c);}
        else {for(var r=0;r<rows;r++)for(var c=0;c<8;c++)path.push(r*8+(r%2===0?c:7-c));}
        if(mode==='shift') {
            for(var c=0;c<8;c++){var column=path.slice(c*rows,(c+1)*rows).filter(function(i){return original[i]!=='🚫' && this.getStudent(original[i])?.status!=='fixed';},this);column.forEach(function(i,k){this.seatMap[column[(k+1)%column.length]]=original[i];},this);}
        } else {
            path=path.filter(function(i){return original[i]!=='🚫' && this.getStudent(original[i])?.status!=='fixed';},this);
            path.forEach(function(i,k){this.seatMap[path[(k+(mode==='fullCycle'?2:1))%path.length]]=original[i];},this);
        }
    }
    this.saveAndRender('轮换：'+{shift:'后移一排',swap:'同桌对调',serpentine:'S型流动',fullCycle:'大循环'}[mode]);
};

// Every mutation captures a synchronous journal, then commits an append-only snapshot.
SeatingModule.prototype.captureState = function(reason) {
    return {id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now()+'_'+Math.random().toString(16).slice(2),
        createdAt:new Date().toISOString(),reason:reason || '手动调整',className:this.className,
        batchId:DataPool.currentBatchId || null,batchLabel:DataPool.getCurrentBatch()?.label || '未保存批次',
        students:AppCore.clone(this.students),seatMap:this.seatMap.slice(),showTags:this.showTags,
        advancedSettings:AppCore.clone(this.advancedSettings)};
};
SeatingModule.prototype.saveSnapshot = function(reason) {
    var snapshot=this.captureState(reason || '手动保存');
    var signature=JSON.stringify([snapshot.className,snapshot.batchId,snapshot.batchLabel,snapshot.students,snapshot.seatMap,snapshot.showTags,snapshot.advancedSettings]);
    if(reason && signature===this.lastSavedSignature)return this.pendingSave || Promise.resolve(true);
    this.lastSavedSignature=signature;
    var entry={id:snapshot.id,createdAt:snapshot.createdAt,reason:snapshot.reason,batchLabel:snapshot.batchLabel,className:this.className};
    this.historySnapshots.push(entry);
    this.currentSnapshotIndex=this.historySnapshots.length-1;
    this.latestSnapshot=snapshot;
    var self=this, result=seatingStore.save(this.className,snapshot,this.historySnapshots);
    this.renderHistory();this.setSaveStatus(result.localSaved?'已在本地记录，正在保存…':'正在保存…');
    var task=result.promise.then(function() {
        if(self.latestSnapshot?.id===snapshot.id)self.setSaveStatus('已保存 · '+new Date(snapshot.createdAt).toLocaleTimeString());
        return true;
    }).catch(function(error) {
        if(self.latestSnapshot?.id===snapshot.id)self.setSaveStatus(result.localSaved?'浏览器数据库写入失败，已保留本地待保存记录':'保存失败：'+error.message,true);
        return false;
    });
    this.pendingSave=task;
    return task;
};
SeatingModule.prototype.setSaveStatus = function(message, failed) {
    if(seatingModuleInstance && seatingModuleInstance!==this && seatingModuleInstance.root===this.root)return;
    var el=this.root.querySelector('#sm-saveStatus');
    if(el){el.textContent=message;el.style.color=failed?'#b91c1c':'#047857';}
};
SeatingModule.prototype.loadSnapshot = async function(index) {
    var entry=this.historySnapshots[index];if(!entry)return;
    if(!confirm('恢复这份排位？当前排位会先自动保留，学生成绩仍采用本次数据。'))return;
    var className=this.className,epoch=seatingLoadEpoch;
    try {
        var snap=await seatingStore.snapshot(className,entry);
        if(this.className!==className || seatingModuleInstance!==this || epoch!==seatingLoadEpoch)return;
        if(!snap || AppCore.classKey(snap.className)!==AppCore.classKey(className))throw new Error('快照班级不匹配');
        await this.saveSnapshot('恢复前保留');
        if(seatingModuleInstance!==this || epoch!==seatingLoadEpoch)return;
        var profiles=buildSeatingProfiles(className);
        if(!profiles.length){this.students=AppCore.clone(snap.students);this.seatMap=snap.seatMap.slice();this.advancedSettings=AppCore.clone(snap.advancedSettings || this.advancedSettings);this.showTags=snap.showTags!==false;this.render();this.initModalPools();}
        else this.init(profiles,{className:className,saved:snap});
        await this.saveSnapshot('恢复快照');
    } catch(error){this.setSaveStatus('恢复失败：'+error.message,true);}
};
SeatingModule.prototype.renderHistory = function() {
    var panel=this.root.querySelector('#sm-historyPanel');if(!panel)return;
    panel.innerHTML='';var self=this;
    var visible=this.historyVisibleCount || 50;
    this.historySnapshots.slice().reverse().slice(0,visible).forEach(function(entry,rev) {
        var index=self.historySnapshots.length-1-rev,div=document.createElement('div');div.className='history-item';
        div.textContent=new Date(entry.createdAt || entry.id).toLocaleString()+' · '+(entry.reason || entry.label || '旧快照')+' · '+(entry.batchLabel || '');
        div.onclick=function(){self.loadSnapshot(index);};panel.appendChild(div);
    });
    if(this.historySnapshots.length>visible){var more=document.createElement('button');more.className='btn2 btn2-toggle';more.textContent='显示更早的快照（还剩 '+(this.historySnapshots.length-visible)+' 份）';more.onclick=function(){self.historyVisibleCount=visible+50;self.renderHistory();};panel.appendChild(more);}
    if(!this.historySnapshots.length)panel.textContent='每次改动自动保留快照';
};
SeatingModule.prototype.restoreSnapshots = function(snapshots) { this.historySnapshots=snapshots || [];this.currentSnapshotIndex=-1; };

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
    var studentHeader = ['姓名','状态','座位位置','梯度','班内综合名次','班内相对位置%','优势科目','薄弱科目','标签'];
    var studentData = [studentHeader];
    this.students.forEach(function(student) {
        var pos = this.seatMap.indexOf(student.name);
        var seatPos = pos !== -1 ? (Math.floor(pos / 8) + 1) + '行' + ((pos % 8) + 1) + '列' : '未分配';
        studentData.push([student.name || '', student.status || '', seatPos, this.gradientText(student.gradient), student.latestTotalRank || '?', Number.isFinite(student.compositeRank) ? student.compositeRank.toFixed(1) + '%' : '数据不足', student.leadingSubjects || '', student.weakSubjects || '', (student.tags || []).join(', ')]);
    }, this);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(studentData), '学生详细信息');
    var complementData = [['学生A','学生B','座位关系','距离','梯度差','梯度配对分值','互补科目（班内相对位置≤20%与≥75%）','是否禁止']];
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
            complementData.push([n1, n2, this.getSeatRelation({ row: Math.floor(i / 8), col: i % 8 }, { row: Math.floor(j / 8), col: j % 8 }), dist.toFixed(2), this.gradientText(g1) + '-' + this.gradientText(g2) + ' (差' + diff + ')', this.getComplementScore(g1 && g2 ? diff : null), SeatingData.complementDetails(s1,s2).map(function(d){return d.subject+': '+d.helper+'→'+d.recipient;}).join('；'), this.isForbiddenPair(g1, g2) ? '⚠️ 禁止' : '允许']);
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
                    return '<b>' + s.name + '</b><br/>梯度: ' + self.gradientText(s.gradient) + '<br/>班内综合名次: ' + (s.latestTotalRank || '?') + '<br/>优势: ' + (s.leadingSubjects || '无') + '<br/>薄弱: ' + (s.weakSubjects || '无');
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
            var help=SeatingData.complementDetails(a,b);
            var label=help.map(function(d){return d.subject+': '+d.helper+'→'+d.recipient;}).join('；');
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
    return selected.slice(0, Math.max(12, Math.ceil(active.length * 0.8))).flatMap(function(edge){
        return SeatingData.complementDetails(self.getStudent(edge.source),self.getStudent(edge.target)).map(function(help){return Object.assign({},edge,{source:help.helper,target:help.recipient,label:help.subject+'帮扶'});});
    });
};
SeatingModule.prototype.countHelpSubjects = function(s1,s2) { return SeatingData.complementDetails(s1,s2).length; };
SeatingModule.prototype.importRecoveryData = function() {
    var self=this,input=document.createElement('input');input.type='file';input.accept='.json';
    input.onchange=async function(event) {
        var file=event.target.files[0];if(!file)return;
        try {
            var data=JSON.parse(await file.text());
            if(seatingModuleInstance!==self)return;
            if(!Array.isArray(data.students)||!Array.isArray(data.seatMap))throw new Error('缺少学生和座位数组');
            if(data.className && AppCore.classKey(data.className)!==AppCore.classKey(self.className))throw new Error('复原文件属于其他班级');
            if(!SeatingData.validMap(data.seatMap,data.students,data.seatMap))throw new Error('复原文件包含重复或未知学生');
            var profiles=buildSeatingProfiles(self.className);
            if(data.students.some(function(s){return s.className && AppCore.classKey(s.className)!==AppCore.classKey(self.className);}))throw new Error('复原文件包含其他班级学生');
            if(!data.className && profiles.length && data.students.some(function(s){return !profiles.some(function(p){return p.name===s.name;});}))throw new Error('旧复原文件的学生无法匹配当前班级');
            if(!confirm('导入这份排位？当前排位和历史快照会继续保留。'))return;
            await self.saveSnapshot('导入前保留');
            if(seatingModuleInstance!==self)return;
            if(profiles.length)self.init(profiles,{className:self.className,saved:data});
            else {self.students=AppCore.clone(data.students);self.seatMap=data.seatMap.slice();self.advancedSettings=AppCore.clone(data.advancedSettings || self.advancedSettings);self.showTags=data.showTags!==false;self.render();self.initModalPools();}
            await self.saveSnapshot('导入复原JSON');
        }catch(error){self.setSaveStatus('导入失败：'+error.message,true);}
    };input.click();
};
SeatingModule.prototype.exportRecoveryData = function() {
    var snapshot=this.captureState('导出复原JSON'),url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));
    var link=document.createElement('a');link.href=url;link.download='座位_'+this.className+'_'+new Date().toISOString().slice(0,10)+'.json';link.click();URL.revokeObjectURL(url);
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
        if (partnerIdx <= i || partnerIdx >= this.seatMap.length) continue;
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
    this.renderGrid();this.saveSnapshot('切换标签显示');
};
SeatingModule.prototype.closeModal = function() {
    var modal = this.root.querySelector('#sm-editModal');
    if (modal) modal.classList.remove('active');
    var overlay = this.root.querySelector('#sm-overlay');
    if (overlay) overlay.style.display = 'none';
};
SeatingModule.prototype.moveStudent = function(name,index) {
    var student=this.getStudent(name),target=this.getStudent(this.seatMap[index]),from=this.seatMap.indexOf(name);
    if(!student || student.status==='fixed' || target?.status==='fixed' || this.seatMap[index]==='🚫' || index<0 || index>=this.seatMap.length)return;
    if(from===index)return;
    if(from>=0)this.seatMap[from]=this.seatMap[index];
    this.seatMap[index]=name;this.saveAndRender('手动调整座位');
};
SeatingModule.prototype.dropOnUnseatedList = function(e) {
    e.preventDefault();var s=this.getStudent(this.dragged.name);
    if(this.dragged.source==='seat' && s?.status!=='fixed') {
        this.seatMap[this.dragged.index]=null;this.dragged={source:null,name:null,index:-1};this.saveAndRender('移至待分配');
    }
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
    if(confirm('清空当前排位？学生和所有历史快照继续保留，可随时恢复。')) {
        this.seatMap=this.seatMap.map(function(n){return n==='🚫'?n:null;});
        this.students.forEach(function(s){if(s.status==='fixed')s.status='normal';});
        this.saveAndRender('清空排位');
    }
};
SeatingModule.prototype.showAdvancedOptions = function() {
    var overlay = this.root.querySelector('#sm-advancedOverlay');
    var modal = this.root.querySelector('#sm-advancedModal');
    if (overlay) overlay.style.display = 'block';
    if (modal) modal.classList.add('active');
    this.draftSettings=AppCore.clone(this.advancedSettings);this.loadAdvancedSettings();
};
SeatingModule.prototype.closeAdvancedModal = function() {
    var overlay = this.root.querySelector('#sm-advancedOverlay');
    var modal = this.root.querySelector('#sm-advancedModal');
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.classList.remove('active');
};
SeatingModule.prototype.loadAdvancedSettings = function() {
    var settings=this.draftSettings || this.advancedSettings;
    var layoutEl = this.root.querySelector('#sm-layout-' + settings.layout);
    if (layoutEl) layoutEl.classList.add('selected');
    var gsEl = this.root.querySelector('#sm-groupSize');
    if (gsEl) gsEl.value = [4,6,8].indexOf(settings.groupSize) >= 0 ? String(settings.groupSize) : 'custom';
    var customSection = this.root.querySelector('#sm-customGroupSection');
    if(customSection)customSection.style.display=[4,6,8].includes(settings.groupSize)?'none':'block';
    if ([4,6,8].indexOf(settings.groupSize) < 0) { if (customSection) customSection.style.display = 'block'; var csEl = this.root.querySelector('#sm-customGroupSize'); if (csEl) csEl.value = settings.customGroupSize || 6; }
    var self = this;
    Object.keys(settings.weights).forEach(function(key) {
        var slider = self.root.querySelector('#sm-' + key + 'Slider');
        var span = self.root.querySelector('#sm-' + key + 'Weight');
        if (slider && span) { slider.value = settings.weights[key]; span.textContent = settings.weights[key].toFixed(1); }
    });
};
SeatingModule.prototype.selectLayout = function(layout) {
    this.root.querySelectorAll('[id^="sm-layout-"]').forEach(function(el) { el.classList.remove('selected'); });
    var el = this.root.querySelector('#sm-layout-' + layout);
    if (el) el.classList.add('selected');
    (this.draftSettings || this.advancedSettings).layout = layout;
};
SeatingModule.prototype.updateWeight = function(type, value) {
    var span = this.root.querySelector('#sm-' + type + 'Weight');
    if (span) span.textContent = parseFloat(value).toFixed(1);
    (this.draftSettings || this.advancedSettings).weights[type] = parseFloat(value);
};
SeatingModule.prototype.applyAdvancedSettings = function() {
    var settings=this.draftSettings || AppCore.clone(this.advancedSettings),sel=this.root.querySelector('#sm-groupSize');
    var size=Number(sel.value==='custom'?this.root.querySelector('#sm-customGroupSize').value:sel.value);
    if(!Number.isInteger(size)||size<2||size>12){showAlert('请输入2–12之间的分组人数');return;}
    settings.groupSize=size;settings.customGroupSize=sel.value==='custom'?size:null;
    this.advancedSettings=AppCore.clone(settings);this.closeAdvancedModal();this.saveAndRender('应用高级设置');
};
SeatingModule.prototype.applyLayoutSettings = function() { this.saveAndRender('调整布局设置'); };
SeatingModule.prototype.generateStandardLayout = function() { this.saveAndRender('调整布局设置'); };
SeatingModule.prototype.resetAdvancedSettings = function() {
    this.draftSettings={layout:'default',groupSize:6,customGroupSize:null,weights:{complement:1,behavior:1,group:1,constraints:1,balance:1}};
    this.loadAdvancedSettings();
};
SeatingModule.prototype.getStudent = function(name) { return this.students.find(function(s) { return s.name === name; }); };
SeatingModule.prototype.getSeatCoords = function(index) { return { row: Math.floor(index / 8), col: index % 8 }; };
SeatingModule.prototype.getDistance = function(idx1, idx2) {
    var c1 = this.getSeatCoords(idx1), c2 = this.getSeatCoords(idx2);
    return Math.sqrt(Math.pow(c1.row - c2.row, 2) + Math.pow(c1.col - c2.col, 2));
};
SeatingModule.prototype.saveAndRender = function(reason) { this.renderGrid();this.renderUnseatedList();this.renderRightSidebarStats();return this.saveSnapshot(reason || '修改标签或状态'); };
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
        if (pi <= i || pi >= this.seatMap.length) continue;
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
    if(gradDist[0])gradHtml += '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>数据不足</span><span><b>' + gradDist[0] + '</b>人</span></div>';
    gradEl.innerHTML = gradHtml;
};

return SeatingModule;
})();

// Class workspaces survive exam changes; snapshots retain the exam label at capture time.
async function loadSeatingClass(className, epoch) {
    epoch = epoch || ++seatingLoadEpoch;var sourceEpoch=dataEpoch;
    var profiles=buildSeatingProfiles(className), module=seatingModuleInstance;
    if(module && module.className===className) {
        if(profiles.length){module.init(profiles,{className:className,preserve:true});await module.saveSnapshot('成绩刷新，保留排位');}
        return module;
    }
    if(module?.pendingSave)await module.pendingSave;
    try {
        var record=await seatingStore.load(className);
        if(epoch!==seatingLoadEpoch || sourceEpoch!==dataEpoch)return;
        if(!profiles.length && !record){document.getElementById('seating-module-root').textContent='该班级暂无成绩或已保存的座位档案';seatingModuleInstance=null;return;}
        module=new SeatingModule(document.getElementById('seating-module-root'));module.className=className;
        module.restoreSnapshots(record?.history || []);
        module.latestSnapshot=record?.latest;
        if(profiles.length)module.init(profiles,{className:className,saved:record?.latest});
        else {module.students=AppCore.clone(record.latest.students);module.seatMap=record.latest.seatMap.slice();module.advancedSettings=AppCore.clone(record.latest.advancedSettings);module.showTags=record.latest.showTags!==false;module.render();module.renderHistory();module.initModalPools();}
        seatingModuleInstance=module;
        seatingStore.remember(className);
        if(!record) {
            var legacy=await restoreSeatingSnapshots();
            if(epoch!==seatingLoadEpoch || sourceEpoch!==dataEpoch)return;
            var compatible=legacy.filter(function(snap){return Array.isArray(snap.students) && Array.isArray(snap.seatMap) && snap.students.length && snap.students.every(function(s){return profiles.some(function(p){return p.name===s.name;}) && new Set(combinedStudentData.filter(function(x){return x.name===s.name;}).map(function(x){return AppCore.classKey(x.class);})).size===1;});});
            for(var old of compatible){if(epoch!==seatingLoadEpoch || sourceEpoch!==dataEpoch)return;module.init(profiles,{className:className,saved:old});await module.saveSnapshot('迁移旧快照：'+(old.label || '历史排位'));}
            if(!compatible.length)await module.saveSnapshot('初始排座');
        }
        else module.setSaveStatus('已恢复上次排位 · '+module.historySnapshots.length+' 份快照');
        return module;
    }catch(error){if(epoch===seatingLoadEpoch)document.getElementById('seating-module-root').textContent='座位档案读取失败：'+error.message;}
}
async function refreshSeatingTab() {
    var epoch=++seatingLoadEpoch,sel=document.getElementById('seatingClassFilter');if(!sel)return;
    var previous=sel.value,classes=await seatingStore.classes();if(epoch!==seatingLoadEpoch)return;
    combinedStudentData.forEach(function(s){if(s.class)classes.push(AppCore.classLabel(s.class));});
    classes=Array.from(new Set(classes)).sort();sel.innerHTML='';
    classes.forEach(function(cls){var o=document.createElement('option');o.value=cls;o.textContent=cls;sel.appendChild(o);});
    var remembered=seatingStore.lastClass();
    sel.value=classes.includes(previous)?previous:classes.includes(remembered)?remembered:(classes[0] || '');
    if(sel.value)await loadSeatingClass(sel.value,epoch);
}
document.getElementById('seatingRefreshBtn').addEventListener('click',function(){loadSeatingClass(document.getElementById('seatingClassFilter').value);});
document.getElementById('seatingClassFilter').addEventListener('change',function(){loadSeatingClass(this.value);});
