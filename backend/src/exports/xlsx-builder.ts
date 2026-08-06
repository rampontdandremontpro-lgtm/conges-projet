import { deflateRawSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function buildXlsx(
  headers: string[],
  rows: Array<Record<string, unknown>>,
  sheetName: string,
): Buffer {
  const safeSheetName = sheetName.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
  const sheetRows = [
    buildRow(headers.map((value) => ({ value, header: true })), 1),
    ...rows.map((row, index) =>
      buildRow(
        headers.map((header) => ({ value: row[header], header: false })),
        index + 2,
      ),
    ),
  ].join('');
  const lastColumn = columnName(Math.max(headers.length, 1));
  const columns = headers
    .map((header, index) => {
      const width = Math.min(Math.max(header.length + 3, 12), 35);
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const sheetXml = xml(`
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews>
        <sheetView workbookViewId="0">
          <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
        </sheetView>
      </sheetViews>
      <cols>${columns}</cols>
      <sheetData>${sheetRows}</sheetData>
      <autoFilter ref="A1:${lastColumn}1"/>
    </worksheet>
  `);

  return createZip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        xml(`
          <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
            <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
            <Default Extension="xml" ContentType="application/xml"/>
            <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
            <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
          </Types>
        `),
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        xml(`
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
          </Relationships>
        `),
        'utf8',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        xml(`
          <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <sheets><sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
          </workbook>
        `),
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        xml(`
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
          </Relationships>
        `),
        'utf8',
      ),
    },
    {
      name: 'xl/styles.xml',
      data: Buffer.from(
        xml(`
          <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
            <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
            <borders count="1"><border/></borders>
            <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
            <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
            <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          </styleSheet>
        `),
        'utf8',
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(sheetXml, 'utf8'),
    },
  ]);
}

function buildRow(
  cells: Array<{ value: unknown; header: boolean }>,
  rowNumber: number,
): string {
  const xmlCells = cells
    .map((cell, index) => buildCell(cell.value, rowNumber, index + 1, cell.header))
    .join('');
  return `<row r="${rowNumber}">${xmlCells}</row>`;
}

function buildCell(
  value: unknown,
  rowNumber: number,
  columnNumber: number,
  header: boolean,
): string {
  const reference = `${columnName(columnNumber)}${rowNumber}`;
  const style = header ? ' s="1"' : '';

  if (value === null || value === undefined || value === '') {
    return `<c r="${reference}"${style}/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function columnName(column: number): string {
  let result = '';
  let current = column;
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content.replace(/>\s+</g, '><').trim()}`;
}

function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, fileName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);

    offset += local.length + fileName.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function dosDateTime(value: Date): { time: number; date: number } {
  const year = Math.max(value.getFullYear(), 1980);
  const time =
    (value.getHours() << 11) |
    (value.getMinutes() << 5) |
    Math.floor(value.getSeconds() / 2);
  const date =
    ((year - 1980) << 9) |
    ((value.getMonth() + 1) << 5) |
    value.getDate();
  return { time, date };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
