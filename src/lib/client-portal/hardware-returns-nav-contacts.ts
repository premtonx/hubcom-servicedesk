/**
 * Pure client-safe contact autofill for Hardware-Rücklieferung drawers.
 * Mirrors extractHardwareContactsFromUser without server imports.
 */

function nullStr(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function nullEmail(v: unknown): string | null {
  const s = nullStr(v, 320);
  return s ? s.toLowerCase() : null;
}

/** Auto-fill phones / PM / manager from a user or portal-member profile. */
export function extractHardwareContactsFromUser(user: Record<string, unknown> | null | undefined): {
  employee_phone: string | null;
  employee_mobile: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
  manager_name: string | null;
  manager_email: string | null;
} {
  if (!user) {
    return {
      employee_phone: null,
      employee_mobile: null,
      project_manager_name: null,
      project_manager_email: null,
      manager_name: null,
      manager_email: null,
    };
  }
  return {
    employee_phone: nullStr(user.phone_office ?? user.phoneOffice ?? user.phone, 80),
    employee_mobile: nullStr(user.phone_mobile ?? user.phoneMobile ?? user.mobile, 80),
    project_manager_name: nullStr(user.project_manager_name ?? user.projectManagerName, 200),
    project_manager_email: nullEmail(user.project_manager_email ?? user.projectManagerEmail),
    manager_name: nullStr(user.manager_name ?? user.managerName, 200),
    manager_email: nullEmail(user.manager_email ?? user.managerEmail),
  };
}
