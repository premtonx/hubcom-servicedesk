/**
 * Rücksendestatus (shipment_status) — Ausstehend | Versendet | Eingegangen.
 * Effective display prefers `returned` so legacy rows need no backfill.
 */

export type ShipmentStatus = 'ausstehend' | 'versendet' | 'eingegangen';

export const SHIPMENT_STATUS_OPTIONS: Array<{
  id: ShipmentStatus;
  label: string;
}> = [
  { id: 'versendet', label: 'Versendet' },
  { id: 'ausstehend', label: 'Ausstehend' },
  { id: 'eingegangen', label: 'Eingegangen' },
];

export function coerceShipmentStatus(raw: unknown): ShipmentStatus | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'ausstehend' || s === 'versendet' || s === 'eingegangen') return s;
  return null;
}

/**
 * Effective list/form display:
 * - returned → eingegangen
 * - shipment_status === ausstehend → ausstehend
 * - else → versendet (incl. null / unknown)
 */
export function resolveEffectiveShipmentStatus(hw: {
  returned?: boolean | null;
  shipment_status?: string | null;
}): ShipmentStatus {
  if (hw.returned === true) return 'eingegangen';
  if (coerceShipmentStatus(hw.shipment_status) === 'ausstehend') return 'ausstehend';
  return 'versendet';
}

export function shipmentStatusLabel(status: ShipmentStatus): string {
  return SHIPMENT_STATUS_OPTIONS.find((o) => o.id === status)?.label || 'Versendet';
}
