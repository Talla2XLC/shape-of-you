/** Safe provider failure classes persisted in the connection projection. */
export type IntegrationFailureCode =
  | "authorization_required"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_response_invalid";

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
  readonly totalSleepMinutes: number | null;
  readonly sleepScore: number | null;
  readonly restingHeartRate: number | null;
  readonly hrvRmssd: number | null;
  readonly bodyBattery: number | null;
}

/** Narrow provider-neutral activity summary; detailed routes/FIT remain excluded. */
export interface ProviderActivityRecord {
  readonly identity: string;
  readonly occurredAt: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly name: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly trainingLoad: number | null;
  readonly averageHeartRate: number | null;
  readonly maximumHeartRate: number | null;
  readonly deviceName: string | null;
  readonly garminAttributed: boolean;
}

/** One bounded reconciliation response from an external health provider. */
export interface ProviderReconciliation {
  readonly wellness: readonly ProviderWellnessRecord[];
  readonly activities: readonly ProviderActivityRecord[];
}

/** Replaceable in-process transport boundary for one external provider. */
export interface HealthDataProvider {
  authorizationUrl(state: string): string;
  exchangeAuthorizationCode(code: string): Promise<ProviderAuthorization>;
  reconcile(accessToken: string, fromLocalDate: string, toLocalDate: string): Promise<ProviderReconciliation>;
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
