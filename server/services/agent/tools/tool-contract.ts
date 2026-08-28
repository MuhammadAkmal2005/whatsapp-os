/**
 * Tool Contract and Schema Definitions.
 *
 * Defines the contract for all AI tools (both READ and WRITE).
 * Tools represent server-controlled capabilities executed within an AITenantContext.
 */

import 'server-only';

import { z } from 'zod';
import type { AITenantContext } from '../context';

export type ToolClassification = 'READ' | 'WRITE';

export type ToolSideEffect = 'NONE' | 'MUTATION' | 'EXTERNAL_DISPATCH';

export type ToolIdempotencyStrategy =
  | 'SAFE_TO_RETRY'
  | 'REQUIRES_IDEMPOTENCY_KEY'
  | 'NEVER_RETRY_ON_UNKNOWN';

export type ToolRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AITool<TInput = Record<string, unknown>, TOutput = unknown> {
  /** Unique name identifier matching standard tool naming convention (e.g. 'search_products') */
  readonly name: string;
  /** Clear, human/model readable description explaining what the tool does and when to call it */
  readonly description: string;
  /** Zod schema validating untrusted arguments passed by the model */
  readonly inputSchema: z.ZodType<TInput>;
  /** Classification distinguishing safe reads from state-mutating writes */
  readonly classification: ToolClassification;
  /** Required capability string that must be present in AITenantContext.capabilities */
  readonly capabilityRequired: string;
  /** Side effect declaration */
  readonly sideEffect: ToolSideEffect;
  /** Retry & idempotency behavior */
  readonly idempotency: ToolIdempotencyStrategy;
  /** Risk rating */
  readonly riskLevel: ToolRiskLevel;
  /** Whether successful execution must write an AuditLog entry */
  readonly auditRequired: boolean;
  /** Execution logic scoped strictly to server-provided AITenantContext */
  handler(ctx: AITenantContext, input: TInput): Promise<TOutput>;
}
