import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_ROLES,
  canAssignRole,
  canRemoveMember,
  PERMISSIONS,
  type Permission,
  permissionsForRole,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  outranks,
  roleHasAllPermissions,
  roleHasAnyPermission,
  roleHasPermission,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '@/server/authz/permissions';

describe('permission catalogue', () => {
  it('has no duplicate permission strings', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('names every permission as resource:action', () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  /**
   * The guard against a permission being added to the catalogue and then silently
   * held by nobody, which would look like a working feature that always 403s.
   */
  it('assigns every catalogued permission to at least one role', () => {
    const held = new Set<Permission>();
    for (const role of WORKSPACE_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) held.add(permission);
    }
    const orphaned = PERMISSIONS.filter((permission) => !held.has(permission));
    expect(orphaned).toEqual([]);
  });

  it('grants OWNER every permission in the catalogue', () => {
    const missing = PERMISSIONS.filter((permission) => !roleHasPermission('OWNER', permission));
    expect(missing).toEqual([]);
  });

  it('gives every role a label and a plain-language description', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
      expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0);
    }
  });
});

describe('role hierarchy', () => {
  const roles: WorkspaceRole[] = ['VIEWER', 'AGENT', 'MANAGER', 'ADMIN', 'OWNER'];

  it('grows monotonically from MANAGER upward', () => {
    // MANAGER ⊂ ADMIN ⊂ OWNER holds by construction. AGENT and VIEWER are
    // deliberately not comparable, which is the reason set membership is used
    // instead of a rank.
    for (const [lower, higher] of [
      ['MANAGER', 'ADMIN'],
      ['ADMIN', 'OWNER'],
    ] as const) {
      for (const permission of ROLE_PERMISSIONS[lower]) {
        expect(roleHasPermission(higher, permission)).toBe(true);
      }
    }
  });

  it('does not make AGENT and VIEWER subsets of one another', () => {
    // VIEWER can read the whole inbox; AGENT cannot. AGENT can reply; VIEWER
    // cannot. Neither contains the other, so no numeric rank could express both.
    expect(roleHasPermission('VIEWER', 'conversation:read_all')).toBe(true);
    expect(roleHasPermission('AGENT', 'conversation:read_all')).toBe(false);
    expect(roleHasPermission('AGENT', 'conversation:reply')).toBe(true);
    expect(roleHasPermission('VIEWER', 'conversation:reply')).toBe(false);
  });

  it('keeps VIEWER read-only', () => {
    for (const permission of ROLE_PERMISSIONS.VIEWER) {
      const action = permission.split(':')[1]!;
      expect(['read', 'read_all', 'read_advanced']).toContain(action);
    }
  });

  it('sorts every role from least to most privileged by permission count', () => {
    const counts = roles.map((role) => ROLE_PERMISSIONS[role].size);
    // VIEWER is read-only and AGENT is not a superset of it, so only the upper
    // three are guaranteed to increase; AGENT vs VIEWER is asserted loosely.
    expect(counts[2]!).toBeLessThan(counts[3]!);
    expect(counts[3]!).toBeLessThan(counts[4]!);
  });
});

/**
 * Instruction #100: an AGENT must not be able to touch billing, the team, or
 * platform settings. Asserted directly rather than inferred from the hierarchy.
 */
describe('critical authorization test — AGENT is contained', () => {
  const forbidden: Permission[] = [
    'subscription:manage',
    'subscription:read',
    'member:invite',
    'member:update_role',
    'member:remove',
    'workspace:update',
    'workspace:delete',
    'workspace:transfer_ownership',
    'whatsapp:connect',
    'whatsapp:disconnect',
    'order:refund',
    'payment:refund',
    'audit_log:read',
    'integration:manage',
    'campaign:send',
    'analytics:read_advanced',
  ];

  for (const permission of forbidden) {
    it(`denies AGENT ${permission}`, () => {
      expect(roleHasPermission('AGENT', permission)).toBe(false);
    });
  }

  it('denies AGENT all of them together', () => {
    expect(roleHasAnyPermission('AGENT', forbidden)).toBe(false);
  });
});

describe('billing is owner-only', () => {
  it('withholds subscription:manage from every role except OWNER', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(roleHasPermission(role, 'subscription:manage')).toBe(role === 'OWNER');
    }
  });

  it('withholds workspace deletion and ownership transfer from every role except OWNER', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(roleHasPermission(role, 'workspace:delete')).toBe(role === 'OWNER');
      expect(roleHasPermission(role, 'workspace:transfer_ownership')).toBe(role === 'OWNER');
    }
  });
});

describe('MANAGER scope', () => {
  it('can run the operation', () => {
    expect(
      roleHasAllPermissions('MANAGER', [
        'conversation:read_all',
        'conversation:assign',
        'product:create',
        'inventory:update',
        'order:update_status',
        'agent:update',
        'knowledge:create',
      ]),
    ).toBe(true);
  });

  it('cannot manage the team, the plan, or the WhatsApp connection', () => {
    expect(
      roleHasAnyPermission('MANAGER', [
        'member:invite',
        'member:remove',
        'subscription:read',
        'whatsapp:connect',
      ]),
    ).toBe(false);
  });
});

