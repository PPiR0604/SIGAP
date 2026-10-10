/**
 * SIGAP (Sistem Intelijen Logistik dan Asisten Posko) — Google Apps Script Web App
 *
 * Menerima POST dari komponen Langflow "Logistics Storage Writer" / "Google Workspace Webhook":
 *   { action: "upsert_rows", header: [...], rows: [[...]], secret: "..." }
 *   { action: "append_rows", header: [...], rows: [[...]], secret: "..." }
 *   { action: "create_doc", title: "...", content: "...", secret: "..." }
 *
 * Fitur UPSERT (Anti-Duplikasi):
 * - Memeriksa apakah data posko sudah ada di sheet rekap berdasarkan kecocokan nama posko (dinormalisasi),
 *   desa, dan/atau id_laporan.
 * - Jika sudah ada: memperbarui (update) baris tersebut dengan data terbaru di tempatnya.
 * - Jika belum ada: menambahkan (append) baris baru.
 * - Mencegah data terduplikasi saat pengguna memulai sesi baru atau mengirim update laporan posko yang sama.
 *
 * Cara pasang:
 * 1. Buat Google Sheet baru "Rekap SIGAP" -> Extensions -> Apps Script.
 * 2. Tempel file ini, ganti SHARED_SECRET dengan teks acak buatan Anda.
 * 3. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: Anyone.
 * 4. Salin URL Web App ke field "Webhook URL" di Langflow, dan SHARED_SECRET ke "Shared Secret".
 */

const SHARED_SECRET = 'GANTI_DENGAN_TEKS_ACAK';
const SHEET_NAME = 'rekap_posko';
const DOC_FOLDER_NAME = 'SIGAP - Draf Buletin';
const GENERIC_WORDS = ['posko', 'pengungsian', 'tenda', 'titik', 'pos', 'di', 'dan', 'desa', 'dusun', 'kel', 'kelurahan', 'darurat'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'secret tidak cocok' });
    }
    if (body.action === 'upsert_rows' || body.action === 'append_rows') return json_(upsertRows_(body));
    if (body.action === 'read_rows') return json_(readRows_());
    if (body.action === 'create_doc') return json_(createDoc_(body));
    return json_({ ok: false, error: 'action tidak dikenal' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function cleanStr_(val) {
  if (!val) return '';
  const lower = String(val).toLowerCase().replace(/[^a-z0-9]/g, ' ');
  return lower.split(/\s+/).filter(function (w) {
    return w.length > 0 && GENERIC_WORDS.indexOf(w) === -1;
  }).join(' ');
}

function isMatch_(rowA, rowB, iPosko, iDesa, iId, iShelter, iDisaster) {
  const pA = iPosko >= 0 && iPosko < rowA.length ? cleanStr_(rowA[iPosko]) : '';
  const pB = iPosko >= 0 && iPosko < rowB.length ? cleanStr_(rowB[iPosko]) : '';
  const dA = iDesa >= 0 && iDesa < rowA.length ? cleanStr_(rowA[iDesa]) : '';
  const dB = iDesa >= 0 && iDesa < rowB.length ? cleanStr_(rowB[iDesa]) : '';

  const get = function (row, i) { return i >= 0 && row[i] != null ? String(row[i]).trim() : ''; };
  if (get(rowA, iDisaster) !== get(rowB, iDisaster)) return false;
  const a = get(rowA, iShelter), b = get(rowB, iShelter);
  if (a || b) return !!(a && b && a === b);
  // ID laporan per batch bukan identitas posko. Tidak memakai substring nama.
  return !!(pA && pB && dA && dB && pA === pB && dA === dB);
}

function safeCell_(value) {
  if (value == null) return '';
  return typeof value === 'string' && /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
}

function matchesUpdateTarget_(row,header,target) {
  if (!target || !target.batch_id || !target.report_id || !target.expected || typeof target.expected !== 'object' || Array.isArray(target.expected)) throw new Error('Target koreksi tidak valid.');
  const value=function(v){return v==null?'':String(v).trim().replace(/^'/,'');};
  const columns={batch_id:'batch_id',report_id:'id_laporan',shelter_name:'posko',village:'desa',disaster_id:'disaster_id',shelter_id:'shelter_id'};
  if(Object.keys(columns).some(function(field){const i=header.indexOf(columns[field]);return value(i>=0?row[i]:'')!==value(target[field]);})) return false;
  const canonical=function(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const out={};Object.keys(v).sort().forEach(function(k){out[k]=canonical(v[k]);});return out;}return v;};
  return Object.keys(target.expected).every(function(column){
    const i=header.indexOf(column),expected=target.expected[column];if(i<0)return false;
    if((column==='waktu_laporan'||column==='dicatat_pada')&&expected)return reportTime_(row[i])===reportTime_(expected);
    if(typeof expected==='boolean')return value(row[i]).toLowerCase()===String(expected);
    if(expected&&typeof expected==='object'){try{return JSON.stringify(canonical(JSON.parse(row[i])))===JSON.stringify(canonical(expected));}catch(e){return false;}}
    return value(row[i])===value(expected);
  });
}

function reportTime_(value) {
  if (value instanceof Date) return value.getTime();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(value || ''))) return NaN;
  let text = String(value).replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) text += '+07:00';
  return Date.parse(text);
}

