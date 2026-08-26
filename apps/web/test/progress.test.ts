import { describe, expect, it } from "vitest";

import { createLatestRequestGate, dayRoute, isIanaTimezone, isLocalDate, trailingRange } from "../app/lib/progress";

describe("progress route contracts", () => {
  it("builds trailing inclusive presets", () => {
    expect(trailingRange("2026-08-18", 7)).toEqual({ from: "2026-08-12", to: "2026-08-18" });
    expect(trailingRange("2026-03-01", 30)).toEqual({ from: "2026-01-31", to: "2026-03-01" });
    expect(trailingRange("2026-08-18", 365)).toEqual({ from: "2025-08-19", to: "2026-08-18" });
  });

  it("accepts only real dates and IANA timezones", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("9999-99-99")).toBe(false);
    expect(isIanaTimezone("Europe/Moscow")).toBe(true);
    expect(isIanaTimezone("Mars/Olympus_Mons")).toBe(false);
  });

  it("encodes the dated drill-down query", () => {
    expect(dayRoute("2026-08-18", "Europe/Moscow")).toBe("/days/2026-08-18?timezone=Europe%2FMoscow");
  });

  it("allows only the newest request token to update state", () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});
