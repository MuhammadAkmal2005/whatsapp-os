import { describe, expect, it } from 'vitest';
import { evaluateTriggerMatch } from '@/server/services/automation/automation-engine.service';

describe('Automation Trigger Matching Unit Tests', () => {
  describe('MESSAGE_CONTAINS trigger', () => {
    it('matches ANY keyword case-insensitively by default', () => {
      const config = {
        keywords: ['price', 'cost', 'rate'],
        matchMode: 'ANY',
        caseSensitive: false,
      };

      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'What is the PRICE of this shirt?' })).toBe(true);
      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'tell me the rate please' })).toBe(true);
      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'where is your shop located?' })).toBe(false);
    });

    it('matches ALL keywords when matchMode is ALL', () => {
      const config = {
        keywords: ['black', 'kurta'],
        matchMode: 'ALL',
        caseSensitive: false,
      };

      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'Do you have black cotton kurta in XL?' })).toBe(true);
      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'I want a black shirt' })).toBe(false);
    });

    it('matches EXACT text when matchMode is EXACT', () => {
      const config = {
        keywords: ['STOP', 'UNSUBSCRIBE'],
        matchMode: 'EXACT',
        caseSensitive: false,
      };

      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'stop' })).toBe(true);
      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'please stop messaging me' })).toBe(false);
    });

    it('respects caseSensitive: true', () => {
      const config = {
        keywords: ['VIP'],
        matchMode: 'ANY',
        caseSensitive: true,
      };

      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'I am a VIP customer' })).toBe(true);
      expect(evaluateTriggerMatch('MESSAGE_CONTAINS', config, { body: 'I am a vip customer' })).toBe(false);
    });
  });

  describe('ORDER_STATUS_CHANGED trigger', () => {
    it('matches fromStatus and toStatus correctly', () => {
      const config = {
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
      };

      expect(evaluateTriggerMatch('ORDER_STATUS_CHANGED', config, { fromStatus: 'PENDING', toStatus: 'CONFIRMED' })).toBe(true);
      expect(evaluateTriggerMatch('ORDER_STATUS_CHANGED', config, { fromStatus: 'DRAFT', toStatus: 'CONFIRMED' })).toBe(false);
      expect(evaluateTriggerMatch('ORDER_STATUS_CHANGED', config, { fromStatus: 'PENDING', toStatus: 'CANCELLED' })).toBe(false);
    });

    it('matches wildcard fromStatus when only toStatus is specified', () => {
      const config = {
        toStatus: 'DELIVERED',
      };

      expect(evaluateTriggerMatch('ORDER_STATUS_CHANGED', config, { fromStatus: 'SHIPPED', toStatus: 'DELIVERED' })).toBe(true);
      expect(evaluateTriggerMatch('ORDER_STATUS_CHANGED', config, { fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'DELIVERED' })).toBe(true);
      expect(evaluateTriggerMatch('ORDER_STATUS_CHANGED', config, { fromStatus: 'SHIPPED', toStatus: 'RETURNED' })).toBe(false);
    });
  });

  describe('LOW_STOCK trigger', () => {
    it('matches when stock is less than or equal to threshold', () => {
      const config = { threshold: 5 };

      expect(evaluateTriggerMatch('LOW_STOCK', config, { available: 2 })).toBe(true);
      expect(evaluateTriggerMatch('LOW_STOCK', config, { available: 5 })).toBe(true);
      expect(evaluateTriggerMatch('LOW_STOCK', config, { available: 6 })).toBe(false);
    });
  });

  describe('CONVERSATION_IDLE trigger', () => {
    it('matches when idle duration exceeds threshold', () => {
      const config = { idleMinutes: 120 };

      expect(evaluateTriggerMatch('CONVERSATION_IDLE', config, { idleMinutes: 150 })).toBe(true);
      expect(evaluateTriggerMatch('CONVERSATION_IDLE', config, { idleMinutes: 60 })).toBe(false);
    });
  });

  describe('Default and empty config triggers', () => {
    it('returns true when config is null or empty', () => {
      expect(evaluateTriggerMatch('MESSAGE_RECEIVED', null, {})).toBe(true);
      expect(evaluateTriggerMatch('CONVERSATION_OPENED', undefined, {})).toBe(true);
      expect(evaluateTriggerMatch('HANDOFF_REQUESTED', {}, {})).toBe(true);
    });
  });
});
