/* Shared data, storage and chart services. No analysis rules live in this module. */
(function (root) {
    'use strict';
    // ECharts writes this into SVG style attributes without escaping quotes.
    const FONT = 'Microsoft YaHei, PingFang SC, Noto Sans SC, Arial, sans-serif';
    function text(value) { return String(value == null ? '' : value).normalize('NFKC').replace(/\uFEFF/g, '').trim(); }
    function hasValue(value) {
        if (value == null) return false;
        if (typeof value === 'number') return Number.isFinite(value);
        if (typeof value === 'string') return !['', '-', '--', '—'].includes(text(value));
        return true;
    }
    function number(value) {
        if (!hasValue(value)) return '';
        const n = Number(text(value).replace(/,/g, ''));
        return Number.isFinite(n) ? n : '';
    }
    function grade(value) { return text(value).toUpperCase().replace(/\s+/g, ''); }
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
    }
    function clone(value) {
        if (typeof root.structuredClone === 'function') return root.structuredClone(value);
        if (value == null || typeof value !== 'object') return value;
        if (value instanceof ArrayBuffer) return value.slice(0);
        if (value instanceof DataView) return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        if (ArrayBuffer.isView(value)) return new value.constructor(value);
        if (Array.isArray(value)) return value.map(clone);
        const result = {};
        Object.keys(value).forEach(key => { Object.defineProperty(result, key, {value:clone(value[key]), writable:true, enumerable:true, configurable:true}); });
        return result;
    }
    function classKey(value) {
        let s = text(value).replace(/\s+/g, '').replace(/[()（）]/g, '');
        if (!s || s === '未知班级') return '';
        s = s.replace(/^[初高][一二三四]/, '').replace(/^[一二三四五六七八九十]+年级?/, '').replace(/^\d+年级?/, '').replace(/班$/, '');
        if (/^[789]\d{2}$/.test(s)) s = s.slice(1);
        else if (/^(10|11|12)\d{2}$/.test(s)) s = s.slice(2);
        if (/^\d+$/.test(s)) return String(Number(s));
        const digits = {零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
        if (/^[零一二三四五六七八九十]+$/.test(s)) {
            const pieces = s.split('十');
            if (pieces.length === 2) return String((digits[pieces[0]] || 1) * 10 + (digits[pieces[1]] || 0));
            if (pieces.length === 1 && s.length === 1) return String(digits[s]);
        }
        return s;
    }
    function classLabel(value, empty) {
        const key = classKey(value);
        return key ? (/^\d+$/.test(key) ? key.padStart(2, '0') : key) + '班' : (empty || '');
    }
    function studentKey(student) { return JSON.stringify([text(student.name), classKey(student.class)]); }
    function pdfBytes(entry) {
        if (!entry) return null;
        const value = entry.fileData;
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        if (Array.isArray(value)) return new Uint8Array(value);
        if (value && typeof value === 'object') {
            const keys = Object.keys(value).filter(k => /^\d+$/.test(k)).sort((a,b) => Number(a)-Number(b));
            if (keys.length) return new Uint8Array(keys.map(k => value[k]));
        }
        if (entry.fileDataB64) {
            const binary = root.atob(entry.fileDataB64);
            return Uint8Array.from(binary, c => c.charCodeAt(0));
        }
        return null;
    }
    function compactPdf(entry) {
        const result = Object.assign({}, entry);
        const bytes = pdfBytes(entry);
        if (bytes) { result.fileData = bytes; delete result.fileDataB64; }
        delete result._qi;
        return result;
    }
    function decodeStored(value, fallback) {
        return value == null ? fallback : (typeof value === 'string' ? JSON.parse(value) : value);
    }
    let databasePromise, databasePromiseName, databaseHandle;
    let activeWorkspaceId = (function() {
        try { return new URLSearchParams(root.location && root.location.search || '').get('workspace') || null; }
        catch (_) { return null; }
    })();
    let writeQueue = Promise.resolve();
    let switchingWorkspace = false;
    let leaseWorkspaceId = null, leaseMode = null, leaseRelease = null, leaseTimer = null, leaseKey = null;
    const leaseOwner = 'tab_' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now() + '_' + Math.random().toString(16).slice(2));
    function validWorkspaceId(id) {
        const value = text(id);
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error('工作区编号无效');
        return value;
    }
    function databaseNameFor(id) { return 'ScoreAnalysisDB_' + validWorkspaceId(id); }
    function databaseName() {
        if (!activeWorkspaceId) throw new Error('尚未选择工作区，无法访问成绩数据');
        return databaseNameFor(activeWorkspaceId);
    }
    function openDatabase() {
        const name = databaseName();
        if (databasePromise && databasePromiseName === name) return databasePromise;
        if (databaseHandle) { try { databaseHandle.close(); } catch (_) {} databaseHandle = null; }
        databasePromise = null;
        databasePromiseName = name;
        const promise = new Promise((resolve, reject) => {
            if (!root.indexedDB) { reject(new Error('无法访问浏览器存储')); return; }
            const request = root.indexedDB.open(name, 1);
            let settled = false;
            const timer = root.setTimeout(() => fail(new Error('浏览器存储被占用，请关闭其他页面后重试')), 8000);
            function fail(error) { if (!settled) { settled = true; root.clearTimeout(timer); reject(error); } }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', {keyPath:'key'});
            };
            request.onerror = () => fail(request.error || new Error('无法打开浏览器存储'));
            request.onblocked = () => fail(new Error('工作区数据库正在被其他页面占用，请关闭旧页面后重试'));
            request.onsuccess = () => {
                const db = request.result;
                if (settled) { db.close(); return; }
                if (activeWorkspaceId !== name.slice('ScoreAnalysisDB_'.length)) { db.close(); fail(new Error('工作区已切换，已取消旧页面的数据读取')); return; }
                settled = true;
                root.clearTimeout(timer);
                databaseHandle = db;
                db.onversionchange = () => {
                    db.close();
                    if (databaseHandle === db) databaseHandle = null;
                    if (databasePromiseName === name) databasePromise = null;
                };
                resolve(db);
            };
        });
        databasePromise = promise;
        promise.catch(() => { if (databasePromise === promise) databasePromise = null; });
        return promise;
    }
    async function transaction(mode, key, value) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('batches', mode);
            const store = tx.objectStore('batches');
            const request = mode === 'readonly' ? store.get(key) : store.put({key, value});
            tx.oncomplete = () => resolve(mode === 'readonly' ? request.result && request.result.value : true);
            tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('浏览器存储操作失败'));
        });
    }
    function releaseLease() {
        if (leaseMode === 'web' && leaseRelease) {
            try { leaseRelease(); } catch (_) {}
        } else if (leaseMode === 'local') {
            if (leaseTimer) root.clearInterval(leaseTimer);
            leaseTimer = null;
            try {
                const record = JSON.parse(root.localStorage.getItem(leaseKey) || 'null');
                if (record && record.owner === leaseOwner) root.localStorage.removeItem(leaseKey);
            } catch (_) {}
        }
        leaseWorkspaceId = null; leaseMode = null; leaseRelease = null; leaseKey = null;
    }
    function assertLeaseHeld() {
        if (!activeWorkspaceId || leaseWorkspaceId !== activeWorkspaceId || !leaseMode) throw new Error('当前工作区未取得有效编辑锁，请刷新页面或重新进入工作区后再保存');
        if (leaseMode === 'local') {
            let record;
            try { record = JSON.parse(root.localStorage.getItem(leaseKey) || 'null'); }
            catch (_) { releaseLease(); throw new Error('无法验证工作区编辑锁，请允许浏览器使用本站存储后重试'); }
            if (!record || record.owner !== leaseOwner || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
                releaseLease();
                throw new Error('工作区编辑锁已失效，可能已有其他页面接管。请刷新页面后重新进入工作区');
            }
        }
        return true;
    }
    function assertLease() {
        if (switchingWorkspace) throw new Error('正在切换工作区，请稍后再保存');
        return assertLeaseHeld();
    }
    async function acquireLease() {
        if (!activeWorkspaceId) throw new Error('请先选择工作区');
        if (leaseWorkspaceId === activeWorkspaceId) return true;
        releaseLease();
        const id = activeWorkspaceId;
        if (root.navigator && root.navigator.locks && typeof root.navigator.locks.request === 'function') {
            let resolveAcquired, releaseHold;
            const acquired = new Promise(resolve => { resolveAcquired = resolve; });
            const hold = new Promise(resolve => { releaseHold = resolve; });
            let settled = false;
            try {
                const request = root.navigator.locks.request('xqks-workspace:' + id, {mode:'exclusive', ifAvailable:true}, lock => {
                    if (!lock) { if (!settled) { settled = true; resolveAcquired(false); } return; }
                    leaseRelease = releaseHold;
                    leaseMode = 'web';
                    leaseWorkspaceId = id;
                    if (!settled) { settled = true; resolveAcquired(true); }
                    return hold;
                });
                request.catch(() => { if (!settled) { settled = true; resolveAcquired(null); } });
                const result = await acquired;
                if (result !== null) return result;
                leaseRelease = null; leaseMode = null; leaseWorkspaceId = null;
            } catch (_) {}
        }
        const key = 'xqks:workspace-lock:' + id;
        const now = Date.now();
        try {
            const existing = JSON.parse(root.localStorage.getItem(key) || 'null');
            if (existing && existing.expiresAt > now && existing.owner !== leaseOwner) return false;
            const record = {owner:leaseOwner, expiresAt:now + 120000};
            root.localStorage.setItem(key, JSON.stringify(record));
            const check = JSON.parse(root.localStorage.getItem(key) || 'null');
            if (!check || check.owner !== leaseOwner) return false;
            leaseMode = 'local'; leaseWorkspaceId = id; leaseKey = key;
            leaseTimer = root.setInterval(() => {
                try {
                    const current = JSON.parse(root.localStorage.getItem(key) || 'null');
                    if (!current || current.owner !== leaseOwner) { releaseLease(); return; }
                    root.localStorage.setItem(key, JSON.stringify({owner:leaseOwner, expiresAt:Date.now()+120000}));
                } catch (_) { releaseLease(); }
            }, 20000);
            return true;
        } catch (_) {
            // Fail closed: without Web Locks or readable localStorage we cannot prevent
            // a second tab from editing this same workspace safely.
            releaseLease();
            throw new Error('浏览器无法提供可靠的工作区编辑锁。请通过 localhost 或 HTTPS 打开，并允许本站使用本地存储');
        }
    }
    const storage = {
        read(key) { return transaction('readonly', key); },
        write(key, value) {
            assertLease();
            const snapshot = clone(value);
            const task = writeQueue.catch(() => {}).then(() => { assertLeaseHeld(); return transaction('readwrite', key, snapshot); });
            writeQueue = task;
            return task;
        },
        localGet(key, fallback) { try { return root.localStorage.getItem(key) || fallback; } catch (_) { return fallback; } },
        localSet(key, value) { try { root.localStorage.setItem(key, value); return true; } catch (_) { return false; } },
        workspaceLocalGet(key, fallback) { try { return root.localStorage.getItem('xqks:' + activeWorkspaceId + ':' + key) || fallback; } catch (_) { return fallback; } },
        workspaceLocalSet(key, value) { try { assertLease(); root.localStorage.setItem('xqks:' + activeWorkspaceId + ':' + key, value); return true; } catch (_) { return false; } },
        namespacePrefix(id) { const value = id || activeWorkspaceId; return value ? 'xqks:' + validWorkspaceId(value) + ':' : ''; },
        workspaceId() { return activeWorkspaceId; },
        databaseName(id) { return id ? databaseNameFor(id) : databaseName(); },
        async setWorkspace(id) {
            const next = validWorkspaceId(id);
            if (next === activeWorkspaceId) return next;
            switchingWorkspace = true;
            try {
                await writeQueue.catch(() => {});
                releaseLease();
                if (databasePromise) await databasePromise.catch(() => {});
                if (databaseHandle) { try { databaseHandle.close(); } catch (_) {} databaseHandle = null; }
                activeWorkspaceId = next;
                databasePromise = null; databasePromiseName = null; writeQueue = Promise.resolve();
                return next;
            } finally { switchingWorkspace = false; }
        },
        async close() {
            switchingWorkspace = true;
            try {
                await writeQueue.catch(() => {});
                releaseLease();
                if (databasePromise) await databasePromise.catch(() => {});
                if (databaseHandle) { try { databaseHandle.close(); } catch (_) {} databaseHandle = null; }
                databasePromise = null; databasePromiseName = null;
            } finally { switchingWorkspace = false; }
        },
        acquireLease,
        assertLease,
        releaseLease,
        flush() { return writeQueue; },
        decode: decodeStored
    };
    if (root.addEventListener) root.addEventListener('beforeunload', releaseLease);
    const REGISTRY_DB = 'ScoreWorkspaceRegistry';
    let registryPromise;
    function openRegistry() {
        if (registryPromise) return registryPromise;
        const promise = new Promise((resolve, reject) => {
            if (!root.indexedDB) { reject(new Error('当前浏览器不支持 IndexedDB')); return; }
            const req = root.indexedDB.open(REGISTRY_DB, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains('workspaces')) req.result.createObjectStore('workspaces', {keyPath:'id'});
            };
            req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); registryPromise = null; }; resolve(req.result); };
            req.onerror = () => reject(req.error || new Error('无法打开工作区目录'));
            req.onblocked = () => reject(new Error('工作区目录被其他页面占用，请关闭旧页面后重试'));
        });
        registryPromise = promise;
        promise.catch(() => { if (registryPromise === promise) registryPromise = null; });
        return promise;
    }
    async function registryRequest(mode, action) {
        const db = await openRegistry();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('workspaces', mode), store = tx.objectStore('workspaces');
            let req;
            try { req = action(store); } catch (error) { try { tx.abort(); } catch (_) {} reject(error); return; }
            tx.oncomplete = () => resolve(req ? req.result : true);
            tx.onabort = tx.onerror = () => reject(tx.error || (req && req.error) || new Error('工作区目录操作失败'));
        });
    }
    function workspaceId() {
        return 'ws_' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now() + '_' + Math.random().toString(16).slice(2));
    }
    async function createWorkspace(meta) {
        meta = meta || {};
        const id = meta.id ? validWorkspaceId(meta.id) : workspaceId();
        const year = text(meta.academicYear || meta.year || '');
        const gradeName = text(meta.grade || '');
        const name = text(meta.name) || [year, gradeName].filter(Boolean).join(' · ') || '未命名工作区';
        const record = Object.assign({}, meta, {id, name, academicYear:year, grade:gradeName, createdAt:meta.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString()});
        const db = await openRegistry();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('workspaces', 'readwrite'), store = tx.objectStore('workspaces');
            let duplicate = false;
            const list = store.getAll();
            list.onsuccess = () => {
                if (!meta.restoredFromWorkspaceId && year && gradeName &&
                    (list.result || []).some(item => item.academicYear === year && item.grade === gradeName)) {
                    duplicate = true;
                    tx.abort();
                    return;
                }
                store.add(record);
            };
            list.onerror = () => { try { tx.abort(); } catch (_) {} };
            tx.oncomplete = resolve;
            tx.onabort = tx.onerror = () => reject(duplicate
                ? new Error('该学年和年级的工作区已存在，请直接进入现有工作区；如需恢复备份，请使用“恢复到新工作区”')
                : tx.error || new Error('创建工作区失败'));
        });
        return record;
    }
    async function getWorkspace(id) {
        if (!id) return null;
        return (await registryRequest('readonly', store => store.get(validWorkspaceId(id)))) || null;
    }
    async function listWorkspaces() {
        const list = await registryRequest('readonly', store => store.getAll());
        return (list || []).sort((a,b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    }
    async function updateWorkspace(id, patch) {
        const current = await getWorkspace(id);
        if (!current) throw new Error('工作区不存在');
        const next = Object.assign({}, current, patch || {}, {id:current.id, updatedAt:new Date().toISOString()});
        await registryRequest('readwrite', store => store.put(next));
        return next;
    }
    function deleteDatabase(name) {
        return new Promise((resolve, reject) => {
            const req = root.indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error || new Error('删除工作区数据库失败'));
            req.onblocked = () => reject(new Error('工作区仍在其他页面使用，请先关闭相关页面再删除'));
        });
    }
    async function removeWorkspace(id) {
        const value = validWorkspaceId(id);
        if (value === activeWorkspaceId) throw new Error('不能删除当前正在使用的工作区，请先切换到其他工作区');
        await deleteDatabase(databaseNameFor(value));
        const prefix = 'xqks:' + value + ':';
        try { for (let i = root.localStorage.length - 1; i >= 0; i--) { const key = root.localStorage.key(i); if (key && key.startsWith(prefix)) root.localStorage.removeItem(key); } } catch (_) {}
        await registryRequest('readwrite', store => store.delete(value));
        return true;
    }
    function openExistingLegacyDatabase() {
        return new Promise(resolve => {
            let absent = false;
            const req = root.indexedDB.open('ScoreAnalysisDB');
            req.onupgradeneeded = () => { absent = true; try { req.transaction.abort(); } catch (_) {} };
            req.onerror = () => resolve(null);
            req.onsuccess = () => {
                if (absent) { req.result.close(); resolve(null); }
                else resolve(req.result);
            };
        });
    }
    async function migrateLegacyArchive() {
        const existing = await getWorkspace('legacy-archive');
        if (existing) return existing;
        const oldDb = await openExistingLegacyDatabase();
        if (!oldDb) return null;
        try {
            if (!oldDb.objectStoreNames.contains('batches')) return null;
            const records = await new Promise((resolve, reject) => {
                const tx = oldDb.transaction('batches', 'readonly'), req = tx.objectStore('batches').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error || new Error('读取旧版数据失败'));
            });
            let archive;
            try {
                archive = await createWorkspace({id:'legacy-archive',name:'历史数据（待整理）',grade:'待整理',legacyArchive:true,description:'从旧版共享数据库复制；原始数据库保持不变。'});
            } catch (error) {
                archive = await getWorkspace('legacy-archive');
                if (!archive) throw error;
            }
            const target = await new Promise((resolve, reject) => {
                const req = root.indexedDB.open(databaseNameFor(archive.id), 1);
                req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('batches')) req.result.createObjectStore('batches', {keyPath:'key'}); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('创建历史数据副本失败'));
                req.onblocked = () => reject(new Error('历史数据正在被其他页面占用'));
            });
            try {
                await new Promise((resolve, reject) => {
                    const tx = target.transaction('batches','readwrite'), store = tx.objectStore('batches');
                    records.forEach(row => store.put(row));
                    tx.oncomplete = resolve;
                    tx.onabort = tx.onerror = () => reject(tx.error || new Error('复制历史数据失败'));
                });
            } finally { target.close(); }
            return archive;
        } finally { oldDb.close(); }
    }
    let legacyArchivePromise;
    function ensureLegacyArchive() {
        if (legacyArchivePromise) return legacyArchivePromise;
        if (root.navigator && root.navigator.locks && typeof root.navigator.locks.request === 'function') {
            try {
                legacyArchivePromise = root.navigator.locks.request('xqks-legacy-archive-migration', {mode:'exclusive'}, migrateLegacyArchive);
            } catch (_) { legacyArchivePromise = migrateLegacyArchive(); }
        } else legacyArchivePromise = migrateLegacyArchive();
        legacyArchivePromise = legacyArchivePromise.catch(error => { legacyArchivePromise = null; throw error; });
        return legacyArchivePromise;
    }
    function workspaceUrl(id) {
        if (!root.location) return '?workspace=' + encodeURIComponent(validWorkspaceId(id));
        const url = new URL(root.location.href); url.searchParams.set('workspace', validWorkspaceId(id)); return url.href;
    }
    const workspaces = {
        create: createWorkspace,
        urlFor: workspaceUrl,
        get: getWorkspace,
        list: listWorkspaces,
        update: updateWorkspace,
        remove: removeWorkspace,
        async ensure(id, meta) {
            const found = await getWorkspace(id);
            if (found) return found;
            try { return await createWorkspace(Object.assign({}, meta || {}, {id})); }
            catch (error) { const raced = await getWorkspace(id); if (raced) return raced; throw error; }
        },
        ensureLegacyArchive
    };
    function parseWorkbook(buffer) {
        if (!root.XLSX) throw new Error('表格解析组件尚未加载，请刷新后重试');
        const workbook = root.XLSX.read(buffer, {type:'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('文件中没有工作表');
        return {rows:root.XLSX.utils.sheet_to_json(sheet, {header:1, blankrows:true, defval:''}), merges:sheet['!merges'] || []};
    }
    async function readWorkbook(file) {
        if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('仅支持 .xlsx、.xls、.csv 成绩表');
        if (!file.size) throw new Error('文件为空');
        if (file.size > 50 * 1024 * 1024) throw new Error('单个成绩表请控制在 50 MB 内');
        const buffer = await file.arrayBuffer();
        if (typeof root.Worker === 'function' && root.location?.protocol !== 'file:') {
            try {
                return await new Promise((resolve, reject) => {
                    const worker = new root.Worker('spreadsheet-worker.js');
                    const timer = root.setTimeout(() => finish(new Error('表格解析超时，请拆分文件后重试')), 60000);
                    function finish(error, result) { root.clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result); }
                    worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data);
                    worker.onerror = event => { event.preventDefault(); const error = new Error('后台解析组件不可用'); error.workerUnavailable = true; finish(error); };
                    // No transfer: preserve the buffer for file:// or worker-load fallback.
                    worker.postMessage(buffer);
                });
            } catch (error) { if (!error.workerUnavailable && error.name !== 'SecurityError') throw error; }
        }
        await new Promise(resolve => root.setTimeout(resolve, 0));
        return parseWorkbook(buffer);
    }
    let importQueue = Promise.resolve();
    const imports = {
        readWorkbook,
        enqueue(task) { const next = importQueue.catch(() => {}).then(task); importQueue = next; return next; }
    };
    const chartDoms = new Set();
    let resizeTimer, themeRegistered = false;
    const observer = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(() => charts.schedule()) : null;
    const charts = {
        init(dom, theme, options) {
            if (!root.echarts) throw new Error('图表组件尚未加载，请刷新后重试');
            this.dispose(dom);
            if (!themeRegistered) {
                root.echarts.registerTheme('score-app', {textStyle:{fontFamily:FONT, fontSize:14}, title:{textStyle:{fontFamily:FONT}}, categoryAxis:{axisLabel:{fontFamily:FONT}}, valueAxis:{axisLabel:{fontFamily:FONT}}});
                themeRegistered = true;
            }
            const chart = root.echarts.init(dom, theme || 'score-app', options);
            chartDoms.add(dom);
            if (observer) observer.observe(dom);
            return chart;
        },
        dispose(dom) {
            if (!dom) return;
            const chart = root.echarts?.getInstanceByDom(dom);
            if (chart && !chart.isDisposed()) chart.dispose();
            chartDoms.delete(dom);
            if (observer) observer.unobserve(dom);
        },
        schedule() {
            root.clearTimeout(resizeTimer);
            resizeTimer = root.setTimeout(() => {
                chartDoms.forEach(dom => {
                    const chart = root.echarts?.getInstanceByDom(dom);
                    if (!dom.isConnected || !chart || chart.isDisposed()) { charts.dispose(dom); return; }
                    if (dom.clientWidth && dom.clientHeight) {
                        const width = dom.clientWidth, height = dom.clientHeight;
                        if (chart.getWidth() !== width || chart.getHeight() !== height) chart.resize();
                    }
                });
            }, 100);
        }
    };
    if (root.addEventListener) root.addEventListener('resize', () => charts.schedule(), {passive:true});
    const core = {FONT, text, number, grade, hasValue, escapeHtml, clone, classKey, classLabel, studentKey, pdfBytes, compactPdf, storage, workspaces, imports, charts};
    root.AppCore = core;
    if (typeof module !== 'undefined') module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
