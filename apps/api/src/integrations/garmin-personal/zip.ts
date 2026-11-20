import { inflateRawSync } from "node:zlib";

import { ActivityDetailsReadError } from "../provider.js";

const limit = 2_000_000;

/** Extracts one unambiguous FIT from a bounded, unencrypted single-disk ZIP without filesystem writes. */
export function extractOriginalFit(archive: Uint8Array): Uint8Array | null {
  const bytes = Buffer.from(archive);
  if (bytes.length > limit) throw new ActivityDetailsReadError("limit_exceeded");
  try {
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
      if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
        end = offset;
        break;
      }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) invalid();
    const count = bytes.readUInt16LE(end + 10);
    if (count !== bytes.readUInt16LE(end + 8) || count === 0 || count > 16) invalid();
    const directorySize = bytes.readUInt32LE(end + 12);
    let cursor = bytes.readUInt32LE(end + 16);
    if (cursor + directorySize !== end) invalid();
    let totalInflated = 0;
    let fit: Buffer | null = null;
    const occupied: Array<[number, number]> = [];
    for (let entry = 0; entry < count; entry++) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid();
      const flags = bytes.readUInt16LE(cursor + 8);
      const method = bytes.readUInt16LE(cursor + 10);
      const crc = bytes.readUInt32LE(cursor + 16);
      const compressed = bytes.readUInt32LE(cursor + 20);
      const inflated = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28);
      const extraLength = bytes.readUInt16LE(cursor + 30);
      const commentLength = bytes.readUInt16LE(cursor + 32);
      const local = bytes.readUInt32LE(cursor + 42);
      if ((flags & ~0x0808) !== 0 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) !== 0) invalid();
      totalInflated += inflated;
      if (totalInflated > limit || compressed > limit) throw new ActivityDetailsReadError("limit_exceeded");
      if (cursor + 46 + nameLength + extraLength + commentLength > end || local + 30 > bytes.length) invalid();
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = nameBytes.toString("utf8");
      if (name.includes("\0") || name.startsWith("/") || name.split(/[\\/]/).includes("..")) invalid();
      if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) invalid();
      const localNameLength = bytes.readUInt16LE(local + 26);
      const localExtraLength = bytes.readUInt16LE(local + 28);
      const dataStart = local + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressed;
      if (dataEnd > bytes.readUInt32LE(end + 16) || !nameBytes.equals(bytes.subarray(local + 30, local + 30 + localNameLength))) invalid();
      let entryEnd = dataEnd;
      if (flags & 8) {
        const descriptor = bytes.readUInt32LE(entryEnd) === 0x08074b50 ? entryEnd + 4 : entryEnd;
        entryEnd = descriptor + 12;
        if (entryEnd > bytes.readUInt32LE(end + 16) || bytes.readUInt32LE(descriptor) !== crc || bytes.readUInt32LE(descriptor + 4) !== compressed || bytes.readUInt32LE(descriptor + 8) !== inflated) invalid();
      }
      if (occupied.some(([from, to]) => local < to && entryEnd > from)) invalid();
      occupied.push([local, entryEnd]);
      if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== inflated)) invalid();
      const decoded = method === 0 ? null : inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: limit, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (decoded && decoded.engine.bytesWritten !== compressed) invalid();
      const data = decoded ? decoded.buffer : bytes.subarray(dataStart, dataEnd);
      if (data.length !== inflated || crc32(data) !== crc) invalid();
      if (/\.fit$/i.test(name)) {
        if (fit || data.length < 12 || data.subarray(8, 12).toString("ascii") !== ".FIT") invalid();
        fit = data;
      }
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== end) invalid();
    return fit;
  } catch (error) {
    if (error instanceof ActivityDetailsReadError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") throw new ActivityDetailsReadError("limit_exceeded");
    invalid();
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function invalid(): never { throw new ActivityDetailsReadError("invalid_fit"); }
