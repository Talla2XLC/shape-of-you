import type { ActivityDetailsIssue, MetricObservationDetail, SleepObservationDetail, ProviderConnectedDayRecord, ProviderBodyMeasurementRecord } from "@shape-of-you/contracts";

/** Safe provider failure classes persisted in the connection projection. */
export type IntegrationFailureCode =
  | "authorization_required"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_response_invalid"
  | "cutover_source_stopped";

/** Provider-neutral token result kept behind the encrypted credential boundary. */
export interface ProviderAuthorization {
  readonly accessToken: string;
  readonly externalUserId: string;
}

/** Narrow provider-neutral daily wellness record. */
export interface ProviderWellnessRecord {
  readonly identity: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly updatedAt?: string | null;
  readonly totalSleepMinutes: number | null;
  readonly sleepScore: number | null;
  readonly restingHeartRate: number | null;
  readonly averageSleepingHeartRate: number | null;
  readonly hrvRmssd: number | null;
  readonly oxygenSaturation: number | null;
  readonly respirationRate: number | null;
  readonly bodyBatteryMinimum: number | null;
  readonly bodyBatteryMaximum: number | null;
  /** Last known value for localDate; does not imply a known measurement timestamp. */
  readonly bodyBatteryLatest?: number | null;
  readonly steps?: number | null;
  readonly sleepDetail?: SleepObservationDetail | null;
  readonly extraMetrics?: readonly MetricObservationDetail[];
  readonly bodyBatteryInstant?: { readonly observedAt: string; readonly value: number } | null;
  readonly naps?: readonly { readonly identity: string; readonly observedFrom: string; readonly observedUntil: string; readonly totalSleepMinutes: number }[];
  /** Only successful authoritative groups may withdraw absent fields. Omitted means legacy daily fields. */
  readonly authoritativeFactKeys?: readonly string[];
}

/** Narrow provider-neutral activity summary; detailed routes/FIT remain excluded. */
export interface ProviderActivityRecord {
  readonly identity: string;
  readonly fileType?: string | null;
  readonly occurredAt: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly name: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly trainingLoad: number | null;
  readonly trainingLoadBasis: "relative_training_stress" | null;
  readonly trainingLoadBasisVersion: string | null;
  readonly averageHeartRate: number | null;
  readonly maximumHeartRate: number | null;
  readonly deviceName: string | null;
  readonly garminAttributed: boolean;
  readonly trainingStressScore?: number | null;
  readonly providerExerciseLoad?: number | null;
  readonly providerExerciseLoadBasis?: "garmin_activity_training_load_v1" | null;
  readonly aerobicTrainingEffect?: number | null;
  readonly anaerobicTrainingEffect?: number | null;
  readonly caloriesKcal?: number | null;
  readonly averagePowerWatts?: number | null;
  readonly normalizedPowerWatts?: number | null;
  readonly maximumPowerWatts?: number | null;
  readonly intensityFactor?: number | null;
  readonly bodyBatteryDelta?: number | null;
}

/** One bounded reconciliation response from an external health provider. */
export interface ProviderReconciliation {
  readonly wellness: readonly ProviderWellnessRecord[];
  readonly activities: readonly ProviderActivityRecord[];
  readonly connectedDays?: readonly ProviderConnectedDayRecord[];
  readonly bodyMeasurements?: readonly ProviderBodyMeasurementRecord[];
  /** Failed optional source groups remain untouched and historical cursors must not advance. */
  readonly incomplete?: boolean;
}

/** Per-read transport bounds and current authorization guard; never grants write authority. */
export interface ProviderReadOptions {
  /** Wider transport dates for activity starts; final write ownership is checked separately. */
  readonly activityFromDate?: string;
  readonly activityToDate?: string;
  /** Revalidates current consent/import policy before each external request. */
  readonly beforeRequest?: () => Promise<void>;
}

/** Typed data-reading boundary shared by the two supported providers. */
export interface HealthDataReader {
  reconcile(accessToken: string, fromLocalDate: string, toLocalDate: string, scope?: string, options?: ProviderReadOptions): Promise<ProviderReconciliation>;
  originalActivityFile(accessToken: string, activityId: string, scope?: string, options?: ProviderReadOptions): Promise<Uint8Array | null>;
}

/** OAuth authorization/revocation belongs only to providers supporting that contract. */
export interface HealthDataProvider extends HealthDataReader {
  authorizationUrl(state: string): string;
  exchangeAuthorizationCode(code: string): Promise<ProviderAuthorization>;
  disconnect(accessToken: string): Promise<void>;
}

/** Bounded, redacted transport evidence that may be written to operational logs. */
export interface IntegrationProviderDiagnostic {
  readonly operation: "oauth_token_exchange";
  readonly httpStatus: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly responseBody: string;
  readonly responseBodyTruncated: boolean;
}

/** Sanitized provider error that may carry only explicitly redacted, bounded diagnostics. */
export class IntegrationProviderError extends Error {
  public constructor(
    public readonly failureCode: IntegrationFailureCode,
    message = "External health provider request failed",
    public readonly diagnostic?: IntegrationProviderDiagnostic
  ) {
    super(message);
    this.name = "IntegrationProviderError";
  }
}

/** Sanitized original-file or FIT decoder failure recorded in the existing import receipt. */
export class ActivityDetailsReadError extends IntegrationProviderError {
  public constructor(public readonly issue: ActivityDetailsIssue) {
    super("provider_response_invalid", "Activity details could not be read");
    this.name = "ActivityDetailsReadError";
  }
}
