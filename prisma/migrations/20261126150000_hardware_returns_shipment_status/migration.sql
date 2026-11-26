-- Rücksendestatus: ausstehend | versendet | eingegangen (nullable — effective display uses returned).
ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS shipment_status TEXT;
