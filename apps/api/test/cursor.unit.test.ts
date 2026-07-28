import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  encodeCursor,
  type WeightMeasurementCursor
} from "../src/domain/cursor.js";
import { DomainValidationError } from "../src/domain/errors.js";

const cursor: WeightMeasurementCursor = {
  measuredAt: "2026-07-28T05:30:00.000Z",
  id: "01983f6c-e470-7000-8000-000000000001"
};

describe("WeightMeasurement cursor", () => {
  it("round-trips a valid stable pagination key", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects a value that cannot be decoded as cursor JSON", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(DomainValidationError);
  });

  it("rejects decoded JSON with an invalid cursor shape", () => {
    const invalidShape = Buffer.from(
      JSON.stringify({ measuredAt: cursor.measuredAt, id: "not-a-uuid" }),
      "utf8"
    ).toString("base64url");

    expect(() => decodeCursor(invalidShape)).toThrow(DomainValidationError);
  });
});
