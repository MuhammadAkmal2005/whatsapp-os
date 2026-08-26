/**
 * Phone number normalisation.
 *
 * Contacts are keyed on `(workspaceId, phoneE164)`, so normalisation is what
 * stops one human becoming three contacts. Pakistani customers write their
 * number every way imaginable — `0300 1234567`, `+92 300 1234567`,
 * `92-300-1234567`, `03001234567` — and all of those are the same person.
 *
 * This is deliberately not a full libphonenumber replacement. It handles E.164
 * validation generically and applies national-prefix rules for the countries we
 * actually serve. Adding a country means adding one entry, and an unrecognised
 * input fails cleanly rather than being silently mangled into a wrong number.
 *
 * Dependency-free, so it is unit-tested directly.
 */

export type CountryRule = {
  iso2: string;
  callingCode: string;
  /** Leading digit(s) stripped when a number is written in national format. */
  nationalPrefix: string;
  /** Length of the subscriber number after the calling code. */
  nationalNumberLengths: readonly number[];
};

/**
 * Only the markets in scope. Pakistan is first because it is the initial market
 * and the overwhelming majority of numbers will be +92.
 */
export const COUNTRY_RULES: readonly CountryRule[] = [
  { iso2: 'PK', callingCode: '92', nationalPrefix: '0', nationalNumberLengths: [10] },
  { iso2: 'AE', callingCode: '971', nationalPrefix: '0', nationalNumberLengths: [9] },
  { iso2: 'GB', callingCode: '44', nationalPrefix: '0', nationalNumberLengths: [10] },
  { iso2: 'US', callingCode: '1', nationalPrefix: '1', nationalNumberLengths: [10] },
  { iso2: 'IN', callingCode: '91', nationalPrefix: '0', nationalNumberLengths: [10] },
  { iso2: 'SA', callingCode: '966', nationalPrefix: '0', nationalNumberLengths: [9] },
];

const DEFAULT_COUNTRY = 'PK';

/** Longest calling code first, so `971` is tried before `9` could ever match. */
const RULES_BY_CODE_LENGTH = [...COUNTRY_RULES].sort(
  (a, b) => b.callingCode.length - a.callingCode.length,
);

export type NormalisedPhone = {
  /** `+` followed by digits only. This is what goes in the database. */
  e164: string;
  /** Digits only, no `+`. WhatsApp's API wants this form. */
  waId: string;
  countryIso2: string | null;
  /** Grouped for display, e.g. `+92 300 1234567`. */
  formatted: string;
};

function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Normalises to E.164, or returns null when the input cannot be interpreted
 * confidently. Null is the right answer for "I am not sure": guessing produces a
 * contact record that can never receive a message and can never be merged.
 *
 * `defaultCountry` is the workspace's country, used only when the input carries
 * no international prefix of its own.
 */
export function normalisePhone(
  input: string,
  defaultCountry: string = DEFAULT_COUNTRY,
): NormalisedPhone | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  // `00` is the international access prefix in most of the world.
  const hadPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  const bare = digitsOnly(trimmed.startsWith('00') ? trimmed.slice(2) : trimmed);

  if (bare.length < 6 || bare.length > 15) return null; // E.164 hard bounds

  if (hadPlus) return buildFromInternational(bare);

  const rule = COUNTRY_RULES.find((entry) => entry.iso2 === defaultCountry);

  // No rule for the workspace's country: only accept input that already looks
  // like a full international number rather than inventing a prefix.
  if (!rule) return buildFromInternational(bare);

  // National format with the trunk prefix, e.g. 0300 1234567 in Pakistan.
  if (rule.nationalPrefix !== '' && bare.startsWith(rule.nationalPrefix)) {
    const national = bare.slice(rule.nationalPrefix.length);
    if (rule.nationalNumberLengths.includes(national.length)) {
      return build(rule.callingCode, national, rule.iso2);
    }
  }

  // Already carries its own calling code but was written without a `+`.
  if (bare.startsWith(rule.callingCode)) {
    const national = bare.slice(rule.callingCode.length);
    if (rule.nationalNumberLengths.includes(national.length)) {
      return build(rule.callingCode, national, rule.iso2);
    }
  }

  // Bare subscriber number, e.g. 3001234567.
  if (rule.nationalNumberLengths.includes(bare.length)) {
    return build(rule.callingCode, bare, rule.iso2);
  }

  return buildFromInternational(bare);
}

function buildFromInternational(bare: string): NormalisedPhone | null {
  const rule = RULES_BY_CODE_LENGTH.find((entry) => bare.startsWith(entry.callingCode));

  if (rule) {
    let national = bare.slice(rule.callingCode.length);

    // Tolerate "+92 0300 …", a common copy-paste artefact where the trunk
    // prefix was kept alongside the country code.
    if (
      rule.nationalPrefix !== '' &&
      national.startsWith(rule.nationalPrefix) &&
      !rule.nationalNumberLengths.includes(national.length) &&
      rule.nationalNumberLengths.includes(national.length - rule.nationalPrefix.length)
    ) {
      national = national.slice(rule.nationalPrefix.length);
    }

    if (rule.nationalNumberLengths.includes(national.length)) {
      return build(rule.callingCode, national, rule.iso2);
    }
    // Right country, wrong length — keep it as E.164 but do not claim a country.
    return { e164: `+${bare}`, waId: bare, countryIso2: null, formatted: `+${bare}` };
  }

  // A country we have no rule for. Valid E.164 length, so accept it rather than
  // reject a legitimate customer, but do not pretend to know the country.
  return { e164: `+${bare}`, waId: bare, countryIso2: null, formatted: `+${bare}` };
}

function build(callingCode: string, national: string, iso2: string): NormalisedPhone {
  const e164 = `+${callingCode}${national}`;
  return {
    e164,
    waId: `${callingCode}${national}`,
    countryIso2: iso2,
    formatted: formatNational(callingCode, national),
  };
}

/**
 * Groups the subscriber number for readability. Mobile numbers in our markets
 * are conventionally read as a 3-digit operator code then the remainder, which
 * is how a Pakistani customer would say their own number out loud.
 */
function formatNational(callingCode: string, national: string): string {
  if (national.length >= 9) {
    return `+${callingCode} ${national.slice(0, 3)} ${national.slice(3)}`;
  }
  return `+${callingCode} ${national}`;
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

/**
 * Masks all but the last four digits, for logs and audit metadata. A phone
 * number is personal data and does not belong in a log line in full.
 */
export function maskPhone(e164: string): string {
  if (e164.length <= 5) return '•'.repeat(e164.length);
  const tail = e164.slice(-4);
  return `${e164.slice(0, 3)}${'•'.repeat(Math.max(0, e164.length - 7))}${tail}`;
}
