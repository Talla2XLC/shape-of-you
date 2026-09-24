import { IntegrationProviderError } from "../provider.js";

const fitEpochMs = Date.UTC(1989, 11, 31);
const maxFitBytes = 2_000_000;
const crcTable = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400
] as const;

/** Historical Garmin estimate emitted by one post-activity FIT message. */
export interface GarminRecoverySnapshot {
  readonly minutes: number;
  readonly observedAt: string;
}

/** Reads only Garmin message 140 fields 9/253 from one intact Activity FIT. */
export function parseGarminRecoverySnapshot(input: Uint8Array): GarminRecoverySnapshot | null {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 14 || bytes.length > maxFitBytes) invalid();
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) invalid();
  if (bytes.toString("ascii", 8, 12) !== ".FIT") invalid();
  const dataEnd = headerSize + bytes.readUInt32LE(4);
  if (dataEnd + 2 !== bytes.length) invalid();
  if (headerSize === 14 && fitCrc(bytes.subarray(0, 12)) !== bytes.readUInt16LE(12)) invalid();
  if (fitCrc(bytes.subarray(0, dataEnd)) !== bytes.readUInt16LE(dataEnd)) invalid();

  const definitions = new Map<number, FitDefinition>();
  let position = headerSize;
  let fileType: number | null = null;
  let manufacturer: number | null = null;
  let candidate: GarminRecoverySnapshot | null = null;
  let candidates = 0;
  while (position < dataEnd) {
    const recordHeader = bytes.readUInt8(position++);
    const compressed = (recordHeader & 0x80) !== 0;
    const local = compressed ? (recordHeader >> 5) & 0x03 : recordHeader & 0x0f;
    if (!compressed && (recordHeader & 0x40) !== 0) {
      ensure(position + 5 <= dataEnd);
      const architecture = bytes.readUInt8(position + 1);
      ensure(architecture === 0 || architecture === 1);
      const bigEndian = architecture === 1;
      const global = readNumber(bytes, position + 2, 2, bigEndian);
      const count = bytes.readUInt8(position + 4);
      position += 5;
      ensure(position + count * 3 <= dataEnd);
      const fields: FitField[] = [];
      for (let index = 0; index < count; index++) {
        fields.push({ number: bytes.readUInt8(position), size: bytes.readUInt8(position + 1), type: bytes.readUInt8(position + 2) });
        position += 3;
      }
      const developerSizes: number[] = [];
      if ((recordHeader & 0x20) !== 0) {
        ensure(position < dataEnd);
        const developerCount = bytes.readUInt8(position++);
        ensure(position + developerCount * 3 <= dataEnd);
        for (let index = 0; index < developerCount; index++) {
          developerSizes.push(bytes.readUInt8(position + 1));
          position += 3;
        }
      }
      definitions.set(local, { global, bigEndian, fields, developerSizes });
      continue;
    }
    const definition = definitions.get(local);
    if (!definition) invalid();
    const selected = new Map<number, { value: number | null; type: number; size: number }>();
    for (const field of definition.fields) {
      ensure(position + field.size <= dataEnd);
      if ((definition.global === 0 && (field.number === 0 || field.number === 1))
        || (definition.global === 140 && (field.number === 9 || field.number === 253))) {
        selected.set(field.number, {
          value: field.size === 1 || field.size === 2 || field.size === 4
            ? readNumber(bytes, position, field.size, definition.bigEndian)
            : null,
          type: field.type,
          size: field.size
        });
      }
      position += field.size;
    }
    for (const size of definition.developerSizes) {
      ensure(position + size <= dataEnd);
      position += size;
    }
    if (definition.global === 0) {
      const type = selected.get(0);
      const maker = selected.get(1);
      if (type?.type !== 0 || type.size !== 1 || maker?.type !== 0x84 || maker.size !== 2) invalid();
      fileType = type.value;
      manufacturer = maker.value;
    }
    if (definition.global === 140) {
      candidates++;
      const value = selected.get(9);
      const timestamp = selected.get(253);
      if (value?.type !== 0x84 || value.size !== 2 || timestamp?.type !== 0x86 || timestamp.size !== 4) continue;
      if (value.value === null || value.value === 0xffff || timestamp.value === null || timestamp.value === 0xffffffff) continue;
      const observedMs = fitEpochMs + timestamp.value * 1000;
      if (!Number.isFinite(observedMs) || observedMs < Date.UTC(2000, 0, 1) || observedMs > Date.UTC(2100, 0, 1)) continue;
      candidate = { minutes: value.value, observedAt: new Date(observedMs).toISOString() };
    }
  }
  if (position !== dataEnd || fileType === null || manufacturer === null) invalid();
  if (fileType !== 4 || manufacturer !== 1 || candidates !== 1) return null;
  return candidate;
}

interface FitField {
  readonly number: number;
  readonly size: number;
  readonly type: number;
}
interface FitDefinition {
  readonly global: number;
  readonly bigEndian: boolean;
  readonly fields: readonly FitField[];
  readonly developerSizes: readonly number[];
}

function readNumber(bytes: Buffer, position: number, size: number, bigEndian: boolean): number {
  if (size === 1) return bytes.readUInt8(position);
  if (size === 2) return bigEndian ? bytes.readUInt16BE(position) : bytes.readUInt16LE(position);
  return bigEndian ? bytes.readUInt32BE(position) : bytes.readUInt32LE(position);
}
function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = crcTable[crc & 0x0f]!;
    crc = (crc >> 4) & 0x0fff;
    crc ^= tmp ^ crcTable[byte & 0x0f]!;
    tmp = crcTable[crc & 0x0f]!;
    crc = (crc >> 4) & 0x0fff;
    crc ^= tmp ^ crcTable[(byte >> 4) & 0x0f]!;
  }
  return crc;
}
function ensure(condition: boolean): void { if (!condition) invalid(); }
function invalid(): never { throw new IntegrationProviderError("provider_response_invalid"); }
