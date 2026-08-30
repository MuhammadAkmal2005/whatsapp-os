/**
 * RFC 4180 CSV Serializer.
 *
 * Encodes tabular rows into standard comma-separated values, escaping special characters
 * (commas, quotes, newlines) safely.
 */

export function serializeCsvRow(
  fields: readonly (string | number | boolean | null | undefined)[],
): string {
  return fields
    .map((field) => {
      if (field === null || field === undefined) return '';
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(',');
}

export function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  const headerLine = serializeCsvRow(headers);
  const dataLines = rows.map((row) => serializeCsvRow(row));
  return [headerLine, ...dataLines].join('\r\n');
}
