import { createDeflateRaw } from "node:zlib";
import { once } from "node:events";

// 流式 xlsx 写路径（票据 19）：替代 SheetJS 的整表对象存储——十万行 × 25 列
// 峰值 RSS ~750MiB 超出 512MiB 预算。这里按 OOXML 规范手写工作表 XML，
// 经 deflate 流式压缩进 zip（data descriptor 方式），任一时刻内存里只有
// 当前页的行文本与压缩输出，不持有整表。

// ---------- CRC-32（IEEE，流式增量） ----------

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(update: number, chunk: Buffer): number {
  let c = update >>> 0;
  for (let index = 0; index < chunk.length; index += 1) {
    c = (CRC32_TABLE[(c ^ chunk[index]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return c;
}

const CRC32_INIT = ~0;
const crcFinish = (update: number) => (update ^ ~0) >>> 0;


// ---------- ZIP（little-endian 手写；小文件 store，大文件 deflate + data descriptor） ----------

const DOS_EPOCH = (() => {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { time, date };
})();

type CentralEntry = {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
};

/** beginDeflated 返回的同步写入 sink：write 必须在无让步的同步块内调用。 */
export type ZipSink = {
  write: (chunk: Buffer) => void;
  finish: () => Promise<void>;
  abort: () => void;
};

export class ZipWriter {
  private parts: Buffer[] = [];
  private offset = 0;
  private entries: CentralEntry[] = [];

  /** 小文件直接 store：内容已在内存，无需压缩收益。 */
  addStored(name: string, content: string | Buffer): void {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crcFinish(crc32(CRC32_INIT, data));
    const localOffset = this.offset;
    this.push(this.localHeader(nameBytes, { flags: 0, method: 0, crc, compressedSize: data.length, uncompressedSize: data.length }));
    this.push(nameBytes);
    this.push(data);
    this.entries.push({ name: nameBytes, flags: 0, method: 0, crc, compressedSize: data.length, uncompressedSize: data.length, offset: localOffset });
  }

  private push(part: Buffer): void {
    this.parts.push(part);
    this.offset += part.length;
  }

  private localHeader(nameBytes: Buffer, fields: { flags: number; method: number; crc: number; compressedSize: number; uncompressedSize: number }): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(fields.flags, 6);
    header.writeUInt16LE(fields.method, 8);
    header.writeUInt16LE(DOS_EPOCH.time, 10);
    header.writeUInt16LE(DOS_EPOCH.date, 12);
    header.writeUInt32LE(fields.crc, 14);
    header.writeUInt32LE(fields.compressedSize, 18);
    header.writeUInt32LE(fields.uncompressedSize, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    return header;
  }

  /**
   * 大文件流式条目：调用方 beginDeflated 拿到同步 sink，在同步代码块内逐块 write，
   * 完成后 await finish() 收尾（仅等压缩流 flush，期间不再触碰数据库）。
   * write 不做背压等待——压缩在 libuv 线程池并发进行，产出端被同步事务阻塞时
   * 队列上界为未压缩总字节数（十万行×25 列约 220MiB），仍远低于内存预算；
   * 换取的关键性质是数据库扫描全程无事件循环让步点（票据 19 审查 P1）。
   */
  beginDeflated(name: string): ZipSink {
    const nameBytes = Buffer.from(name, "utf8");
    const localOffset = this.offset;
    this.push(this.localHeader(nameBytes, { flags: 0x08, method: 8, crc: 0, compressedSize: 0, uncompressedSize: 0 }));
    this.push(nameBytes);

    const deflate = createDeflateRaw({ level: 1 });
    const compressed: Buffer[] = [];
    deflate.on("data", (chunk: Buffer) => compressed.push(chunk));
    let crc = CRC32_INIT;
    let uncompressedSize = 0;
    let sealed = false;
    const seal = async () => {
      if (sealed) return;
      sealed = true;
      deflate.end();
      await once(deflate, "end");
      const data = Buffer.concat(compressed);
      this.push(data);
      const finalCrc = crcFinish(crc);
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(finalCrc, 4);
      descriptor.writeUInt32LE(data.length, 8);
      descriptor.writeUInt32LE(uncompressedSize, 12);
      this.push(descriptor);
      this.entries.push({ name: nameBytes, flags: 0x08, method: 8, crc: finalCrc, compressedSize: data.length, uncompressedSize, offset: localOffset });
    };
    return {
      write: (chunk: Buffer) => {
        crc = crc32(crc, chunk);
        uncompressedSize += chunk.length;
        deflate.write(chunk);
      },
      finish: seal,
      abort: () => {
        if (sealed) return;
        sealed = true;
        deflate.destroy();
      },
    };
  }

  finish(): Buffer {
    const centralStart = this.offset;
    for (const entry of this.entries) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4); // version made by
      central.writeUInt16LE(20, 6); // version needed
      central.writeUInt16LE(entry.flags, 8);
      central.writeUInt16LE(entry.method, 10);
      central.writeUInt16LE(DOS_EPOCH.time, 12);
      central.writeUInt16LE(DOS_EPOCH.date, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.compressedSize, 20);
      central.writeUInt32LE(entry.uncompressedSize, 24);
      central.writeUInt16LE(entry.name.length, 28);
      central.writeUInt32LE(entry.offset, 42);
      this.push(central);
      this.push(entry.name);
    }
    const centralSize = this.offset - centralStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    this.push(eocd);
    return Buffer.concat(this.parts);
  }
}

// ---------- XML 工具 ----------

export function escapeXmlText(value: string): string {
  if (!/[&<>]/.test(value)) return value;
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/** 0 基列号 → A/Z/AA…（xlsx 单元格引用） */
export function columnLetters(index: number): string {
  let letters = "";
  let current = index;
  do {
    letters = String.fromCharCode(65 + (current % 26)) + letters;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return letters;
}
