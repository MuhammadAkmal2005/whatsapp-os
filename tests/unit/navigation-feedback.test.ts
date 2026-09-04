import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAV_FOOTER_ITEMS, isNavRowActive } from '@/components/app-shell/nav-config';
import {
  SETTINGS_NAV,
  SETTINGS_ROOT_HREF,
  firstAvailableSettingsHref,
  settingsDestinationForRole,
} from '@/components/app-shell/settings-nav-config';
import { WORKSPACE_ROLES, roleHasPermission } from '@/server/authz/permissions';

/**
 * The navigation-feedback work, pinned.
 *
 * Two changes are covered here, and both are the kind that break silently. The sidebar's
 * Settings row now links straight to a section instead of to `/settings`, which means a client
 * component is choosing a destination that a server redirect used to choose — if the two ever
 * disagree, the symptom is a reader landing on a page they cannot open, or a role being sent
 * somewhere it has no business seeing. And four routes gained a `loading.tsx`; delete one and
 * nothing fails, the page just goes back to sitting frozen on the previous screen after a click.
 *
 * `can(context, permission)` — what the settings page asks — is defined in
 * `server/tenancy/context.ts` as `roleHasPermission(context.role, permission)`. That module is
 * `server-only` and cannot be imported here, so the equivalence is asserted against
 * `roleHasPermission` directly, on the role the server puts in the context.
 */

/** The sections that exist today and are permitted to be a landing destination. */
const AVAILABLE_SECTIONS = SETTINGS_NAV.filter((item) => item.available);

describe('settings destination resolution', () => {
  /**
   * The safety property. Whatever the permission table says now or later, the row must never
   * point a role at a section that role cannot open — that would turn one wasted hop into a
   * redirect loop or a denial screen.
   */
  it('sends every role to a section it can actually open', () => {
    for (const role of WORKSPACE_ROLES) {
      const destination = settingsDestinationForRole(role);
      if (destination === SETTINGS_ROOT_HREF) continue;

      const section = AVAILABLE_SECTIONS.find((item) => item.href === destination);
      if (!section) throw new Error(`${role} is sent to ${destination}, which is not a section`);

      expect(roleHasPermission(role, section.permission)).toBe(true);
    }
  });

  /**
   * The equivalence that lets the row skip the redirect at all: the client resolves the same
   * section the server page would have redirected to, for every role, from the same registry in
   * the same order.
   */
  it('agrees with the destination the settings page would redirect to', () => {
    for (const role of WORKSPACE_ROLES) {
      const asThePageResolvesIt =
        firstAvailableSettingsHref((permission) => roleHasPermission(role, permission)) ??
        SETTINGS_ROOT_HREF;

      expect(settingsDestinationForRole(role)).toBe(asThePageResolvesIt);
    }
  });

  /**
   * Where each role lands today, spelled out.
   *
   * Team is the first built section and `member:read` is in the read-only floor, so every role
   * lands there — the hop this removes was the same hop for everyone. Pinning it means a change
   * to the permission table or to the order of `SETTINGS_NAV` surfaces here as a decision to
   * make, rather than quietly moving where people arrive.
   */
  it('lands every role on Team while that is the first built section', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(settingsDestinationForRole(role)).toBe('/settings/team');
    }
  });

  it('never points at a section that is not built yet', () => {
    const unbuilt = SETTINGS_NAV.filter((item) => !item.available).map((item) => item.href);

    for (const role of WORKSPACE_ROLES) {
      expect(unbuilt).not.toContain(settingsDestinationForRole(role));
    }
  });

  /**
   * The fallback. No role reaches it today, which is exactly why it needs a test: the branch
   * would otherwise be unexercised until a permission change made it live, and `/settings` is
   * the screen that explains having no sections — a dead end would be worse.
   */
  it('keeps /settings for a caller who can open nothing', () => {
    expect(firstAvailableSettingsHref(() => false)).toBeNull();
  });

  /** The resolver gates on the permission it is given, not on position in the list. */
  it('resolves to the first section the caller actually holds', () => {
    expect(firstAvailableSettingsHref((permission) => permission === 'subscription:read')).toBe(
      '/settings/billing',
    );
    expect(firstAvailableSettingsHref((permission) => permission === 'whatsapp:read')).toBe(
      '/settings/whatsapp',
    );
  });
});

describe('nav row active state', () => {
  /**
   * The registry entry keeps the section root even though the link now targets a leaf. This is
   * the pairing that keeps the row lit across the whole area: match on the row's own href, link
   * to the resolved destination.
   */
  it('registers the Settings row against the settings root', () => {
    const settingsRow = NAV_FOOTER_ITEMS.find((item) => item.href === SETTINGS_ROOT_HREF);
    expect(settingsRow).toBeDefined();
  });

  it('lights the Settings row on the root and on every section', () => {
    for (const pathname of [
      SETTINGS_ROOT_HREF,
      '/settings/team',
      '/settings/whatsapp',
      '/settings/billing',
    ]) {
      expect(isNavRowActive(pathname, SETTINGS_ROOT_HREF)).toBe(true);
    }
  });

  /** A prefix match on the raw string would light Settings on `/settingsx`; the separator stops it. */
  it('does not light on a path that merely starts with the same characters', () => {
    expect(isNavRowActive('/settingsx', SETTINGS_ROOT_HREF)).toBe(false);
    expect(isNavRowActive('/dashboard', SETTINGS_ROOT_HREF)).toBe(false);
  });

  it('lights a row on its own detail pages', () => {
    expect(isNavRowActive('/orders/8f2c41', '/orders')).toBe(true);
    expect(isNavRowActive('/orders', '/orders')).toBe(true);
  });
});

/**
 * The loading boundaries, checked as files.
 *
 * Next decides whether a click can render instantly by looking for a loading module on the
 * *changing* segment: without one it sends router state only, the new page's data is never
 * streamed with the response, and React holds the previous screen up while it waits. A parent
 * boundary cannot cover for a missing child one, because the loading UI is held on the parent
 * cache node — which is why each of these four needs its own file, and why the two parent
 * boundaries also have to stay for arrivals from outside the area.
 *
 * Asserting on file existence is crude, but it is the only part of this that is checkable
 * without a browser, and it catches the realistic regression: someone tidying up route folders
 * and removing a file that looks redundant.
 */
describe('navigation loading boundaries', () => {
  const boundaries = [
    'app/(app)/(workspace)/loading.tsx',
    'app/(app)/(workspace)/dashboard/loading.tsx',
    'app/(app)/(workspace)/settings/loading.tsx',
    'app/(app)/(workspace)/settings/team/loading.tsx',
    'app/(app)/(workspace)/settings/whatsapp/loading.tsx',
    'app/(app)/(workspace)/settings/billing/loading.tsx',
  ];

  for (const boundary of boundaries) {
    it(`has a loading boundary at ${boundary}`, () => {
      expect(existsSync(join(process.cwd(), boundary))).toBe(true);
    });
  }
});