function mergeMetadata_(old, incoming, merged, header) {
  const get = function(row,column,fallback) {
    const index=header.indexOf(column);
    if (index<0 || !row[index]) return fallback;
    const value=JSON.parse(String(row[index]));
    if (Array.isArray(fallback) ? !Array.isArray(value) : !value || typeof value!=='object' || Array.isArray(value)) throw new Error('Metadata tidak valid: '+column);
    return value;
  };
  const put=function(column,value) { const index=header.indexOf(column); if(index>=0) merged[index]=JSON.stringify(value); };
  let changed=[];
  if(header.indexOf('stok_json')>=0) {
    const before=get(old,'stok_json',{}), after=get(incoming,'stok_json',{}), issues=get(incoming,'masalah_stok_json',[]);
    changed=Object.keys(after).filter(function(k){return after[k]!=null || issues.some(function(issue){return String(issue).indexOf(k)>=0;});});
    changed.forEach(function(k){before[k]=after[k];});
    put('stok_json',before);
    const context=get(old,'konteks_stok_json',{}), next=get(incoming,'konteks_stok_json',{});
    changed.forEach(function(k){context[k]=next[k] || {};});
    put('konteks_stok_json',context);
  }
  if(header.indexOf('provenance_json')>=0) {
    const before=get(old,'provenance_json',{}), after=get(incoming,'provenance_json',{});
    Object.keys(after).forEach(function(k){if(k.indexOf('stock.')===0 && header.indexOf('stok_json')>=0 && changed.indexOf(k.slice(6))<0) return; before[k]=after[k];});
    put('provenance_json',before);
  }
  ['riwayat_catatan_json','riwayat_koreksi_json','sumber_laporan_json'].forEach(function(column){
    if(header.indexOf(column)<0) return;
    const values=get(old,column,[]).concat(get(incoming,column,[]));
    const seen={};
    put(column,values.filter(function(v){const key=JSON.stringify(v); if(seen[key]) return false; seen[key]=true; return true;}));
  });
  return merged;
}

