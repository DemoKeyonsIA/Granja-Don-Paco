const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function xml(value: any): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function worksheetXml(rows: any[][]): string {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    const text = xml(value);
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function safeSheetName(value: string, used: Set<string>): string {
  const base = (value || 'Registros').replace(/[\\/?*:[\]]/g, ' ').trim().slice(0, 31) || 'Registros';
  let name = base; let suffix = 2;
  while (used.has(name.toLocaleLowerCase())) {
    const ending = ` ${suffix++}`;
    name = `${base.slice(0, 31 - ending.length)}${ending}`;
  }
  used.add(name.toLocaleLowerCase());
  return name;
}

function zipStore(files: Array<{ name: string; content: string }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const stamp = new Date();
  const dosTime = (stamp.getHours() << 11) | (stamp.getMinutes() << 5) | Math.floor(stamp.getSeconds() / 2);
  const dosDate = ((Math.max(1980, stamp.getFullYear()) - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate();
  const u16 = (view: DataView, at: number, n: number) => view.setUint16(at, n, true);
  const u32 = (view: DataView, at: number, n: number) => view.setUint32(at, n, true);
  for (const file of files) {
    const name = encoder.encode(file.name); const data = encoder.encode(file.content); const checksum = crc32(data);
    const header = new Uint8Array(30 + name.length); const h = new DataView(header.buffer);
    u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 8, 0); u16(h, 10, dosTime); u16(h, 12, dosDate); u32(h, 14, checksum); u32(h, 18, data.length); u32(h, 22, data.length); u16(h, 26, name.length); u16(h, 28, 0); header.set(name, 30);
    local.push(header, data);
    const directory = new Uint8Array(46 + name.length); const d = new DataView(directory.buffer);
    u32(d, 0, 0x02014b50); u16(d, 4, 20); u16(d, 6, 20); u16(d, 8, 0x0800); u16(d, 10, 0); u16(d, 12, dosTime); u16(d, 14, dosDate); u32(d, 16, checksum); u32(d, 20, data.length); u32(d, 24, data.length); u16(d, 28, name.length); u16(d, 30, 0); u16(d, 32, 0); u16(d, 34, 0); u16(d, 36, 0); u32(d, 38, 0); u32(d, 42, offset); directory.set(name, 46);
    central.push(directory);
    offset += header.length + data.length;
  }
  const centralBytes = concat(central); const end = new Uint8Array(22); const e = new DataView(end.buffer);
  u32(e, 0, 0x06054b50); u16(e, 4, 0); u16(e, 6, 0); u16(e, 8, files.length); u16(e, 10, files.length); u32(e, 12, centralBytes.length); u32(e, 16, offset); u16(e, 20, 0);
  return concat([...local, centralBytes, end]);
}

/** Creates a valid, uncompressed OOXML workbook with one worksheet per section. */
export function createContabilidadXlsx(columnas: string[], rows: Record<string, any>[]): Blob {
  const groups = new Map<string, Record<string, any>[]>();
  for (const row of rows) {
    const section = String(row.seccion || 'Registros');
    const group = groups.get(section) || []; group.push(row); groups.set(section, group);
  }
  if (!groups.size) groups.set('Registros', []);
  const usedNames = new Set<string>();
  const sheets = [...groups.entries()].map(([section, sectionRows]) => ({
    name: safeSheetName(section, usedNames),
    rows: [columnas, ...sectionRows.map(row => columnas.map(column => row[column] ?? ''))],
  }));
  const sheetTags = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const sheetTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetTypes}</Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>` },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: worksheetXml(sheet.rows) })),
  ];
  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
