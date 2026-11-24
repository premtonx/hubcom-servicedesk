/**
 * Secure Exchange (vault_items) tenant isolation for Kunden-Portal.
 */

export function vaultOrganizationId(
  item: Record<string, unknown> | null | undefined,
): string | null {
  if (!item) return null;
  const top = item.organizationId ?? item.organization_id;
  if (top != null && String(top).trim() !== '') return String(top).trim();
  const meta = (item.metadata || {}) as Record<string, unknown>;
  const fromMeta = meta.organizationId ?? meta.organization_id;
  if (fromMeta != null && String(fromMeta).trim() !== '') return String(fromMeta).trim();
  return null;
}

export function vaultCreatedByUserId(
  item: Record<string, unknown> | null | undefined,
): string | null {
  if (!item) return null;
  const raw =
    item.created_by_user_id ??
    item.createdByUserId ??
    item.createdBy ??
    item.created_by ??
    null;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw).trim();
}

export function vaultRecipientEmails(
  item: Record<string, unknown> | null | undefined,
): string[] {
  const meta = ((item?.metadata || {}) as Record<string, unknown>) || {};
  const list = meta.recipientEmails;
  if (!Array.isArray(list)) {
    const single = meta.targetRecipient;
    if (typeof single === 'string' && single.includes('@')) {
      return [single.trim().toLowerCase()];
    }
    return [];
  }
  return list
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

export function isVaultItemInOrganization(
  item: Record<string, unknown> | null | undefined,
  organizationId: string,
): boolean {
  if (!item || !organizationId) return false;
  return vaultOrganizationId(item) === organizationId;
}

/**
 * CLIENT_ADMIN / CLIENT_SUPPORTER: all org transfers.
 * CLIENT_USER: only transfers they created or that list their email/user id as recipient.
 */
export function canPortalUserAccessVaultItem(params: {
  item: Record<string, unknown>;
  organizationId: string;
  role: string;
  userId: string;
  userEmail?: string | null;
}): boolean {
  if (!isVaultItemInOrganization(params.item, params.organizationId)) return false;
  if (params.role === 'CLIENT_ADMIN' || params.role === 'CLIENT_SUPPORTER') return true;
  if (params.role !== 'CLIENT_USER') return false;

  const createdBy = vaultCreatedByUserId(params.item);
  if (createdBy && createdBy === params.userId) return true;

  const email = String(params.userEmail || '')
    .trim()
    .toLowerCase();
  if (email && vaultRecipientEmails(params.item).includes(email)) return true;

  const meta = (params.item.metadata || {}) as Record<string, unknown>;
  const addressedUserIds = [
    meta.targetUserId,
    meta.recipientUserId,
    ...(Array.isArray(meta.recipientUserIds) ? meta.recipientUserIds : []),
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return addressedUserIds.includes(params.userId);
}

export function sanitizeVaultItemForPortal(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const meta = (item.metadata || {}) as Record<string, unknown>;
  return {
    id: item.id,
    type: item.type || 'secret',
    expirationType: item.expirationType || 'quota',
    expiresAt: item.expiresAt ?? null,
    maxViews: item.maxViews ?? meta.maxViews ?? null,
    viewCount: item.viewCount ?? 0,
    isBurned: Boolean(item.isBurned),
    createdAt: item.createdAt || null,
    createdBy: vaultCreatedByUserId(item),
    organizationId: vaultOrganizationId(item),
    passphraseRequired: Boolean(item.passphraseHash || meta.passphraseEnabled),
    metadata: {
      secretType: meta.secretType || null,
      filename: meta.filename || null,
      size: meta.size || null,
      description: meta.description || null,
      requestName: meta.requestName || null,
      recipientEmails: Array.isArray(meta.recipientEmails) ? meta.recipientEmails : [],
      targetRecipient: meta.targetRecipient || null,
      expirationPreset: meta.expirationPreset || null,
      maxViews: meta.maxViews ?? null,
    },
  };
}
