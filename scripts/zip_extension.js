// 將 chrome-extension/ 資料夾打包成 public/chrome-extension.zip
// 純 Node.js 實作，不需外部 zip / PowerShell，可跑在任何平台（含 Cloudflare 建置）
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extDir = path.join(root, 'chrome-extension');
const outZip = path.join(root, 'public', 'chrome-extension.zip');

if (!existsSync(extDir)) {
  console.error('找不到 chrome-extension/ 資料夾，請先確認擴充來源存在。');
  process.exit(1);
}

if (existsSync(outZip)) rmSync(outZip);

// Collect files
const files = [];
function walk(dir, base) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base);
    else files.push({ full, rel });
  }
}
walk(extDir, extDir);

// CRC32 table (standard implementation)
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// DOS time/date encoding
function dosDateTime(date) {
  const year = date.getFullYear() - 1980;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const min = date.getMinutes();
  const sec = date.getSeconds();
  const time = ((hour << 11) | (min << 5) | (sec >> 1)) & 0xffff;
  const dateFields = (((year & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)) & 0xffff;
  return { time, date: dateFields };
}

const { time, date: dateFields } = dosDateTime(new Date());

// Build zip buffer (store all files as uncompressed — small enough, no external deps)
const chunks = [];
const centralDir = [];
let offset = 0;

for (const { full, rel } of files) {
  const data = readFileSync(full);
  const crc = crc32(data);
  // UTF-8 filename
  const nameBuf = Buffer.from(rel.split(path.sep).join('/'), 'utf8');

  // Local file header
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(0x0a, 4); // version needed (10 = 1.0)
  localHeader.writeUInt16LE(0x0800, 6); // general purpose: UTF-8 name
  localHeader.writeUInt16LE(0, 8); // compression: store
  localHeader.writeUInt16LE(time, 10);
  localHeader.writeUInt16LE(dateFields, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18); // compressed size
  localHeader.writeUInt32LE(data.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  chunks.push(localHeader, data);

  // Central directory entry
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0a, 4); // version made by
  central.writeUInt16LE(0x0a, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10); // compression
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(dateFields, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); // extra len
  central.writeUInt16LE(0, 32); // comment len
  central.writeUInt16LE(0, 34); // disk num
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(offset, 42);
  nameBuf.copy(central, 46);

  centralDir.push(central);
  offset += localHeader.length + data.length;
}

const centralDirBuf = Buffer.concat(centralDir);
const centralDirSize = centralDirBuf.length;
const centralDirOffset = offset;

// End of central directory record
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4); // disk num
eocd.writeUInt16LE(0, 6); // disk with central dir
eocd.writeUInt16LE(files.length, 8); // entries on disk
eocd.writeUInt16LE(files.length, 10); // total entries
eocd.writeUInt32LE(centralDirSize, 12);
eocd.writeUInt32LE(centralDirOffset, 16);
eocd.writeUInt16LE(0, 20); // comment len

writeFileSync(outZip, Buffer.concat([...chunks, centralDirBuf, eocd]));
console.log(`已產生 ${path.relative(root, outZip)}（含 ${files.length} 個檔案）`);
