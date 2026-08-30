import { DomainValidationError } from "./errors.js";

/** Validates an explicit ISO calendar date without converting it through UTC. */
export function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainValidationError("localDate must be an ISO calendar date");
  }
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) {
    throw new DomainValidationError("localDate must be a valid calendar date");
  }
  const candidate = new Date(Date.UTC(year!, month! - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month! - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new DomainValidationError("localDate must be a valid calendar date");
  }
}

/** Validates an IANA timezone supported by the running JavaScript runtime. */
export function assertIanaTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new DomainValidationError("timezone must be a valid IANA timezone");
  }
}
