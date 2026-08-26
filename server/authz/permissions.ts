/**
 * The permission catalogue.
 *
 * Permissions are `resource:action` strings mapped to the roles that hold them.
 *
 * The obvious alternative — give each role a numeric rank and compare — is
 * rejected on purpose. Rank comparison cannot express the cases this product
 * actually has. Only OWNER may transfer ownership or cancel the subscription,
 * and "only the highest rank" is not the same as "rank ≥ N" once a second role
 * is added above it. ADMIN outranks MANAGER on settings while having no special
 * claim on an individual conversation. Encoding capability as a set makes those
 * facts declarative and testable; encoding it as a number makes them accidents
 * of ordering.
 *
 * Dependency-free, and the RBAC matrix is unit-tested exhaustively.
 */

export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  // Workspace and business
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer_ownership',
  'business_profile:read',
  'business_profile:update',

  // Team
  'member:read',
  'member:invite',
  'member:update_role',
  'member:remove',

  // Billing
  'subscription:read',
  'subscription:manage',
  'usage:read',

  // Channel
  'whatsapp:read',
  'whatsapp:connect',
  'whatsapp:disconnect',

  // Conversations
  'conversation:read',
  'conversation:read_all',
  'conversation:reply',
  'conversation:assign',
  'conversation:update_status',
  'conversation:toggle_ai',
  'conversation:delete',

  // Contacts
  'contact:read',
  'contact:create',
  'contact:update',
  'contact:delete',
  'contact:export',

  // Catalogue
  'product:read',
  'product:create',
  'product:update',
  'product:delete',
  'inventory:read',
  'inventory:update',

  // Orders
  'order:read',
  'order:create',
  'order:update',
  'order:update_status',
  'order:cancel',
  'order:refund',
  'order:delete',

  // Payments
  'payment:read',
  'payment:verify',
  'payment:refund',

  // AI
  'agent:read',
  'agent:update',
  'agent:test',
  'knowledge:read',
  'knowledge:create',
  'knowledge:update',
  'knowledge:delete',

  // Automation and campaigns
  'automation:read',
  'automation:create',
  'automation:update',
  'automation:delete',
  'campaign:read',
  'campaign:create',
  'campaign:send',
  'template:read',
  'template:manage',

  // Appointments
  'appointment:read',
  'appointment:create',
  'appointment:update',
  'appointment:cancel',

  // Analytics and audit
  'analytics:read',
  'analytics:read_advanced',
  'audit_log:read',
  'audit_log:export',

  // Integrations
  'integration:read',
  'integration:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * VIEWER is the read-only floor. Every role above it is defined by adding to the
 * one below, except where a capability is deliberately withheld — which is
 * exactly the situation a rank comparison could not represent.
 */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'business_profile:read',
  'member:read',
  'whatsapp:read',
  'conversation:read',
  'conversation:read_all',
  'contact:read',
  'product:read',
  'inventory:read',
  'order:read',
  'payment:read',
  'agent:read',
  'knowledge:read',
  'automation:read',
  'campaign:read',
  'template:read',
  'appointment:read',
  'analytics:read',
];

/**
 * AGENT works conversations. Note what is absent: no `conversation:read_all`,
 * because an agent sees their own assignments plus unassigned threads, not the
 * whole inbox. That scoping is applied in the conversation repository, and the
 * missing permission is what tells it to apply it.
 */
const AGENT_PERMISSIONS: readonly Permission[] = [
  'workspace:read',
  'business_profile:read',
  'member:read',
  'whatsapp:read',
  'conversation:read',
  'conversation:reply',
  'conversation:update_status',
  'conversation:toggle_ai',
  'contact:read',
  'contact:create',
  'contact:update',
  'product:read',
  'inventory:read',
  'order:read',
  'order:create',
  'payment:read',
  'agent:read',
  'knowledge:read',
  'appointment:read',
  'appointment:create',
  'appointment:update',
];

/** MANAGER runs the operation: the full inbox, the catalogue, orders, the agent
 *  and the knowledge base. Not the team, the plan, or the channel connection. */
const MANAGER_PERMISSIONS: readonly Permission[] = [
  ...AGENT_PERMISSIONS,
  'conversation:read_all',
  'conversation:assign',
  'contact:delete',
  'contact:export',
  'product:create',
  'product:update',
  'product:delete',
  'inventory:update',
  'order:update',
  'order:update_status',
  'order:cancel',
  'payment:verify',
  'agent:update',
  'agent:test',
  'knowledge:create',
  'knowledge:update',
  'knowledge:delete',
  'automation:read',
  'automation:create',
  'automation:update',
  'campaign:read',
  'campaign:create',
  'template:read',
  'analytics:read',
  'appointment:cancel',
];

/** ADMIN adds business administration: team, settings, channel, integrations,
 *  refunds and the audit log. Still not billing — that stays with the owner. */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MANAGER_PERMISSIONS,
  'workspace:update',
  'business_profile:update',
  'member:invite',
  'member:update_role',
  'member:remove',
  'subscription:read',
  'usage:read',
  'whatsapp:connect',
  'whatsapp:disconnect',
  'conversation:delete',
  'order:refund',
  'payment:refund',
  'automation:delete',
  'campaign:send',
  'template:manage',
  'analytics:read_advanced',
  'audit_log:read',
  'integration:read',
  'integration:manage',
];

