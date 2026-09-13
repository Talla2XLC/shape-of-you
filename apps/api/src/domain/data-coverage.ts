/** One completed Person-local date with recorded and optionally usable evidence. */
export interface DataCoverageEvidenceDay {
  readonly localDate: string;
  readonly usable: boolean;
}

/** Lean current-fact summary owned by one domain module. */
export interface DataCoverageEvidence {
  readonly firstDataDate: string | null;
  readonly lastDataDate: string | null;
  readonly days: readonly DataCoverageEvidenceDay[];
}

/** Recovery coverage summaries split by provider-neutral metric semantics. */
export interface RecoveryDataCoverageEvidence {
  readonly sleep: DataCoverageEvidence;
  readonly hrv: DataCoverageEvidence;
  readonly restingHeartRate: DataCoverageEvidence;
  readonly bodyBattery: DataCoverageEvidence;
}