function upsertRows_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const header = body.header || [];
  const rows = body.rows || [];
  if (!Array.isArray(header) || !header.length || !Array.isArray(rows) || !rows.length || rows.some(function (r) { return !Array.isArray(r) || r.length !== header.length; })) {
    throw new Error('header/rows tidak valid');
  }
  const clearColumns = body.clear_columns || rows.map(function () { return []; });
  const updateTargets = body.update_targets || rows.map(function () { return null; });
  if(!Array.isArray(updateTargets)||updateTargets.length!==rows.length||updateTargets.some(function(t){return t!=null&&(typeof t!=='object'||Array.isArray(t));})) throw new Error('update_targets tidak valid');
  const protectedColumns = ['posko', 'desa', 'shelter_id', 'disaster_id', 'waktu_laporan', 'id_laporan'];
  if (!Array.isArray(clearColumns) || clearColumns.length !== rows.length || clearColumns.some(function (cols) {
    return !Array.isArray(cols) || cols.some(function (c) { return header.indexOf(c) < 0 || protectedColumns.indexOf(c) >= 0; });
  })) throw new Error('clear_columns tidak valid');

  if (sheet.getLastRow() === 0 && header.length) {
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  let currentData = sheet.getDataRange().getValues();
  let currentHeader = currentData.length > 0 ? currentData[0] : header;
  if (JSON.stringify(currentHeader) !== JSON.stringify(header)) {
    if (header.length <= currentHeader.length || currentHeader.some(function (col) { return header.indexOf(col) < 0; })) {
      throw new Error('Schema sheet berbeda; migrasi eksplisit diperlukan sebelum menulis.');
    }
    const oldHeader = currentHeader;
    currentData = [header].concat(currentData.slice(1).map(function (row) {
      return header.map(function (col) { const index = oldHeader.indexOf(col); return index >= 0 ? row[index] : ''; });
    }));
    currentHeader = header;
  }
  const iPosko = currentHeader.indexOf('posko');
  const iDesa = currentHeader.indexOf('desa');
  const iId = currentHeader.indexOf('id_laporan');
  const iShelter = currentHeader.indexOf('shelter_id');
  const iDisaster = currentHeader.indexOf('disaster_id');
  const iTime = currentHeader.indexOf('waktu_laporan');

  let updatedCount = 0;
  let appendedCount = 0;

  // Seluruh batch diperiksa di memori sebelum perubahan data ditulis.
  rows.forEach(function (newRow, rowIndex) {
    let matchedRowIndex = -1; // 1-based index di sheet

    for (let i = 1; i < currentData.length; i++) {
      if (updateTargets[rowIndex] ? matchesUpdateTarget_(currentData[i],currentHeader,updateTargets[rowIndex]) : isMatch_(newRow, currentData[i], iPosko, iDesa, iId, iShelter, iDisaster)) {
        if (matchedRowIndex > 0) throw new Error('Identitas posko ambigu; periksa duplikasi sebelum update.');
        matchedRowIndex = i + 1; // baris ke-i+1 di spreadsheet
      }
    }

    if(updateTargets[rowIndex] && matchedRowIndex < 0) throw new Error('Baris asal koreksi hilang atau berubah; baca ulang dan setujui kandidat baru.');
    if (matchedRowIndex > 0) {
      const old = currentData[matchedRowIndex - 1];
      if (iTime >= 0 && old[iTime]) {
        const before = reportTime_(old[iTime]), after = reportTime_(newRow[iTime]);
        if (!isFinite(before) || !isFinite(after) || after < before) throw new Error('Laporan usang/waktu tidak valid; batch ditolak.');
      }
      const merged = newRow.map(function (value, i) {
        return clearColumns[rowIndex].indexOf(header[i]) >= 0 ? '' : value == null || value === '' ? old[i] : safeCell_(value);
      });
      currentData[matchedRowIndex - 1] = mergeMetadata_(old,newRow,merged,header);
      updatedCount++;
    } else {
      currentData.push(newRow.map(safeCell_));
      appendedCount++;
    }
  });
  sheet.getRange(1, 1, currentData.length, header.length).setValues(currentData);

  return {
    ok: true,
    appended: appendedCount,
    updated: updatedCount,
    total: rows.length,
    url: ss.getUrl() + '#gid=' + sheet.getSheetId()
  };
  } finally {
    lock.releaseLock();
  }
}

function createDoc_(body) {
  const content = String(body.content || '');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content, Utilities.Charset.UTF_8).map(function (b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
  if (body.confirmed_create_doc !== true || body.approved_content_sha256 !== digest || !content) {
    throw new Error('Pembuatan Docs memerlukan persetujuan khusus terikat hash isi.');
  }
  const title = (body.title || 'DRAF Buletin') + ' - ' +
      Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
  const doc = DocumentApp.create(title);
  const docBody = doc.getBody();
  String(body.content || '').split('\n').forEach(function (line) {
    const clean = line.replace(/\*\*/g, '').replace(/^_|_$/g, '');
    if (line.indexOf('# ') === 0) {
      docBody.appendParagraph(clean.substring(2)).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    } else if (line.indexOf('## ') === 0) {
      docBody.appendParagraph(clean.substring(3)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    } else if (line.indexOf('- ') === 0) {
      docBody.appendListItem(clean.substring(2));
    } else {
      docBody.appendParagraph(clean);
    }
  });
  doc.saveAndClose();

  const folders = DriveApp.getFoldersByName(DOC_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DOC_FOLDER_NAME);
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  return { ok: true, url: doc.getUrl() };
}

function readRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { ok: true, capabilities: {targeted_updates:true}, header: [], rows: [], records: [], count: 0, url: ss.getUrl() };
  }
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const rows = data.slice(1).map(function (row) {
    return row.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm') : v; });
  });
  const records = rows.map(function (r) {
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = r[c];
    }
    return obj;
  });
  return {
    ok: true,
    header: header,
    capabilities: {targeted_updates:true},
    rows: rows,
    records: records,
    count: records.length,
    url: ss.getUrl() + '#gid=' + sheet.getSheetId()
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
