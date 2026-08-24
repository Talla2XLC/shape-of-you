import type { ImportSourceReader } from "./contracts.js";
import {
  FitnessTrackerSheetsReader,
  type FitnessTrackerWeightSnapshot
} from "./fitness-tracker-sheets-reader.js";
import { PrivateFitnessTrackerSnapshotReader } from "./private-fitness-tracker-snapshot.js";

/** Selects exactly one source path without reading Google credentials for files. */
export function createFitnessTrackerSource(
  snapshotFile: string | undefined,
  environment: NodeJS.ProcessEnv
): ImportSourceReader<FitnessTrackerWeightSnapshot> {
  const normalizedSnapshotFile = snapshotFile?.trim();
  if (normalizedSnapshotFile) {
    if (
      environment.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL ||
      environment.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY
    ) {
      throw new Error(
        "--snapshot-file cannot be combined with Google service identity values"
      );
    }
    return new PrivateFitnessTrackerSnapshotReader(normalizedSnapshotFile);
  }
  return new FitnessTrackerSheetsReader({
    clientEmail: required(
      environment.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
      "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL"
    ),
    privateKey: required(
      environment.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY,
      "GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY"
    )
  });
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required runtime value ${name}`);
  return normalized;
}
