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
    let databasePromise;
    function openDatabase() {
        if (databasePromise) return databasePromise;
        const promise = new Promise((resolve, reject) => {
            if (!root.indexedDB) { reject(new Error('无法访问浏览器存储')); return; }
            const request = root.indexedDB.open('ScoreAnalysisDB', 1);
            let settled = false;
            const timer = root.setTimeout(() => fail(new Error('浏览器存储被占用，请关闭其他页面后重试')), 8000);
            function fail(error) { if (!settled) { settled = true; root.clearTimeout(timer); reject(error); } }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', {keyPath:'key'});
            };
            request.onerror = () => fail(request.error || new Error('无法打开浏览器存储'));
            request.onsuccess = () => {
                const db = request.result;
                if (settled) { db.close(); return; }
                settled = true;
                root.clearTimeout(timer);
                db.onversionchange = () => { db.close(); databasePromise = null; };
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
            tx.oncomplete = () => resolve(mode === 'readonly' ? request.result?.value : true);
            tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('浏览器存储操作失败'));
        });
    }
    let writeQueue = Promise.resolve();
    const storage = {
        read(key) { return transaction('readonly', key); },
        write(key, value) {
            // Capture before queueing so subsequent edits cannot alter an earlier save.
            const snapshot = clone(value);
            const task = writeQueue.catch(() => {}).then(() => transaction('readwrite', key, snapshot));
            writeQueue = task;
            return task;
        },
        localGet(key, fallback) { try { return root.localStorage.getItem(key) || fallback; } catch (_) { return fallback; } },
        decode: decodeStored
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
    const core = {FONT, text, number, grade, hasValue, escapeHtml, clone, classKey, classLabel, studentKey, pdfBytes, compactPdf, storage, imports, charts};
    root.AppCore = core;
    if (typeof module !== 'undefined') module.exports = core;
})(typeof window !== 'undefined' ? window : globalThis);
