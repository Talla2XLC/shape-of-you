import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { parseGarminRecoverySnapshot } from "../src/integrations/intervals-icu/fit-recovery.js";
import { IntervalsIcuProvider } from "../src/integrations/intervals-icu/provider.js";
import { FakeHealthDataProvider } from "../src/integrations/fake-provider.js";
import { IntegrationService } from "../src/integrations/integration.service.js";
import { IntegrationProviderError } from "../src/integrations/provider.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import type { IntegrationStore, RecoveryFactPointer } from "../src/integrations/integration-store.js";
import type { RecoveryStore } from "../src/storage/recovery-repository.js";
import type { TrainingStore } from "../src/storage/training-repository.js";

const crcTable = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

function crc(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) {
    let entry = crcTable[value & 15]!;
    value = (value >> 4) & 0x0fff;
    value ^= entry ^ crcTable[byte & 15]!;
    entry = crcTable[value & 15]!;
    value = (value >> 4) & 0x0fff;
    value ^= entry ^ crcTable[(byte >> 4) & 15]!;
  }
  return value;
}

function fixture(options: { minutes?: number; maker?: number; count?: number; fieldType?: number; omitValue?: boolean } = {}): Buffer {
  const fileDefinition = Buffer.from([0x40, 0, 0, 0, 0, 2, 0, 1, 0, 1, 2, 0x84]);
  const fileData = Buffer.from([0, 4, options.maker ?? 1, 0]);
  const fields = options.omitValue
    ? Buffer.from([253, 4, 0x86])
    : Buffer.from([9, 2, options.fieldType ?? 0x84, 253, 4, 0x86]);
  const messageDefinition = Buffer.concat([Buffer.from([0x41, 0, 0, 140, 0, options.omitValue ? 1 : 2]), fields]);
  const messageData = Buffer.alloc(options.omitValue ? 5 : 7);
  messageData[0] = 1;
  if (!options.omitValue) messageData.writeUInt16LE(options.minutes ?? 2_287, 1);
  messageData.writeUInt32LE((Date.parse("2026-09-21T12:42:06.000Z") - Date.UTC(1989, 11, 31)) / 1000, options.omitValue ? 1 : 3);
  const data = Buffer.concat([fileDefinition, fileData, messageDefinition,
    ...Array.from({ length: options.count ?? 1 }, () => messageData)]);
  const header = Buffer.alloc(14);
  header[0] = 14;
  header[1] = 0x10;
  header.writeUInt32LE(data.length, 4);
  header.write(".FIT", 8, "ascii");
  header.writeUInt16LE(crc(header.subarray(0, 12)), 12);
  const withoutCrc = Buffer.concat([header, data]);
  const trailer = Buffer.alloc(2);
  trailer.writeUInt16LE(crc(withoutCrc));
  return Buffer.concat([withoutCrc, trailer]);
}

