/* Keep SheetJS parsing off the UI thread. One worker is terminated per import. */
'use strict';
importScripts('xlsx.full.min.js');
onmessage = function (event) {
    try {
        const workbook = XLSX.read(event.data, {type:'array'});
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('文件中没有工作表');
        postMessage({rows:XLSX.utils.sheet_to_json(sheet, {header:1, blankrows:true, defval:''}), merges:sheet['!merges'] || []});
    } catch (error) { postMessage({error:String(error.message || error)}); }
};
