import { describe, expect, it } from 'vitest';

import type { WorkspaceRole } from '@/server/authz/permissions';
import {
  productCapability,
  productDetailCapability,
  productListCapability,
} from '@/server/services/product/product.capability';
import type { TenantContext } from '@/server/tenancy/context';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';

function contextFor(role: WorkspaceRole): TenantContext {
  return {
    user: {
      id: 'user-1',
      email: 'ahmed@akmalfashion.example',
      name: 'Ahmed Raza',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      avatarUrl: null,
    },
    workspaceId: WORKSPACE_A,
    workspaceSlug: 'akmal-fashion',
    workspaceName: 'Akmal Fashion',
    role,
    membershipId: 'membership-1',
    sessionId: 'session-1',
    currency: 'PKR',
    planKey: 'business',
    onboarding: { completedSteps: [], completedAt: null },
    requestId: 'request-1',
  };
}

const ALL_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const;

/**
 * Instruction #100. What a role may do to the catalogue is a commercial question rather
 * than a clerical one: a price is what the business earns, and stock is the number the AI
 * quotes to customers. Both are worth being deliberate about, and both are easy to widen
 * by accident while editing the role table for some unrelated reason.
 */
describe('what each role may do to the catalogue', () => {
  it('lets an owner do everything', () => {
    expect(productDetailCapability(contextFor('OWNER'))).toEqual({
      update: true,
      delete: true,
      editStock: true,
      editVariants: true,
    });
    expect(productListCapability(contextFor('OWNER'))).toEqual({ create: true });
  });

  it('lets a manager run the catalogue, including stock and removal', () => {
    expect(productDetailCapability(contextFor('MANAGER'))).toEqual({
      update: true,
      delete: true,
      editStock: true,
      editVariants: true,
    });
    expect(productListCapability(contextFor('MANAGER'))).toEqual({ create: true });
  });

  /**
   * The row that matters, and the one that differs from customers. An agent may create a
   * *customer* — someone messages in and the agent records them — but may not add,
   * reprice or restock a *product*. An agent who could change a price could discount the
   * whole catalogue from a chat window, and one who could edit stock could tell a customer
   * a shirt is available because they typed that it was.
   */
  it('lets an agent read the catalogue but change nothing in it', () => {
    expect(productDetailCapability(contextFor('AGENT'))).toEqual({
      update: false,
      delete: false,
      editStock: false,
      editVariants: false,
    });
    expect(productListCapability(contextFor('AGENT'))).toEqual({ create: false });
  });

  it('gives a viewer nothing but the read they already had', () => {
    expect(productDetailCapability(contextFor('VIEWER'))).toEqual({
      update: false,
      delete: false,
      editStock: false,
      editVariants: false,
    });
    expect(productListCapability(contextFor('VIEWER'))).toEqual({ create: false });
  });
});

describe('the shape of the capability itself', () => {
  /**
   * `editVariants` is derived from `product:update`, and the two must not drift while that
   * is true. Adding a size is an edit to the product; a role that could add sizes without
   * being able to edit the product would be a typo in the role table rather than a
   * decision. If a later plan splits them, this is the test to change on purpose.
   */
  it('ties editing variants to editing the product for every role', () => {
    for (const role of ALL_ROLES) {
      const capability = productDetailCapability(contextFor(role));
      expect(capability.editVariants).toBe(capability.update);
    }
  });

  /**
   * Stock rides on `inventory:update`, which is a *separate* permission — counting shirts
   * is not repricing them. The two happen to move together in the current role table, and
   * this asserts the property that actually matters: nobody can edit stock who cannot
   * already read the catalogue, and no role gets stock editing without the catalogue write
   * that would let them create the product in the first place.
   */
  it('never grants stock editing to a role that cannot edit the product', () => {
    for (const role of ALL_ROLES) {
      const capability = productCapability(contextFor(role));
      if (capability.editStock) expect(capability.update).toBe(true);
    }
  });

  /** Removal is never granted more widely than editing. A role that could delete a
   *  product but not correct its price would be an odd permission set. */
  it('never grants removal to a role that cannot edit', () => {
    for (const role of ALL_ROLES) {
      const capability = productCapability(contextFor(role));
      if (capability.delete) expect(capability.update).toBe(true);
    }
  });

  /** Capability answers are a question, not an assertion: they must never throw. The
   *  pages call them while rendering, and a throw would turn a permission question into
   *  an error boundary on a page the person is allowed to see. */
  it('answers for every role without throwing', () => {
    for (const role of ALL_ROLES) {
      expect(() => productCapability(contextFor(role))).not.toThrow();
      expect(() => productListCapability(contextFor(role))).not.toThrow();
      expect(() => productDetailCapability(contextFor(role))).not.toThrow();
    }
  });
});
