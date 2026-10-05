import { CrcCalculator, Encoder, Profile } from "@garmin/fitsdk";

const start = new Date("2026-10-04T14:00:00Z");
const at = (seconds: number) => new Date(start.valueOf() + seconds * 1000);

/** Synthetic spec-encoded FIT with irregular samples, a pause, and a measured peak. */
export function activityFit(peak = 180): Uint8Array {
  const encoder = new Encoder();
  const write = (number: number, fields: Record<string, unknown>) => encoder.onMesg(number, { mesgNum: number, ...fields });
  write(Profile.MesgNum.FILE_ID!, { type: "activity", manufacturer: "garmin", product: 1, serialNumber: 123, timeCreated: start });
  for (const [seconds, heartRate] of [[0, 100], [2, peak], [3, 120], [15, 140], [20, 150], [25, 160], [30, 170]]) {
    write(Profile.MesgNum.RECORD!, { timestamp: at(seconds!), heartRate, speed: 1, enhancedSpeed: 3,
      distance: seconds! * 3, cadence: 90, power: 150, enhancedAltitude: 100, temperature: 20,
      verticalOscillation: 80, stanceTime: 200, stepLength: 1000, positionLat: 1000, positionLong: 2000 });
  }
  write(Profile.MesgNum.EVENT!, { timestamp: at(0), event: "timer", eventType: "start" });
  write(Profile.MesgNum.EVENT!, { timestamp: at(16), event: "timer", eventType: "stopAll" });
  write(Profile.MesgNum.EVENT!, { timestamp: at(24), event: "timer", eventType: "start" });
  write(Profile.MesgNum.LAP!, { startTime: start, timestamp: at(30), totalElapsedTime: 30,
    totalTimerTime: 22, totalDistance: 90, avgHeartRate: 130, maxHeartRate: peak });
  write(Profile.MesgNum.SESSION!, { startTime: start, timestamp: at(30), totalElapsedTime: 30, totalTimerTime: 22, sport: "running" });
  return encoder.close();
}

/** Protocol-valid compressed timestamp header fixture exposes the official SDK's unsupported path. */
export function compressedActivityFit(): Uint8Array {
  const record = Buffer.alloc(6);
  record[0] = 1; record.writeUInt32LE(1160000000, 1); record[5] = 100;
  const data = Buffer.concat([
    Buffer.from([0x40, 0, 0, 0, 0, 1, 0, 1, 0, 0, 4]),
    Buffer.from([0x41, 0, 0, 20, 0, 2, 253, 4, 0x86, 3, 1, 2]),
    record, Buffer.from([0xa5, 120])
  ]);
  const file = Buffer.alloc(14 + data.length + 2);
  file[0] = 14; file[1] = 0x20; file.writeUInt16LE(2100, 2); file.writeUInt32LE(data.length, 4); file.write(".FIT", 8);
  file.writeUInt16LE(CrcCalculator.calculateCRC(file, 0, 12), 12); data.copy(file, 14);
  file.writeUInt16LE(CrcCalculator.calculateCRC(file, 0, file.length - 2), file.length - 2);
  return file;
}
