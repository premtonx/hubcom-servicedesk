/**
 * Loads Hubcom staff session scope (role + organization_access) from /api/auth/session.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/hooks';
import {
  sessionCanManageHubcomCore,
  sessionIsSuperAdmin,
  type StaffSessionAccess,
} from '../lib/staff-access-ui';
import { normalizeHubcomMatrixRole } from '../lib/staff-org-access-shared';

export type StaffSessionUser = {
  id: string;
  role: string;
  is_admin?: boolean;
  name?: string;
  email?: string;
  staffAccess?: StaffSessionAccess | null;
};

export function useStaffSession() {
  const { user, loading: authLoading } = useAuth();
  const [sessionUser, setSessionUser] = useState<StaffSessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (authLoading) {
        setLoading(true);
        return;
      }
      if (!user) {
        if (active) {
          setSessionUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (!res.ok) {
          if (active) setSessionUser(null);
          return;
        }
        const data = (await res.json()) as { user?: StaffSessionUser };
        if (active) setSessionUser(data.user || null);
      } catch {
        if (active) setSessionUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  const role = normalizeHubcomMatrixRole(sessionUser?.role, sessionUser?.is_admin === true);
  return {
    loading: authLoading || loading,
    user: sessionUser,
    role: String(role),
    canManageHubcomCore: sessionCanManageHubcomCore(sessionUser),
    isSuperAdmin: sessionIsSuperAdmin(sessionUser),
    staffAccess: sessionUser?.staffAccess || null,
  };
}
