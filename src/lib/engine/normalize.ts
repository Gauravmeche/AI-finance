/**
 * Entity normalization & duplicate detection.
 *
 * Different sources write the same company differently ("ABC Technologies
 * Ltd.", "ABC Tech Limited", "ABC Technologies"). Matching prefers strong
 * identifiers (ISIN > ticker+exchange > normalized name + listing date)
 * over the raw company name.
 */

const CORPORATE_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt. ltd.",
  "limited",
  "ltd.",
  "ltd",
  "plc",
  "inc",
  "corp",
];

export function normalizeCompanyName(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/[.,()&']/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  for (const suffix of CORPORATE_SUFFIXES) {
    if (n.endsWith(" " + suffix)) {
      n = n.slice(0, -suffix.length).trim();
    }
  }
  // Normalize common abbreviations so "tech" and "technologies" collide.
  n = n
    .replace(/\btechnologies\b/g, "tech")
    .replace(/\btechnology\b/g, "tech")
    .replace(/\bindustries\b/g, "ind")
    .replace(/\bindia\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return n;
}

export interface CompanyIdentity {
  name: string;
  isin?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  listingDate?: string | null;
}

export type MatchStrength = "isin" | "ticker" | "name_and_date" | "name" | "none";

/**
 * Decide whether two identities refer to the same company.
 * Strong identifiers win; name-only matches are reported as weak so callers
 * can require additional confirmation before merging records.
 */
export function matchCompanies(a: CompanyIdentity, b: CompanyIdentity): MatchStrength {
  if (a.isin && b.isin) {
    return a.isin.toUpperCase() === b.isin.toUpperCase() ? "isin" : "none";
  }
  if (a.ticker && b.ticker && a.ticker.toUpperCase() === b.ticker.toUpperCase()) {
    return "ticker";
  }
  const nameMatch = normalizeCompanyName(a.name) === normalizeCompanyName(b.name);
  if (!nameMatch) return "none";
  if (a.listingDate && b.listingDate) {
    return a.listingDate === b.listingDate ? "name_and_date" : "none";
  }
  return "name";
}

/** Parse Indian-format date strings ("15 May 2026", "15-May-26", "15/05/2026") to ISO. */
export function parseIndianDate(raw: string): string | null {
  const s = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;

  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  // "15 May 2026", "15-May-2026", "15 May, 2026"
  let m = /^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/,]+(\d{2,4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return buildIso(Number(m[3]), month, Number(m[1]));
  }

  // "May 15, 2026"
  m = /^([A-Za-z]{3,9})[\s\-/]+(\d{1,2})[\s,]+(\d{2,4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return buildIso(Number(m[3]), month, Number(m[2]));
  }

  // "15/05/2026" or "15-05-2026" (Indian convention: day first)
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    return buildIso(Number(m[3]), Number(m[2]), Number(m[1]));
  }

  return null;
}

function buildIso(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
