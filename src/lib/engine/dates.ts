/**
 * Date calculation engine.
 *
 * All engine-level dates are ISO calendar strings ("yyyy-mm-dd") so that
 * timezone handling can never shift a lock-in date. Conversion to/from JS
 * Date happens only at the database/UI boundary.
 */

export type PeriodUnit = "DAYS" | "MONTHS" | "YEARS";

export interface LockInRule {
  /** Which anchor date the period runs from. */
  startDateField: "listing_date" | "allotment_date" | "explicit";
  period: number;
  unit: PeriodUnit;
  /** The regulatory rule as stated in documentation, for the audit trail. */
  ruleText: string;
}

export interface CalculationResult {
  calculationMethod: string;
  calculationStartDate: string;
  lockInPeriod: string;
  calculatedExpiryDate: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(iso: string): [number, number, number] {
  if (!isValidIsoDate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Calendar-month addition. When the target month is shorter than the source
 * day-of-month, the result clamps to the last day of the target month
 * (31 Jan + 1 month = 28/29 Feb), matching standard corporate-date practice.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const totalMonths = y * 12 + (m - 1) + months;
  const ty = Math.floor(totalMonths / 12);
  const tm = (totalMonths % 12) + 1;
  const td = Math.min(d, daysInMonth(ty, tm));
  return fmt(ty, tm, td);
}

export function addYears(iso: string, years: number): string {
  return addMonths(iso, years * 12);
}

export function addPeriod(iso: string, period: number, unit: PeriodUnit): string {
  switch (unit) {
    case "DAYS":
      return addDays(iso, period);
    case "MONTHS":
      return addMonths(iso, period);
    case "YEARS":
      return addYears(iso, period);
  }
}

/**
 * Compute a lock-in expiry with a full audit record. The rule is data, not
 * code: different categories carry different rules and new rules can be
 * configured without touching the engine.
 */
export function calculateExpiry(startDate: string, rule: LockInRule): CalculationResult {
  const expiry = addPeriod(startDate, rule.period, rule.unit);
  return {
    calculationMethod: `${rule.startDateField} + ${rule.period} ${rule.unit.toLowerCase()}`,
    calculationStartDate: startDate,
    lockInPeriod: `${rule.period} ${rule.unit.toLowerCase()}`,
    calculatedExpiryDate: expiry,
  };
}

/** Days from `from` (defaults to today, UTC calendar) until `to`. Negative = past. */
export function daysUntil(to: string, from?: string): number {
  const [ty, tm, td] = parts(to);
  let fy: number, fm: number, fd: number;
  if (from) {
    [fy, fm, fd] = parts(from);
  } else {
    const now = new Date();
    [fy, fm, fd] = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
  }
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000);
}

export function todayIso(): string {
  const now = new Date();
  return fmt(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

/**
 * Default SEBI ICDR lock-in rules (post November 2021 amendments), keyed by
 * lock-in category. These are DEFAULTS used when a prospectus states the
 * standard rule; the actual rule captured from the document always wins.
 * Stored in app_config so they are configurable without a deploy.
 */
export const DEFAULT_LOCK_IN_RULES: Record<string, LockInRule> = {
  ANCHOR_50PCT: {
    startDateField: "allotment_date",
    period: 30,
    unit: "DAYS",
    ruleText:
      "50% of anchor investor allocation locked in for 30 days from the date of allotment (SEBI ICDR, as amended Nov 2021).",
  },
  ANCHOR_REMAINING: {
    startDateField: "allotment_date",
    period: 90,
    unit: "DAYS",
    ruleText:
      "Remaining 50% of anchor investor allocation locked in for 90 days from the date of allotment (SEBI ICDR, as amended Nov 2021).",
  },
  PROMOTER_MINIMUM_CONTRIBUTION: {
    startDateField: "allotment_date",
    period: 18,
    unit: "MONTHS",
    ruleText:
      "Promoter minimum contribution (20% of post-issue capital) locked in for 18 months from allotment (SEBI ICDR, as amended Nov 2021).",
  },
  PROMOTER_EXCESS: {
    startDateField: "allotment_date",
    period: 6,
    unit: "MONTHS",
    ruleText:
      "Promoter holding in excess of minimum contribution locked in for 6 months from allotment (SEBI ICDR, as amended Nov 2021).",
  },
  PRE_IPO_SHAREHOLDER: {
    startDateField: "allotment_date",
    period: 6,
    unit: "MONTHS",
    ruleText:
      "Entire pre-issue capital held by persons other than promoters locked in for 6 months from allotment (SEBI ICDR, as amended Nov 2021).",
  },
};
