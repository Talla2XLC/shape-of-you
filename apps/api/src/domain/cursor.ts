import { DomainValidationError } from "./errors.js";

/** Stable keyset cursor for descending WeightMeasurement pagination. */
export interface WeightMeasurementCursor {
  /** ISO instant of the last item returned on the previous page. */
  readonly measuredAt: string;
  /** UUID used as the deterministic tie-breaker for equal timestamps. */
  readonly id: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Encodes a pagination position as an opaque URL-safe cursor.
 *
 * @param cursor - Stable timestamp and UUID pagination key.
 * @returns Base64url-encoded cursor value.
 */
export function encodeCursor(cursor: WeightMeasurementCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decodes and validates an opaque WeightMeasurement pagination cursor.
 *
 * @param value - Base64url cursor received from an API client.
 * @returns The validated timestamp and UUID pagination key.
 * @throws DomainValidationError when decoding, JSON parsing, or validation fails.
 */
export function decodeCursor(value: string): WeightMeasurementCursor {
  let parsed: Partial<WeightMeasurementCursor>;

  try {
    parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<WeightMeasurementCursor>;
  } catch {
    throw new DomainValidationError("cursor is invalid");
  }

  if (
    typeof parsed.measuredAt !== "string" ||
    Number.isNaN(new Date(parsed.measuredAt).valueOf()) ||
    typeof parsed.id !== "string" ||
    !uuidPattern.test(parsed.id)
  ) {
    throw new DomainValidationError("cursor is invalid");
  }

  return {
    measuredAt: parsed.measuredAt,
    id: parsed.id
  };
}

/** Versioned keyset cursor for mixed instant and date-only Weight facts. */
export interface WeightListCursor {
  readonly version: 2;
  readonly localDate: string;
  readonly measuredAt: string | null;
  readonly id: string;
}

/** Encodes the mixed-precision Weight list position. */
export function encodeWeightCursor(cursor: WeightListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Decodes and validates the versioned mixed-precision Weight cursor. */
export function decodeWeightCursor(value: string): WeightListCursor {
  let parsed: Partial<WeightListCursor>;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<WeightListCursor>;
  } catch {
    throw new DomainValidationError("cursor is invalid");
  }
  if (
    parsed.version !== 2 ||
    typeof parsed.localDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.localDate) ||
    (parsed.measuredAt !== null &&
      (typeof parsed.measuredAt !== "string" ||
        Number.isNaN(new Date(parsed.measuredAt).valueOf()))) ||
    typeof parsed.id !== "string" ||
    !uuidPattern.test(parsed.id)
  ) {
    throw new DomainValidationError("cursor is invalid");
  }
  return {
    version: 2,
    localDate: parsed.localDate,
    measuredAt: parsed.measuredAt,
    id: parsed.id
  };
}
