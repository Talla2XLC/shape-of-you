import type { IntakeItem, IntakeRequest } from "@shape-of-you/contracts";

/** Source message supplied to a provider-neutral Intake parser. */
export interface IntakeParseRequest {
  readonly requestId: string;
  readonly personId: string;
  readonly text: string;
  readonly locale: string;
  readonly timezone: string;
}

/** Existing ambiguous item plus the latest user clarification. */
export interface IntakeClarificationRequest extends IntakeParseRequest {
  readonly itemId: string;
  readonly answer: string;
}

/** Parsed weight item that still requires a user answer. */
export interface AmbiguousWeightIntakeItem {
  readonly kind: "weight_measurement";
  readonly confidence: number | null;
  readonly status: "needs_clarification";
  readonly clarificationQuestion: string;
}

/** Parsed and typed proposed WeightMeasurement command. */
export interface ReadyWeightIntakeItem {
  readonly kind: "weight_measurement";
  readonly confidence: number | null;
  readonly status: "awaiting_confirmation";
  readonly measuredAt: string;
  readonly timezone: string;
  readonly weightKg: number;
  readonly dedupeKey: string;
}

/** One parser result supported by the first typed Intake slice. */
export type ParsedIntakeItem =
  | AmbiguousWeightIntakeItem
  | ReadyWeightIntakeItem;

/** Provider-neutral natural-language parser boundary. */
export interface IntakeParser {
  /** Splits one source message into ordered independently actionable items. */
  parse(request: IntakeParseRequest): Promise<readonly ParsedIntakeItem[]>;
  /** Re-parses one ambiguous item using a user answer. */
  clarify(request: IntakeClarificationRequest): Promise<ParsedIntakeItem>;
}

/**
 * Derives the public request status without persisting duplicate authority.
 *
 * @param parsingStatus - Persisted parser lifecycle state.
 * @param items - Current independently actionable item projections.
 * @returns Aggregate read-model status.
 */
export function deriveIntakeRequestStatus(
  parsingStatus: IntakeRequest["parsingStatus"],
  items: readonly IntakeItem[]
): IntakeRequest["status"] {
  if (parsingStatus === "queued") {
    return "queued";
  }
  if (parsingStatus === "processing") {
    return "processing";
  }
  if (parsingStatus === "failed") {
    return "failed";
  }
  if (items.length === 0) {
    return "completed";
  }

  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const terminal = items.filter((item) =>
    ["completed", "rejected", "failed"].includes(item.status)
  ).length;

  if (terminal === items.length) {
    if (failed === items.length) {
      return "failed";
    }
    return failed > 0 ? "partial" : "completed";
  }
  if (completed > 0 || failed > 0) {
    return "partial";
  }
  if (items.some((item) => ["queued", "processing"].includes(item.status))) {
    return "processing";
  }
  return "awaiting_action";
}