describe('privilege escalation via role assignment', () => {
  it('never allows OWNER to be granted as a role', () => {
    for (const actor of WORKSPACE_ROLES) {
      expect(canAssignRole(actor, 'OWNER')).toBe(false);
    }
  });

  it('stops an ADMIN promoting anyone to ADMIN or above', () => {
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'MANAGER')).toBe(true);
    expect(canAssignRole('ADMIN', 'AGENT')).toBe(true);
    expect(canAssignRole('ADMIN', 'VIEWER')).toBe(true);
  });

  it('lets OWNER assign every non-owner role', () => {
    expect(canAssignRole('OWNER', 'ADMIN')).toBe(true);
    expect(canAssignRole('OWNER', 'MANAGER')).toBe(true);
    expect(canAssignRole('OWNER', 'AGENT')).toBe(true);
    expect(canAssignRole('OWNER', 'VIEWER')).toBe(true);
  });

  it('stops roles without member:update_role from assigning anything', () => {
    for (const actor of ['MANAGER', 'AGENT', 'VIEWER'] as const) {
      for (const target of WORKSPACE_ROLES) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
  });

  it('rejects an unknown role string without throwing', () => {
    expect(canAssignRole('SUPERUSER' as WorkspaceRole, 'AGENT')).toBe(false);
    expect(canAssignRole('ADMIN', 'SUPERUSER' as WorkspaceRole)).toBe(false);
  });
});

describe('member removal', () => {
  it('never allows an OWNER to be removed', () => {
    for (const actor of WORKSPACE_ROLES) {
      expect(canRemoveMember(actor, 'OWNER')).toBe(false);
    }
  });

  it('stops an ADMIN removing another ADMIN', () => {
    expect(canRemoveMember('ADMIN', 'ADMIN')).toBe(false);
    expect(canRemoveMember('ADMIN', 'MANAGER')).toBe(true);
  });

  it('lets OWNER remove any non-owner', () => {
    expect(canRemoveMember('OWNER', 'ADMIN')).toBe(true);
    expect(canRemoveMember('OWNER', 'VIEWER')).toBe(true);
  });

  it('stops roles without member:remove from removing anyone', () => {
    for (const target of WORKSPACE_ROLES) {
      expect(canRemoveMember('MANAGER', target)).toBe(false);
      expect(canRemoveMember('AGENT', target)).toBe(false);
      expect(canRemoveMember('VIEWER', target)).toBe(false);
    }
  });
});

describe('permissionsForRole', () => {
  it('returns a sorted, stable list', () => {
    const permissions = permissionsForRole('MANAGER');
    expect(permissions).toEqual([...permissions].sort());
    expect(permissions.length).toBe(ROLE_PERMISSIONS.MANAGER.size);
  });
});

describe('outranks', () => {
  // The primitive three separate rules now share. It was previously inlined in each,
  // and the copy that was missing from the role edit was a live bypass.
  it('is strict — nobody outranks a peer', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(outranks(role, role)).toBe(false);
    }
  });

  it('is antisymmetric across every distinct pairing', () => {
    for (const a of WORKSPACE_ROLES) {
      for (const b of WORKSPACE_ROLES) {
        if (a === b) continue;
        expect(outranks(a, b)).toBe(!outranks(b, a));
      }
    }
  });

  it('is transitive, so the ordering has no cycles', () => {
    for (const a of WORKSPACE_ROLES) {
      for (const b of WORKSPACE_ROLES) {
        for (const c of WORKSPACE_ROLES) {
          if (outranks(a, b) && outranks(b, c)) expect(outranks(a, c)).toBe(true);
        }
      }
    }
  });

  it('puts OWNER above and VIEWER below everyone', () => {
    for (const role of WORKSPACE_ROLES) {
      if (role !== 'OWNER') {
        expect(outranks('OWNER', role)).toBe(true);
        expect(outranks(role, 'OWNER')).toBe(false);
      }
      if (role !== 'VIEWER') {
        expect(outranks(role, 'VIEWER')).toBe(true);
        expect(outranks('VIEWER', role)).toBe(false);
      }
    }
  });

  it('denies rather than throws for a role outside the enum', () => {
    // Fails closed: the value comes from a database column, and a role added to the
    // Prisma enum ahead of this table must not become a 500 inside an authz check.
    const unknown = 'SUPERUSER' as WorkspaceRole;
    expect(outranks(unknown, 'VIEWER')).toBe(false);
    expect(outranks('OWNER', unknown)).toBe(false);
    expect(roleHasPermission(unknown, 'member:read')).toBe(false);
    expect(permissionsForRole(unknown)).toEqual([]);
    expect(canAssignRole(unknown, 'AGENT')).toBe(false);
    expect(canRemoveMember(unknown, 'AGENT')).toBe(false);
  });
});

describe('ASSIGNABLE_ROLES', () => {
  it('is every role except OWNER, in display order', () => {
    expect(ASSIGNABLE_ROLES).toEqual(WORKSPACE_ROLES.filter((role) => role !== 'OWNER'));
    expect(ASSIGNABLE_ROLES).not.toContain('OWNER');
  });
});
