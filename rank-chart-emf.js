// Encode the rank chart's SVG shapes and Unicode text as Windows EMF records.
const rankChartEmf = (() => {
    const units = 16;
    const px = value => Math.round(value * units);
    const frame = value => Math.round(value * 2540 / 96);
    const recordType = {
        header:1, polygon:3, polyline:4, eof:14, backgroundMode:18, textAlign:22,
        textColor:24, selectObject:37, createPen:38, createBrush:39, deleteObject:40,
        font:82, text:84
    };
    const noBrush = 0x80000005, noPen = 0x80000008, defaultFont = 0x8000000e;

    function getColor(element, attribute, fallback) {
        const value = element.getAttribute(attribute) ?? fallback;
        if (!value || value === 'none' || value === 'transparent' || Number(element.getAttribute(attribute + '-opacity') ?? 1) === 0) return null;
        if (value.startsWith('#')) {
            const hex = value.slice(1);
            const rgb = parseInt(hex.length === 3 ? [...hex].map(c => c + c).join('') : hex, 16);
            return ((rgb & 255) << 16) | (rgb & 0xff00) | (rgb >> 16);
        }
        const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
        if (rgb) return Number(rgb[4] ?? 1) ? Number(rgb[1]) | (Number(rgb[2]) << 8) | (Number(rgb[3]) << 16) : null;
        throw new Error('图表使用了无法转换的颜色');
    }

    function getPathPoints(element) {
        const data = element.getAttribute('d') || '';
        const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
        if (tokens.includes('A')) {
            // ECharts uses rounded single-contour paths for the legend swatches.
            const length = element.getTotalLength();
            const segments = Math.max(8, Math.ceil(length));
            const points = Array.from({length:segments + 1}, (_, i) => element.getPointAtLength(length * i / segments));
            return [{points, closed:true}];
        }
        const contours = [];
        let x = 0, y = 0, command = '', contour;
        for (let i = 0; i < tokens.length;) {
            if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
            if (command === 'Z' || command === 'z') {
                contour.closed = true;
                ({x, y} = contour.points[0]);
                command = '';
                continue;
            }
            if (!'MLml'.includes(command) || !command) throw new Error('图表路径无法转换为 EMF');
            const relative = command === command.toLowerCase();
            x = Number(tokens[i++]) + (relative ? x : 0);
            y = Number(tokens[i++]) + (relative ? y : 0);
            if (command === 'M' || command === 'm') {
                contour = {points:[], closed:false};
                contours.push(contour);
                command = relative ? 'l' : 'L';
            }
            contour.points.push({x, y});
        }
        return contours;
    }

    function create(svgText) {
        const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
        const width = Number(svg.getAttribute('width')), height = Number(svg.getAttribute('height'));
        if (svg.localName !== 'svg' || !(width > 0 && height > 0)) throw new Error('图表尺寸无效');

        const records = [];
        const metrics = document.createElement('canvas').getContext('2d');
        const white = 0xffffff;
        const attr = (element, name) => Number(element.getAttribute(name) ?? 0);

        function add(type, size, write) {
            const buffer = new Uint8Array(size);
            const view = new DataView(buffer.buffer);
            view.setUint32(0, type, true);
            view.setUint32(4, size, true);
            if (write) write(view);
            records.push(buffer);
            return view;
        }

        function values(type, fields) {
            return add(type, 8 + fields.length * 4, view => {
                fields.forEach((value, index) => view.setInt32(8 + index * 4, value, true));
            });
        }

        function drawShape(points, fill, stroke, strokeWidth, closed) {
            const isPolygon = closed || fill !== null;
            if (points.length < 2 || (fill === null && stroke === null)) return;
            if (fill === null) values(recordType.selectObject, [noBrush]);
            else {
                values(recordType.createBrush, [1, 0, fill, 0]);
                values(recordType.selectObject, [1]);
            }
            if (stroke === null) values(recordType.selectObject, [noPen]);
            else {
                values(recordType.createPen, [2, 0, Math.max(1, px(strokeWidth)), 0, stroke]);
                values(recordType.selectObject, [2]);
            }
            const xs = points.map(point => px(point.x)), ys = points.map(point => px(point.y));
            const coords = points.flatMap((_, index) => [xs[index], ys[index]]);
            values(isPolygon ? recordType.polygon : recordType.polyline,
                [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), points.length, ...coords]);
            if (fill !== null) {
                values(recordType.selectObject, [noBrush]);
                values(recordType.deleteObject, [1]);
            }
            if (stroke !== null) {
                values(recordType.selectObject, [noPen]);
                values(recordType.deleteObject, [2]);
            }
        }

        function drawText(element, transform, color) {
            const text = element.textContent;
            if (!text || color === null) return;
            const fontSize = parseFloat(element.style.fontSize) || 12;
            const fontStack = element.style.fontFamily || 'Microsoft YaHei, sans-serif';
            const font = fontStack.split(',')[0].replace(/["']/g, '').trim().slice(0, 31);
            const weight = element.style.fontWeight === 'bold' ? 700 : Number(element.style.fontWeight) || 400;
            metrics.font = weight + ' ' + fontSize + 'px ' + fontStack;
            const textMetrics = metrics.measureText(text);
            const anchor = element.getAttribute('text-anchor');
            const x = attr(element, 'x') - textMetrics.width * (anchor === 'end' ? 1 : anchor === 'middle' ? 0.5 : 0);
            const centralBaseline = element.getAttribute('dominant-baseline') === 'central';
            const baseline = centralBaseline ? (textMetrics.fontBoundingBoxAscent - textMetrics.fontBoundingBoxDescent) / 2 : 0;
            const point = transform.transformPoint({x, y:attr(element, 'y') + (baseline || 0)});
            const angle = Math.round(Math.atan2(-transform.b, transform.a) * 1800 / Math.PI);

            // LOGFONTW. Escapement rotates the baseline and the glyphs in playback.
            add(recordType.font, 104, view => {
                [3, -px(fontSize), 0, angle, angle, weight].forEach((n, i) => view.setInt32(8 + i * 4, n, true));
                view.setUint8(35, 1); // DEFAULT_CHARSET
                for (let i = 0; i < font.length; i++) view.setUint16(40 + 2 * i, font.charCodeAt(i), true);
            });
            values(recordType.selectObject, [3]);
            values(recordType.textColor, [color]);
            const stringOffset = 76;
            const spacingOffset = (stringOffset + 2 * text.length + 3) & ~3;
            add(recordType.text, spacingOffset + 4 * text.length, view => {
                view.setUint32(24, 2, true); // GM_ADVANCED
                view.setFloat32(28, 1, true);
                view.setFloat32(32, 1, true);
                view.setInt32(36, px(point.x), true);
                view.setInt32(40, px(point.y), true);
                view.setUint32(44, text.length, true);
                view.setUint32(48, stringOffset, true);
                view.setUint32(72, spacingOffset, true);
                let advance = 0;
                for (let i = 0; i < text.length; i++) {
                    view.setUint16(stringOffset + 2 * i, text.charCodeAt(i), true);
                    const next = px(metrics.measureText(text.slice(0, i + 1)).width);
                    view.setInt32(spacingOffset + 4 * i, next - advance, true);
                    advance = next;
                }
            });
            values(recordType.selectObject, [defaultFont]);
            values(recordType.deleteObject, [3]);
        }

        function visit(element, parentMatrix) {
            const tag = element.localName;
            if (['style','defs','title','desc'].includes(tag) || element.getAttribute('display') === 'none') return;
            const matrix = element.transform?.baseVal.consolidate()?.matrix;
            const transform = matrix ? parentMatrix.multiply(matrix) : parentMatrix;
            if (tag === 'g') {
                for (const child of element.children) visit(child, transform);
                return;
            }
            const fill = getColor(element, 'fill', '#000000');
            if (tag === 'text') {
                drawText(element, transform, fill);
                return;
            }
            const strokeWidth = Number(element.getAttribute('stroke-width') ?? 1);
            const stroke = strokeWidth > 0 ? getColor(element, 'stroke') : null;
            if (fill === null && stroke === null) return;
            const contours = tag === 'path' ? getPathPoints(element) : [];
            if (tag === 'rect') {
                const x = attr(element, 'x'), y = attr(element, 'y');
                const w = attr(element, 'width'), h = attr(element, 'height');
                contours.push({points:[{x,y}, {x:x+w,y}, {x:x+w,y:y+h}, {x,y:y+h}], closed:true});
            } else if (tag !== 'path') throw new Error('当前图表包含无法转换为 EMF 的图形');
            for (const {points, closed} of contours) {
                drawShape(points.map(point => transform.transformPoint(point)), fill, stroke, strokeWidth, closed);
            }
        }

        const header = add(recordType.header, 108);
        values(recordType.backgroundMode, [1]); // TRANSPARENT
        values(recordType.textAlign, [24]); // TA_LEFT | TA_BASELINE
        drawShape([{x:0,y:0}, {x:width,y:0}, {x:width,y:height}, {x:0,y:height}], white, null, 0, true);
        for (const child of svg.children) visit(child, new DOMMatrix());
        values(recordType.eof, [0, 0, 20]);

        header.setInt32(16, px(width), true);
        header.setInt32(20, px(height), true);
        header.setInt32(32, frame(width), true);
        header.setInt32(36, frame(height), true);
        header.setUint32(40, 0x464d4520, true);
        header.setUint32(44, 0x00010000, true);
        header.setUint32(48, records.reduce((sum, buffer) => sum + buffer.length, 0), true);
        header.setUint32(52, records.length, true);
        header.setUint16(56, 4, true); // highest object handle (3) plus one
        // Reference device represents 10 inches at 96 pixels/inch with subpixel coordinates.
        header.setInt32(72, px(960), true);
        header.setInt32(76, px(960), true);
        header.setInt32(80, 254, true);
        header.setInt32(84, 254, true);
        header.setInt32(100, 254000, true);
        header.setInt32(104, 254000, true);
        return new Blob(records, {type:'image/emf'});
    }

    return {create};
})();
