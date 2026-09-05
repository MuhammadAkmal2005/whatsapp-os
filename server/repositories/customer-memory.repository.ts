import 'server-only';

import type { Db } from '@/db/prisma';
import type {
  MemoryCategory,
  MemorySource,
} from '@/server/validation/customer-memory';

export type CustomerMemoryRow = {
  id: string;
  workspaceId: string;
  contactId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const CUSTOMER_MEMORY_SELECT = {
  id: true,
  workspaceId: true,
  contactId: true,
  category: true,
  key: true,
  value: true,
  source: true,
  confidence: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ListCustomerMemoriesOptions = {
  category?: MemoryCategory;
  limit?: number;
};

/**
 * Lists memories for a contact in a workspace.
 * Bounded, ordered by most recently updated first.
 */
export async function listCustomerMemories(
  db: Db,
  workspaceId: string,
  contactId: string,
  options: ListCustomerMemoriesOptions = {},
): Promise<CustomerMemoryRow[]> {
  const limit = Math.min(options.limit ?? 10, 20);

  const whereClause: {
    workspaceId: string;
    contactId: string;
    category?: MemoryCategory;
  } = {
    workspaceId,
    contactId,
  };

  if (options.category) {
    whereClause.category = options.category;
  }

  const rows = await db.customerMemory.findMany({
    where: whereClause,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: CUSTOMER_MEMORY_SELECT,
  });

  return rows as CustomerMemoryRow[];
}

/**
 * Finds a specific memory by its unique key for a contact.
 */
export async function findCustomerMemoryByKey(
  db: Db,
  workspaceId: string,
  contactId: string,
  key: string,
): Promise<CustomerMemoryRow | null> {
  const row = await db.customerMemory.findUnique({
    where: {
      workspaceId_contactId_key: {
        workspaceId,
        contactId,
        key,
      },
    },
    select: CUSTOMER_MEMORY_SELECT,
  });

  return (row as CustomerMemoryRow) ?? null;
}

/**
 * Finds a memory by its ID, scoped strictly to workspace.
 */
export async function findCustomerMemoryById(
  db: Db,
  workspaceId: string,
  memoryId: string,
): Promise<CustomerMemoryRow | null> {
  const row = await db.customerMemory.findFirst({
    where: {
      id: memoryId,
      workspaceId,
    },
    select: CUSTOMER_MEMORY_SELECT,
  });

  return (row as CustomerMemoryRow) ?? null;
}

export type UpsertCustomerMemoryData = {
  workspaceId: string;
  contactId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  source: MemorySource;
  confidence?: number;
};

/**
 * Upserts a customer memory fact atomically.
 * Prevents race conditions and duplicates by merging on (workspaceId, contactId, key).
 */
export async function upsertCustomerMemory(
  db: Db,
  data: UpsertCustomerMemoryData,
): Promise<CustomerMemoryRow> {
  const confidence = data.confidence ?? 1.0;

  const row = await db.customerMemory.upsert({
    where: {
      workspaceId_contactId_key: {
        workspaceId: data.workspaceId,
        contactId: data.contactId,
        key: data.key,
      },
    },
    update: {
      value: data.value,
      category: data.category,
      source: data.source,
      confidence,
      updatedAt: new Date(),
    },
    create: {
      workspaceId: data.workspaceId,
      contactId: data.contactId,
      category: data.category,
      key: data.key,
      value: data.value,
      source: data.source,
      confidence,
    },
    select: CUSTOMER_MEMORY_SELECT,
  });

  return row as CustomerMemoryRow;
}

/**
 * Deletes a single memory record, scoped strictly to workspace.
 */
export async function deleteCustomerMemory(
  db: Db,
  workspaceId: string,
  memoryId: string,
): Promise<boolean> {
  const result = await db.customerMemory.deleteMany({
    where: {
      id: memoryId,
      workspaceId,
    },
  });

  return result.count > 0;
}

/**
 * Clears all memories for a contact in a workspace.
 */
export async function clearCustomerMemories(
  db: Db,
  workspaceId: string,
  contactId: string,
): Promise<number> {
  const result = await db.customerMemory.deleteMany({
    where: {
      workspaceId,
      contactId,
    },
  });

  return result.count;
}

/**
 * Updates `lastUsedAt` timestamp for memories injected into an AI turn.
 */
export async function touchCustomerMemories(
  db: Db,
  workspaceId: string,
  memoryIds: string[],
): Promise<void> {
  if (memoryIds.length === 0) return;

  await db.customerMemory.updateMany({
    where: {
      id: { in: memoryIds },
      workspaceId,
    },
    data: {
      lastUsedAt: new Date(),
    },
  });
}
