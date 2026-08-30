import { describe, expect, it } from 'vitest';
import { serializeCsv, serializeCsvRow } from '@/lib/csv';

describe('CSV Serializer Unit Tests', () => {
  it('serializes simple strings, numbers, and booleans', () => {
    const row = serializeCsvRow(['2026-08-30', 12500, true]);
    expect(row).toBe('2026-08-30,12500,true');
  });

  it('escapes fields containing commas', () => {
    const row = serializeCsvRow(['Kurta, Black', 4500]);
    expect(row).toBe('"Kurta, Black",4500');
  });

  it('escapes fields containing double quotes by doubling them', () => {
    const row = serializeCsvRow(['Size "XL"', 3000]);
    expect(row).toBe('"Size ""XL""",3000');
  });

  it('escapes fields containing newlines', () => {
    const row = serializeCsvRow(['Line 1\nLine 2', 100]);
    expect(row).toBe('"Line 1\nLine 2",100');
  });

  it('handles null and undefined values safely as empty strings', () => {
    const row = serializeCsvRow(['Active', null, undefined, 50]);
    expect(row).toBe('Active,,,50');
  });

  it('serializes complete tables with headers and rows into CRLF lines', () => {
    const headers = ['Model', 'Turns', 'Cost (Micros)'];
    const rows = [
      ['gemini-2.5-flash', 10, 450],
      ['gemini-2.5-pro', 2, 1200],
    ];
    const csv = serializeCsv(headers, rows);
    expect(csv).toBe(
      'Model,Turns,Cost (Micros)\r\ngemini-2.5-flash,10,450\r\ngemini-2.5-pro,2,1200',
    );
  });
});
