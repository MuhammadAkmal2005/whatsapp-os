import { describe, expect, it } from 'vitest';

import {
  formatMessageTime,
  formatRelativeTime,
  formatThreadDividerDate,
  initials,
} from '@/components/inbox/conversation-badges';

describe('Inbox time and string formatters', () => {
  describe('initials', () => {
    it('generates initials for single and multi-word names', () => {
      expect(initials('Ahmed')).toBe('AH');
      expect(initials('Ahmed Raza')).toBe('AR');
      expect(initials('Muhammad Bilal Khan')).toBe('MK');
      expect(initials('')).toBe('??');
      expect(initials(null)).toBe('??');
      expect(initials(undefined)).toBe('??');
      expect(initials('   Fatima   Sheikh  ')).toBe('FS');
    });
  });

  describe('formatRelativeTime', () => {
    it('returns empty string for null or invalid inputs', () => {
      expect(formatRelativeTime(null)).toBe('');
      expect(formatRelativeTime('invalid-date')).toBe('');
    });

    it('formats recent times into human-friendly relative units', () => {
      const now = new Date();

      const tenSecondsAgo = new Date(now.getTime() - 10 * 1000);
      expect(formatRelativeTime(tenSecondsAgo)).toBe('Just now');

      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m');

      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      expect(formatRelativeTime(threeHoursAgo)).toBe('3h');
    });
  });

  describe('formatThreadDividerDate', () => {
    it('formats today, yesterday and past dates', () => {
      const today = new Date();
      expect(formatThreadDividerDate(today)).toBe('Today');

      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      expect(formatThreadDividerDate(yesterday)).toBe('Yesterday');
    });
  });

  describe('formatMessageTime', () => {
    it('formats time to 2-digit hour and minute', () => {
      const date = new Date('2026-08-28T14:30:00.000Z');
      const formatted = formatMessageTime(date);
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});