/**
 * OWNER holds everything, including the three capabilities no other role has:
 * deleting the workspace, transferring ownership, and managing the subscription.
 * Spelled out rather than derived, so adding a permission to the catalogue
 * without deciding who holds it fails the exhaustiveness test.
 */
const OWNER_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  'workspace:delete',
  'workspace:transfer_ownership',
  'subscription:manage',
  'order:delete',
  'audit_log:export',
];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  AGENT: new Set(AGENT_PERMISSIONS),
  VIEWER: new Set(VIEWER_PERMISSIONS),
};

/**
 * Whether `role` holds `permission`.
 *
 * Fails closed on a role that is not in the table. TypeScript says that cannot
 * happen, but the value originates in a database column, and a role added to the
 * Prisma enum before this table is updated would otherwise throw from inside an
 * authorization check — turning a clean denial into a 500 on every request that
 * user makes. Denying is both safer and more debuggable.
 */
export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function roleHasAllPermissions(
  role: WorkspaceRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => roleHasPermission(role, permission));
}

export function roleHasAnyPermission(
  role: WorkspaceRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => roleHasPermission(role, permission));
}

/** Empty for an unrecognised role, for the same reason `roleHasPermission` denies. */
export function permissionsForRole(role: WorkspaceRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}

// ── Role management rules ──────────────────────────────────────────────────

/**
 * Display order, most privileged first. Used for sorting a member list and for
 * the rule below — not for deciding capability.
 */
export const ROLE_DISPLAY_ORDER: readonly WorkspaceRole[] = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'AGENT',
  'VIEWER',
];

/**
 * Roles that can be handed out by invitation or by a role edit.
 *
 * OWNER is absent by design: ownership moves through `workspace:transfer_ownership`,
 * a distinct and separately audited operation, so there is exactly one code path
 * that can change who owns a business.
 *
 * Lives here rather than beside the Zod schemas that also use it, so the pure
 * domain rules can enumerate candidate roles without importing a validation
 * library — and so the list the schema accepts and the list the rules consider are
 * provably the same array.
 */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = WORKSPACE_ROLES.filter(
  (role): role is AssignableRole => role !== 'OWNER',
);

/** Any role except OWNER. Named so callers can type a variable as "a role that may
 *  legitimately be handed out" and have the compiler hold them to it. */
export type AssignableRole = Exclude<WorkspaceRole, 'OWNER'>;

/**
 * Whether `actor` strictly outranks `target` in the display order.
 *
 * The primitive behind "you cannot act on a peer or a superior". Extracted because
 * three separate rules need it and a fourth one that computed the ranks itself was
 * the source of a real bypass: an ADMIN could not *remove* a peer ADMIN, but could
 * demote them to MANAGER and then remove them, because the role edit only checked
 * the destination role and not the one the target already held.
 *
 * Note this says nothing about permissions — a VIEWER outranks nobody useful, but a
 * MANAGER outranks an AGENT while holding no member permissions at all. Rank is one
 * half of a decision; the permission check is the other.
 */
export function outranks(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  const actorRank = ROLE_DISPLAY_ORDER.indexOf(actor);
  const targetRank = ROLE_DISPLAY_ORDER.indexOf(target);
  if (actorRank === -1 || targetRank === -1) return false;
  return targetRank > actorRank;
}

/**
 * Whether `actor` may assign `target` to someone.
 *
 * The rule is: you cannot grant a role at or above your own. Without it, an
 * ADMIN holding `member:update_role` could promote themselves to OWNER and take
 * the workspace — a privilege-escalation path that the permission check alone
 * does not close, because the permission legitimately exists for managing
 * everyone below them.
 *
 * OWNER is excluded entirely: ownership moves through
 * `workspace:transfer_ownership`, which is a distinct, audited operation rather
 * than a role edit.
 */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (target === 'OWNER') return false;
  if (!roleHasPermission(actor, 'member:update_role')) return false;
  return outranks(actor, target);
}

/**
 * Whether `actor` may remove a member holding `target`.
 *
 * An OWNER can never be removed by anyone; the last owner would otherwise be
 * able to be locked out of their own business by an admin they hired.
 */
export function canRemoveMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (target === 'OWNER') return false;
  if (!roleHasPermission(actor, 'member:remove')) return false;
  return outranks(actor, target);
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  VIEWER: 'Viewer',
};

/** Written for a business owner choosing who to invite, not for an engineer. */
export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: 'Full access, including billing and deleting the business.',
  ADMIN: 'Manages the business, team, settings and WhatsApp connection.',
  MANAGER: 'Runs day-to-day work: all chats, products, orders and the AI.',
  AGENT: 'Handles their own chats and can create orders and customers.',
  VIEWER: 'Can see everything but cannot make changes.',
};
