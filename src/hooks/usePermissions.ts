import { useState, useEffect } from 'react';
import { useAuth } from '../lib/hooks';
import { userService } from '../services/userService';
import { rbacService } from '../services/rbacService';
import { User, UserRole } from '../types';
import {
  applyBetaAdminSession,
  applyGuestAdminSession,
  isBetaAutoAdminEnabled,
  isStaleGuestAgentCache,
} from '../lib/beta-admin-bypass';
import { isClientPortalRole } from '../lib/client-portal/roles';
import {
  buildClientPortalUserProfile,
  buildClientPortalUserRole,
  shouldFetchRolesCollection,
  type AuthSessionUser,
} from '../lib/client-portal/portal-role-from-session';

function legacyRoleFromProfile(profile: User): UserRole {
  return {
    id: 'legacy',
    name: profile.role,
    description: 'Legacy system role',
    permissions: {
      tickets: {
        view: true,
        create: true,
        edit: true,
        delete: profile.role === 'admin',
        admin: profile.role === 'admin',
      },
      customers: {
        view: true,
        create: true,
        edit: true,
        delete: profile.role === 'admin',
        admin: profile.role === 'admin',
      },
      vault: {
        view: true,
        create: true,
        edit: true,
        delete: profile.role === 'admin',
        admin: profile.role === 'admin',
      },
      insights: {
        view: profile.role !== 'agent',
        create: false,
        edit: false,
        delete: false,
        admin: profile.role === 'admin',
      },
    },
    specialPermissions: {
      overridePIIShield: profile.role === 'admin',
      manageModelOrchestrator: profile.role === 'admin',
      bypass2FA: false,
      aiGovernance: profile.role === 'admin',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function applyClientPortalSession(
  sessionUser: AuthSessionUser,
  authUser: { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null },
): { profile: User; role: UserRole } | null {
  const profile = buildClientPortalUserProfile(sessionUser, authUser);
  if (!profile || !isClientPortalRole(profile.role)) return null;
  return {
    profile,
    role: buildClientPortalUserRole(profile.role),
  };
}

export function usePermissions() {
  const { user: authUser, loading: authLoading } = useAuth();
  const [userProfile, setUserProfile] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('geistdesk_cached_user_profile');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [role, setRole] = useState<UserRole | null>(() => {
    try {
      const saved = localStorage.getItem('geistdesk_cached_user_role');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(() => {
    if (isBetaAutoAdminEnabled()) return true;
    try {
      const savedProfile = localStorage.getItem('geistdesk_cached_user_profile');
      const savedRole = localStorage.getItem('geistdesk_cached_user_role');
      if (savedProfile && savedRole) {
        const profile = JSON.parse(savedProfile) as User;
        const role = JSON.parse(savedRole) as UserRole;
        if (isStaleGuestAgentCache(profile, role)) return true;
        return false;
      }
    } catch {}
    return true;
  });

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!authUser) {
      setUserProfile(null);
      setRole(null);
      localStorage.removeItem('geistdesk_cached_user_profile');
      localStorage.removeItem('geistdesk_cached_user_role');
      setLoading(false);
      return;
    }

    if (isBetaAutoAdminEnabled()) {
      const { profile, role } = applyBetaAdminSession(authUser);
      setUserProfile(profile);
      setRole(role);
      setLoading(false);
      return;
    }

    if (isStaleGuestAgentCache(userProfile, role)) {
      const guestSession = applyGuestAdminSession(authUser);
      if (guestSession) {
        setUserProfile(guestSession.profile);
        setRole(guestSession.role);
      }
    }

    let cancelled = false;
    let timeoutFired = false;
    let realProfileLoaded = false;
    let unsubUsers: (() => void) | null = null;

    const safetyTimeout = setTimeout(() => {
      if (!realProfileLoaded && !cancelled) {
        timeoutFired = true;
        console.warn(
          '[Permissions Engine] Database connection delayed. Applying safe offline-first fallback...',
        );
        const guestSession = applyGuestAdminSession(authUser);
        if (guestSession) {
          setRole(guestSession.role);
          setUserProfile(guestSession.profile);
        } else {
          const agentRole: UserRole = {
            id: 'legacy',
            name: 'agent',
            description: 'Offline agent fallback',
            permissions: {
              tickets: { view: true, create: true, edit: true, delete: false, admin: false },
              customers: { view: true, create: true, edit: true, delete: false, admin: false },
              vault: { view: true, create: true, edit: true, delete: false, admin: false },
              insights: { view: false, create: false, edit: false, delete: false, admin: false },
            },
            specialPermissions: {
              overridePIIShield: false,
              manageModelOrchestrator: false,
              bypass2FA: false,
              aiGovernance: false,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          setRole(agentRole);
          setUserProfile({
            id: authUser.uid,
            name: authUser.displayName || authUser.email?.split('@')[0] || 'Agent',
            email: authUser.email || '',
            avatar: authUser.photoURL || '',
            role: 'agent',
            is_admin: false,
            createdAt: new Date(),
          });
        }
        setLoading(false);
      }
    }, 1200);

    const hydrateStaffRole = async (profile: User) => {
      // CLIENT_* → in-memory seed role only (never /api/db "roles").
      if (isClientPortalRole(profile.role) || !shouldFetchRolesCollection(profile.role)) {
        const portalRole = isClientPortalRole(profile.role)
          ? buildClientPortalUserRole(profile.role)
          : legacyRoleFromProfile(profile);
        if (!cancelled) {
          setRole(portalRole);
          localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(portalRole));
          setLoading(false);
        }
        return;
      }

      if (!profile.roleId) {
        const mockRole = legacyRoleFromProfile(profile);
        if (!cancelled) {
          setRole(mockRole);
          localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(mockRole));
          setLoading(false);
        }
        return;
      }

      try {
        const r = await rbacService.getRole(profile.roleId);
        if (cancelled) return;
        if (r) {
          setRole(r);
          localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(r));
        } else {
          const mockRole = legacyRoleFromProfile(profile);
          setRole(mockRole);
          localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(mockRole));
        }
      } catch (err) {
        console.warn('[Permissions Engine] getRole failed; using legacy profile role.', err);
        if (!cancelled) {
          const mockRole = legacyRoleFromProfile(profile);
          setRole(mockRole);
          localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(mockRole));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const startStaffUserSubscription = () => {
      unsubUsers = userService.subscribeToUsers((users) => {
        const emailMatches = users.filter(
          (u) =>
            u.email &&
            authUser.email &&
            u.email.toLowerCase().trim() === authUser.email.toLowerCase().trim(),
        );
        const profile =
          emailMatches.find((u) => u.id === authUser.uid) ||
          emailMatches.find((u) => (u as any).is_admin === true || u.role === 'admin') ||
          emailMatches[0];

        if (profile) {
          clearTimeout(safetyTimeout);
          realProfileLoaded = true;

          // Portal accounts discovered via users list — still never hit "roles".
          if (isClientPortalRole(profile.role)) {
            const portal = applyClientPortalSession(
              {
                id: profile.id,
                name: profile.name,
                email: profile.email,
                role: profile.role,
                organizationId: profile.organizationId,
                organization_id: profile.organization_id,
                avatar: profile.avatar,
                can_create_tickets: profile.can_create_tickets,
                can_view_knowledgebase: profile.can_view_knowledgebase,
              },
              authUser,
            );
            if (portal && !cancelled) {
              setUserProfile(portal.profile);
              setRole(portal.role);
              localStorage.setItem('geistdesk_cached_user_profile', JSON.stringify(portal.profile));
              localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(portal.role));
              setLoading(false);
            }
            return;
          }

          if (!cancelled) {
            setUserProfile(profile);
            localStorage.setItem('geistdesk_cached_user_profile', JSON.stringify(profile));
          }
          void hydrateStaffRole(profile);
        } else if (timeoutFired && !realProfileLoaded && !cancelled) {
          const guestSession = applyGuestAdminSession(authUser);
          if (guestSession) {
            setRole(guestSession.role);
            setUserProfile(guestSession.profile);
          }
          setLoading(false);
        }
      });
    };

    // Prefer server session for CLIENT_* so boot never touches /api/db "roles".
    void (async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (res.ok) {
          const data = (await res.json()) as { user?: AuthSessionUser };
          const portal = data.user
            ? applyClientPortalSession(data.user, authUser)
            : null;
          if (portal) {
            clearTimeout(safetyTimeout);
            realProfileLoaded = true;
            if (!cancelled) {
              setUserProfile(portal.profile);
              setRole(portal.role);
              localStorage.setItem(
                'geistdesk_cached_user_profile',
                JSON.stringify(portal.profile),
              );
              localStorage.setItem('geistdesk_cached_user_role', JSON.stringify(portal.role));
              setLoading(false);
            }
            // Do not subscribe to full users list / roles for portal accounts.
            return;
          }
        }
      } catch (err) {
        console.warn('[Permissions Engine] /api/auth/session unavailable; falling back.', err);
      }

      if (cancelled) return;
      startStaffUserSubscription();
    })();

    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
      if (unsubUsers) unsubUsers();
    };
  }, [authUser, authLoading]);

  const hasPermission = (module: string, action: 'view' | 'create' | 'edit' | 'delete' | 'admin') => {
    if (userProfile?.is_admin === true) return true;

    if (module === 'tickets' && action === 'create' && userProfile?.can_create_tickets === false) {
      return false;
    }
    if (
      (module === 'kb_articles' || module === 'kb') &&
      action === 'view' &&
      userProfile?.can_view_knowledgebase === false
    ) {
      return false;
    }

    if (!role) return false;

    if (role.name === 'admin' || role.isSystem || (role as any).is_admin === true) {
      // CLIENT_* seeds are isSystem:true — do not treat them as Hubcom god-mode.
      if (!isClientPortalRole(role.name)) return true;
    }

    if (module === 'tickets' && action === 'create' && (role as any).can_create_tickets === false) {
      return false;
    }
    if (
      (module === 'kb_articles' || module === 'kb') &&
      action === 'view' &&
      (role as any).can_view_knowledgebase === false
    ) {
      return false;
    }

    const modulePerms = role.permissions[module];
    if (!modulePerms) return false;

    return modulePerms[action] === true;
  };

  const hasSpecialPermission = (key: keyof UserRole['specialPermissions']) => {
    if (!role) return false;
    if (isClientPortalRole(role.name)) {
      return role.specialPermissions[key] === true;
    }
    if (role.name === 'admin' || role.isSystem) return true;
    return role.specialPermissions[key] === true;
  };

  return { role, userProfile, hasPermission, hasSpecialPermission, loading };
}
