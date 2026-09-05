import { z } from 'zod';

export const MEMORY_CATEGORIES = [
  'PREFERENCE',
  'PRODUCT_INTEREST',
  'CUSTOMER_CONTEXT',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_SOURCES = [
  'EXPLICIT_STATEMENT',
  'ORDER_BEHAVIOR',
  'MANUAL_STAFF',
] as const;

export type MemorySource = (typeof MEMORY_SOURCES)[number];

/**
 * List of sensitive key patterns that MUST NEVER be stored as customer memory.
 * Enforces privacy consciousness and prevents credential / PII leakage.
 */
export const PROHIBITED_MEMORY_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /pin\b/i,
  /cvv/i,
  /cvc/i,
  /card_number/i,
  /credit_card/i,
  /debit_card/i,
  /bank_account/i,
  /account_number/i,
  /otp/i,
  /auth_code/i,
  /ssn/i,
  /cnic/i,
];

/**
 * Checks if a candidate memory key is prohibited.
 */
export function isProhibitedMemoryKey(key: string): boolean {
  return PROHIBITED_MEMORY_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES);
export const memorySourceSchema = z.enum(MEMORY_SOURCES);

export const memoryKeySchema = z
  .string()
  .trim()
  .min(1, 'Memory key must not be empty')
  .max(64, 'Memory key must be 64 characters or fewer')
  .regex(
    /^[a-z0-9_:-]+$/i,
    'Memory key may only contain alphanumeric characters, underscores, colons, and hyphens',
  )
  .refine(
    (k) => !isProhibitedMemoryKey(k),
    'Sensitive keywords (passwords, payment credentials, secrets) are prohibited from customer memory',
  );

export const memoryValueSchema = z
  .string()
  .trim()
  .min(1, 'Memory value must not be empty')
  .max(500, 'Memory value must be 500 characters or fewer');

export const createCustomerMemorySchema = z.object({
  contactId: z.string().uuid('Valid contact ID is required'),
  category: memoryCategorySchema.default('PREFERENCE'),
  key: memoryKeySchema,
  value: memoryValueSchema,
  source: memorySourceSchema.default('EXPLICIT_STATEMENT'),
  confidence: z.number().min(0).max(1).default(1.0),
});

export type CreateCustomerMemoryInput = z.infer<typeof createCustomerMemorySchema>;

export const updateCustomerMemorySchema = z.object({
  value: memoryValueSchema,
  category: memoryCategorySchema.optional(),
  source: memorySourceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type UpdateCustomerMemoryInput = z.infer<typeof updateCustomerMemorySchema>;

export const customerMemoryQuerySchema = z.object({
  contactId: z.string().uuid(),
  category: memoryCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type CustomerMemoryQueryInput = z.infer<typeof customerMemoryQuerySchema>;
