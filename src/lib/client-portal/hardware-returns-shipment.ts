/**
 * Rücksendestatus (shipment_status) — Versendet | Eingegangen.
 * Effective display prefers `returned`. Legacy `ausstehend` maps to Versendet.
 */

export type ShipmentStatus = 'versendet' | 'eingegangen';

/** Legacy DB value still accepted by coerce/normalize. */
export type ShipmentStatusLegacy = ShipmentStatus | 'ausstehend';

export const SHIPMENT_STATUS_OPTIONS: Array<{
  id: ShipmentStatus;
  label: string;
}> = [
  { id: 'versendet', label: 'Versendet' },
  { id: 'eingegangen', label: 'Eingegangen' },
];

export function coerceShipmentStatus(raw: unknown): ShipmentStatus | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'versendet' || s === 'eingegangen') return s;
  // Legacy: treat ausstehend as versendet for UI/API write-through.
  if (s === 'ausstehend') return 'versendet';
  return null;
}

/**
 * Effective list/form display (2 states only):
 * - returned → eingegangen
 * - else → versendet (incl. null / ausstehend / unknown)
 */
export function resolveEffectiveShipmentStatus(hw: {
  returned?: boolean | null;
  shipment_status?: string | null;
}): ShipmentStatus {
  if (hw.returned === true) return 'eingegangen';
  return 'versendet';
}

export function shipmentStatusLabel(status: ShipmentStatus): string {
  return SHIPMENT_STATUS_OPTIONS.find((o) => o.id === status)?.label || 'Versendet';
}
