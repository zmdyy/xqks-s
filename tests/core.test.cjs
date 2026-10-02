'use strict';
const assert = require('node:assert/strict');
const core = require('../app-core.js');
// Grade-year codes and human labels must match in every view; multi-digit Chinese labels must remain correct.
for (const value of ['801', '701班', '01班', '八年级（1）班', '初二1班', '１班', '一班']) assert.equal(core.classKey(value), '1', value);
assert.equal(core.classLabel('十一班'), '11班');
assert.equal(core.classLabel('1201'), '01班');
assert.equal(core.classLabel('创新班'), '创新班');
assert.equal(core.classLabel(null, '未知班级'), '未知班级');
assert.equal(core.number('０'), 0);
assert.equal(core.number(' 1,234.5 '), 1234.5);
assert.equal(core.number('缺考'), '');
assert.equal(core.hasValue(0), true);
assert.equal(core.hasValue(Infinity), false);
assert.equal(core.hasValue('--'), false);
assert.equal(core.grade(' ａ＋ '), 'A+');
assert.equal(core.escapeHtml('<"\'&>'), '&lt;&quot;&#39;&amp;&gt;');
assert.notEqual(core.studentKey({name:'同名', class:'801'}), core.studentKey({name:'同名', class:'802'}));
const bytes = new Uint8Array([37,80,68,70,45,49]);
const copy = core.clone({fileData:bytes});
assert.ok(copy.fileData instanceof Uint8Array);
copy.fileData[0] = 0;
assert.equal(bytes[0], 37);
for (const entry of [{fileData:bytes}, {fileData:bytes.buffer}, {fileData:Array.from(bytes)}, {fileData:JSON.parse(JSON.stringify(bytes))}, {fileDataB64:Buffer.from(bytes).toString('base64')}]) {
    assert.deepEqual(core.pdfBytes(entry), bytes);
    assert.ok(core.compactPdf(entry).fileData instanceof Uint8Array);
}
assert.equal(core.compactPdf({fileData:bytes,_qi:{}})._qi, undefined);
assert.deepEqual(core.storage.decode('[1,2]', []), [1,2]);
assert.deepEqual(core.storage.decode({schemaVersion:2,batches:[]}, []), {schemaVersion:2,batches:[]});
assert.throws(() => core.storage.decode('{bad', []));
console.log('PASS core: input normalization, identity, PDF byte compatibility and legacy decoding');
