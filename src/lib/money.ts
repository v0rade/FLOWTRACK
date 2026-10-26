/**
 * Decimal-safe money helpers.
 *
 * Amounts are handled as integer minor units (cents) using BigInt, and parsed
 * from / formatted to decimal strings without ever passing through binary
 * floating point arithmetic. The authoritative total of a purchase request is
 * still calculated by PostgreSQL (NUMERIC generated column); these helpers are
 * used for previews, CSV validation and KPI aggregation.
 */

const MONEY_PATTERN = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/** Parse a decimal string such as "1250000.5" into cents (125000050n). */
export function parseMoneyToCents(input: string | number): bigint {
  const raw = typeof input === "number" ? numberToPlainString(input) : input;
  const value = raw.trim().replace(/,/g, "");
  const match = MONEY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid monetary amount: "${raw}"`);
  }
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  return whole * 100n + fraction;
}

/** Same as parseMoneyToCents but returns null instead of throwing. */
export function tryParseMoneyToCents(input: string | number | null | undefined): bigint | null {
  if (input === null || input === undefined || input === "") return null;
  try {
    return parseMoneyToCents(input);
  } catch {
    return null;
  }
}

export function isValidMoney(input: string): boolean {
  return MONEY_PATTERN.test(input.trim().replace(/,/g, ""));
}

/** quantity × unit price, exact. */
export function lineTotalCents(quantity: number, unitPriceCents: bigint): bigint {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("Quantity must be a non-negative integer");
  }
  return BigInt(quantity) * unitPriceCents;
}

export function sumCents(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Convert cents to a plain decimal string, e.g. 125000050n → "1250000.50". */
export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Format cents for display using Intl (display only — never used for maths). */
export function formatCents(cents: bigint, currency = "IDR", options: { compact?: boolean } = {}): string {
  const decimal = centsToDecimalString(cents);
  const hasFraction = !decimal.endsWith(".00");
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: options.compact ? "compact" : "standard",
    minimumFractionDigits: options.compact ? 0 : hasFraction ? 2 : 0,
    maximumFractionDigits: options.compact ? 1 : 2,
  });
  // Intl accepts decimal strings, avoiding float conversion for large values.
  return formatter.format(decimal as unknown as number);
}

export function formatMoney(value: string | number | null | undefined, currency = "IDR", compact = false): string {
  const cents = tryParseMoneyToCents(value ?? null) ?? 0n;
  return formatCents(cents, currency, { compact });
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error("Amount must be finite");
  // toFixed(2) is safe for values within NUMERIC(18,2) display range.
  return n.toFixed(2);
}
