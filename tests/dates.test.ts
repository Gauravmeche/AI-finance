import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addYears,
  calculateExpiry,
  daysUntil,
  isValidIsoDate,
} from "../src/lib/engine/dates";

describe("date calculation engine", () => {
  it("adds 30-day periods", () => {
    expect(addDays("2026-06-10", 30)).toBe("2026-07-10");
  });

  it("adds 90-day periods (spec example: 10 Jun 2026 + 90 = 8 Sep 2026)", () => {
    expect(addDays("2026-06-10", 90)).toBe("2026-09-08");
  });

  it("handles month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
  });

  it("handles year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-12-01", 90)).toBe("2027-03-01");
  });

  it("handles leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01"); // 2027 is not
    expect(addDays("2028-01-01", 60)).toBe("2028-03-01"); // crosses 29 Feb
  });

  it("adds calendar months with end-of-month clamping", () => {
    expect(addMonths("2026-01-15", 6)).toBe("2026-07-15");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30"); // clamp: Sep has 30 days
    expect(addMonths("2025-08-29", 6)).toBe("2026-02-28"); // clamp: Feb non-leap
    expect(addMonths("2027-08-29", 6)).toBe("2028-02-29"); // leap Feb keeps 29
  });

  it("adds 18-month promoter periods across year boundary", () => {
    expect(addMonths("2026-05-12", 18)).toBe("2027-11-12");
  });

  it("adds years", () => {
    expect(addYears("2026-06-10", 3)).toBe("2029-06-10");
  });

  it("produces a full audit record for calculations", () => {
    const result = calculateExpiry("2026-06-10", {
      startDateField: "listing_date",
      period: 90,
      unit: "DAYS",
      ruleText: "test",
    });
    expect(result.calculatedExpiryDate).toBe("2026-09-08");
    expect(result.calculationMethod).toBe("listing_date + 90 days");
    expect(result.calculationStartDate).toBe("2026-06-10");
    expect(result.lockInPeriod).toBe("90 days");
  });

  it("computes days remaining", () => {
    expect(daysUntil("2026-09-08", "2026-08-25")).toBe(14);
    expect(daysUntil("2026-08-25", "2026-08-25")).toBe(0);
    expect(daysUntil("2026-08-20", "2026-08-25")).toBe(-5); // expired
  });

  it("rejects invalid dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
    expect(() => addDays("2026-02-30", 1)).toThrow();
  });
});
