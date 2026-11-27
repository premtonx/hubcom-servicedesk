/**
 * Idempotent seed for Hubcom matrix role documents.
 */

import { queryDb } from './postgres-backend.js';

export const HUBCOM_MATRIX_ROLE_SEEDS = [
  {
    id: 'role-super-admin',
    name: 'SUPER_ADMIN',
    description:
      'Systemhaus Voll-Admin — voller Zugriff auf Hubcom Admin-Hub und automatisch alle Kundenorganisationen.',
    isSystem: true,
    is_admin: true,
    can_create_tickets: true,
    can_view_knowledgebase: true,
    visibilityScope: 'all' as const,
  },
  {
    id: 'role-hubcom-admin',
    name: 'HUBCOM_ADMIN',
    description:
      'Hubcom Admin — Admin-Hub Einstellungen plus nur explizit zugewiesene Kundenorganisationen.',
    isSystem: true,
    is_admin: false,
    can_create_tickets: true,
    can_view_knowledgebase: true,
    visibilityScope: 'assigned' as const,
  },
  {
    id: 'role-hubcom-agent',
    name: 'HUBCOM_AGENT',
    description:
      'Hubcom Agent / Techniker — interne Tickets/KB plus nur explizit zugewiesene Kundenorganisationen.',
    isSystem: true,
    is_admin: false,
    can_create_tickets: true,
    can_view_knowledgebase: true,
    visibilityScope: 'assigned' as const,
  },
  {
    id: 'role-hubcom-user',
    name: 'HUBCOM_USER',
    description:
      'Hubcom Benutzer — nur eigene interne Tickets plus nur explizit zugewiesene Kundenorganisationen.',
    isSystem: true,
    is_admin: false,
    can_create_tickets: true,
    can_view_knowledgebase: true,
    visibilityScope: 'own' as const,
  },
] as const;

export async function seedHubcomMatrixRoles(): Promise<number> {
  const now = new Date().toISOString();
  let upserted = 0;
  for (const role of HUBCOM_MATRIX_ROLE_SEEDS) {
    const { id, ...rest } = role;
    const payload = {
      ...rest,
      permissions: {
        tickets: { view: true, create: true, edit: true, delete: false, admin: role.is_admin },
        customers: {
          view: true,
          create: role.is_admin,
          edit: role.is_admin,
          delete: false,
          admin: role.is_admin,
        },
        kb: { view: true, create: true, edit: true, delete: false, admin: role.is_admin },
        rbac: {
          view: role.name === 'SUPER_ADMIN' || role.name === 'HUBCOM_ADMIN',
          create: role.name === 'SUPER_ADMIN' || role.name === 'HUBCOM_ADMIN',
          edit: role.name === 'SUPER_ADMIN' || role.name === 'HUBCOM_ADMIN',
          delete: false,
          admin: role.name === 'SUPER_ADMIN',
        },
      },
      specialPermissions: {
        overridePIIShield: role.name === 'SUPER_ADMIN',
        manageModelOrchestrator: role.name === 'SUPER_ADMIN' || role.name === 'HUBCOM_ADMIN',
        bypass2FA: false,
        aiGovernance: role.name === 'SUPER_ADMIN' || role.name === 'HUBCOM_ADMIN',
      },
      createdAt: now,
      updatedAt: now,
    };
    await queryDb(
      `INSERT INTO geistdesk_documents (collection, id, data)
       VALUES ('roles', $1, $2::jsonb)
       ON CONFLICT (collection, id) DO UPDATE
         SET data = geistdesk_documents.data || EXCLUDED.data,
             updated_at = NOW()`,
      [id, JSON.stringify(payload)],
    );
    upserted += 1;
  }
  return upserted;
}