describe("bounded Garmin FIT recovery evidence", () => {
  it("reads a post-activity minute estimate at the message UTC timestamp, including zero", () => {
    expect(parseGarminRecoverySnapshot(fixture())).toEqual({
      minutes: 2_287,
      observedAt: "2026-09-21T12:42:06.000Z"
    });
    expect(parseGarminRecoverySnapshot(fixture({ minutes: 0 }))?.minutes).toBe(0);
  });

  it("leaves missing, ambiguous, wrong-type, and non-Garmin values unavailable", () => {
    expect(parseGarminRecoverySnapshot(fixture({ omitValue: true }))).toBeNull();
    expect(parseGarminRecoverySnapshot(fixture({ count: 2 }))).toBeNull();
    expect(parseGarminRecoverySnapshot(fixture({ fieldType: 0x83 }))).toBeNull();
    expect(parseGarminRecoverySnapshot(fixture({ maker: 2 }))).toBeNull();
  });

  it("rejects damage and oversized input before accepting an estimate", () => {
    const damaged = fixture();
    damaged[damaged.length - 4] = damaged.readUInt8(damaged.length - 4) ^ 1;
    expect(() => parseGarminRecoverySnapshot(damaged)).toThrow();
    expect(() => parseGarminRecoverySnapshot(Buffer.alloc(2_000_001))).toThrow();
  });

  it("downloads one allowlisted original file with bounded gzip and bearer auth", async () => {
    const request = vi.fn().mockResolvedValue(new Response(gzipSync(fixture()), {
      status: 200,
      headers: { "content-type": "application/gzip" }
    }));
    const provider = new IntervalsIcuProvider({
      clientId: "test", clientSecret: "test", redirectUri: "https://shape.example/callback", fetch: request
    });
    const file = await provider.originalActivityFile("opaque", "i123");
    expect(parseGarminRecoverySnapshot(file!)?.minutes).toBe(2_287);
    expect(request).toHaveBeenCalledWith("https://intervals.icu/api/v1/activity/i123/file",
      expect.objectContaining({ redirect: "error", headers: expect.objectContaining({ authorization: "Bearer opaque" }) }));
  });

  it("rejects oversized decompression and non-binary content", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(gzipSync(Buffer.alloc(2_000_001)), {
        status: 200, headers: { "content-type": "application/gzip" }
      }))
      .mockResolvedValueOnce(new Response("<html>error</html>", {
        status: 200, headers: { "content-type": "text/html" }
      }));
    const provider = new IntervalsIcuProvider({
      clientId: "test", clientSecret: "test", redirectUri: "https://shape.example/callback", fetch: request
    });
    await expect(provider.originalActivityFile("opaque", "i123")).rejects.toMatchObject({ failureCode: "provider_response_invalid" });
    await expect(provider.originalActivityFile("opaque", "i123")).rejects.toMatchObject({ failureCode: "provider_response_invalid" });
  });

  it("imports, corrects and withdraws one historical fact while keeping absent transport evidence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    const personId = "00000000-0000-4000-8000-000000000201";
    const connectionId = "00000000-0000-4000-8000-000000000202";
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const provider = new FakeHealthDataProvider();
    const activity = {
      identity: "i123", fileType: "fit", occurredAt: "2026-09-21T12:00:00.000Z",
      localDate: "2026-09-21", timezone: "UTC", name: "Training", durationSeconds: 3600,
      distanceMeters: null, trainingLoad: null, trainingLoadBasis: null,
      trainingLoadBasisVersion: null, averageHeartRate: null, maximumHeartRate: null,
      deviceName: "Garmin", garminAttributed: true
    } as const;
    provider.reconciliation = { wellness: [], activities: [activity] };
    provider.activityFiles.set("i123", fixture());
    const receipts = new Map<string, string>();
    let pointer: RecoveryFactPointer | null = null;
    const currentPointer = (): RecoveryFactPointer | null => pointer;
    const store = {
      personTimezone: vi.fn(async () => "Europe/Belgrade"),
      recordInbox: vi.fn(async (_id: string, _consent: string, _kind: string, identity: string, checksum: string) =>
        receipts.get(identity) === checksum ? { state: "unchanged" } : { state: "process", receiptId: identity }),
      completeInbox: vi.fn(async (_id: string, _consent: string, receiptId: string) => {
        receipts.set(receiptId, pendingChecksum);
        return true;
      }),
      recoveryFact: vi.fn(async () => pointer),
      linkRecoveryFact: vi.fn(async (_id: string, _consent: string, _identity: string, _receipt: string,
        _key: string, checksum: string, observationId: string) => {
        pointer = { checksum, observationId, confirmedConsentId: "consent", confirmedDeliveryId: "i123" };
        return true;
      }),
      markSyncSucceeded: vi.fn(), markSyncFailed: vi.fn(), releaseClaim: vi.fn()
    } as unknown as IntegrationStore;
    let pendingChecksum = "";
    vi.mocked(store.recordInbox).mockImplementation(async (_id, _consent, _kind, identity, checksum) => {
      pendingChecksum = checksum;
      return receipts.get(identity) === checksum ? { state: "unchanged" } : { state: "process", receiptId: identity };
    });
    let nextId = 0;
    const createObservation = vi.fn(async () => ({ created: true, observation: { id: `fact-${++nextId}` } }));
    const correctObservation = vi.fn(async () => ({ created: true, observation: { id: `fact-${++nextId}` } }));
    const withdrawObservation = vi.fn(async () => ({ created: true, observation: { id: `fact-${++nextId}` } }));
    const recovery = { createObservation, correctObservation, withdrawObservation } as unknown as RecoveryStore;
    const training = {
      importExternalActivity: vi.fn(async () => "unchanged"),
      reconcileRecentActivityLinks: vi.fn(async () => {})
    } as unknown as TrainingStore;
    const service = new IntegrationService(new SyntheticPersonContext(personId), store, provider, cipher, recovery, training);
    const connection = {
      id: connectionId, personId, recoveryConnectionId: "00000000-0000-4000-8000-000000000203",
      consentId: "00000000-0000-4000-8000-000000000204",
      credential: cipher.encrypt("token", `intervals_icu:${personId}:${connectionId}`),
      historicalImportStatus: "not_requested" as const, historicalCursorBefore: null, historicalNextAttemptAt: null
    };

    await service.reconcileConnection(connection);
    expect(createObservation).toHaveBeenCalledWith(personId, expect.objectContaining({
      timezone: "Europe/Belgrade", quality: "estimated", observedFrom: "2026-09-21T12:42:06.000Z",
      detail: { type: "metric", metric: "garmin_post_activity_recovery_time", value: 2_287, unit: "minute" }
    }));
    await service.reconcileConnection(connection);
    expect(provider.activityFileCalls).toHaveLength(1);

    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z"));
    provider.activityFiles.set("i123", fixture({ minutes: 120 }));
    await service.reconcileConnection(connection);
    expect(correctObservation).toHaveBeenCalledOnce();
    expect(currentPointer()?.observationId).toBe("fact-2");
    const trainingCalls = vi.mocked(training.importExternalActivity).mock.calls;
    expect(trainingCalls[0]?.[0].normalizedChecksum).toBe(trainingCalls[1]?.[0].normalizedChecksum);

    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    provider.activityFiles.set("i123", null);
    await service.reconcileConnection(connection);
    expect(withdrawObservation).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
    vi.spyOn(provider, "originalActivityFile").mockRejectedValueOnce(new IntegrationProviderError("provider_timeout"));
    await service.reconcileConnection(connection);
    expect(withdrawObservation).not.toHaveBeenCalled();
    expect(currentPointer()?.observationId).toBe("fact-2");

    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    provider.activityFiles.set("i123", fixture({ omitValue: true }));
    await service.reconcileConnection(connection);
    expect(withdrawObservation).toHaveBeenCalledOnce();
    expect(currentPointer()?.checksum).toBe("removed");
    vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
    provider.activityFiles.set("i123", fixture({ minutes: 60 }));
    await service.reconcileConnection(connection);
    expect(createObservation).toHaveBeenCalledTimes(2);
    expect(currentPointer()?.observationId).toBe("fact-4");
    vi.useRealTimers();
  });

  it("resumes FIT work after the per-pass download cap without claiming full freshness", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    const personId = "00000000-0000-4000-8000-000000000301";
    const connectionId = "00000000-0000-4000-8000-000000000302";
    const cipher = new ConnectionCredentialCipher("v1", new Map([["v1", randomBytes(32)]]));
    const provider = new FakeHealthDataProvider();
    provider.reconciliation = {
      wellness: [],
      activities: Array.from({ length: 21 }, (_, index) => ({
        identity: `i${index}`, fileType: "fit", occurredAt: "2026-09-21T12:00:00.000Z",
        localDate: "2026-09-21", timezone: "UTC", name: `Training ${index}`, durationSeconds: 3600,
        distanceMeters: null, trainingLoad: null, trainingLoadBasis: null,
        trainingLoadBasisVersion: null, averageHeartRate: null, maximumHeartRate: null,
        deviceName: "Garmin", garminAttributed: true
      }))
    };
    for (const activity of provider.reconciliation.activities) {
      provider.activityFiles.set(activity.identity, fixture({ omitValue: true }));
    }
    const normalized = new Map<string, string>();
    const pending = new Map<string, string>();
    const markSyncPartial = vi.fn();
    const markSyncSucceeded = vi.fn();
    const store = {
      personTimezone: vi.fn(async () => "UTC"),
      recordInbox: vi.fn(async (_id: string, _consent: string, _kind: string, identity: string, checksum: string) => {
        pending.set(identity, checksum);
        return normalized.get(identity) === checksum
          ? { state: "unchanged" as const }
          : { state: "process" as const, receiptId: identity };
      }),
      completeInbox: vi.fn(async (_id: string, _consent: string, identity: string) => {
        normalized.set(identity, pending.get(identity)!);
        return true;
      }),
      recoveryFact: vi.fn(async () => null),
      markSyncPartial, markSyncSucceeded, releaseClaim: vi.fn()
    } as unknown as IntegrationStore;
    const training = {
      importExternalActivity: vi.fn(async () => "unchanged"),
      reconcileRecentActivityLinks: vi.fn(async () => {})
    } as unknown as TrainingStore;
    const service = new IntegrationService(new SyntheticPersonContext(personId), store, provider, cipher,
      {} as RecoveryStore, training);
    const connection = {
      id: connectionId, personId, recoveryConnectionId: "00000000-0000-4000-8000-000000000303",
      consentId: "00000000-0000-4000-8000-000000000304",
      credential: cipher.encrypt("token", `intervals_icu:${personId}:${connectionId}`),
      historicalImportStatus: "not_requested" as const, historicalCursorBefore: null, historicalNextAttemptAt: null
    };
    await service.reconcileConnection(connection);
    expect(provider.activityFileCalls).toHaveLength(20);
    expect(markSyncPartial).toHaveBeenCalledOnce();
    expect(markSyncSucceeded).not.toHaveBeenCalled();
    await service.reconcileConnection(connection);
    expect(provider.activityFileCalls).toHaveLength(21);
    expect(markSyncSucceeded).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
