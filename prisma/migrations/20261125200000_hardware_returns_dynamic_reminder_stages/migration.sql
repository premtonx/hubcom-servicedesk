-- Dynamic 1..N reminder stages for hardware returns (Part 1 backend).
ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS reminder_stages JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

-- Idempotent backfill from legacy mail1/2/3 columns when reminder_stages is empty.
UPDATE ticket_hardware_returns AS t
SET
  reminder_stages = COALESCE((
    SELECT jsonb_agg(elem ORDER BY ord)
    FROM (
      SELECT 1 AS ord, jsonb_build_object(
        'stage', 1,
        'sentAt', t.mail1_sent_at,
        'scheduledDate', t.mail1_scheduled_date,
        'recipientsTo', COALESCE(t.mail1_sent_recipients->'to', '[]'::jsonb),
        'recipientsCc', COALESCE(t.mail1_sent_recipients->'cc', '[]'::jsonb)
      ) AS elem
      WHERE t.mail1_sent_at IS NOT NULL OR t.mail1_scheduled_date IS NOT NULL
      UNION ALL
      SELECT 2, jsonb_build_object(
        'stage', 2,
        'sentAt', t.mail2_sent_at,
        'scheduledDate', t.mail2_scheduled_date,
        'recipientsTo', COALESCE(t.mail2_sent_recipients->'to', '[]'::jsonb),
        'recipientsCc', COALESCE(t.mail2_sent_recipients->'cc', '[]'::jsonb)
      )
      WHERE t.mail2_sent_at IS NOT NULL OR t.mail2_scheduled_date IS NOT NULL
      UNION ALL
      SELECT 3, jsonb_build_object(
        'stage', 3,
        'sentAt', t.mail3_sent_at,
        'scheduledDate', t.mail3_scheduled_date,
        'recipientsTo', COALESCE(t.mail3_sent_recipients->'to', '[]'::jsonb),
        'recipientsCc', COALESCE(t.mail3_sent_recipients->'cc', '[]'::jsonb)
      )
      WHERE t.mail3_sent_at IS NOT NULL OR t.mail3_scheduled_date IS NOT NULL
    ) s
  ), '[]'::jsonb),
  reminder_count = GREATEST(
    CASE WHEN t.mail1_sent_at IS NOT NULL THEN 1 ELSE 0 END,
    CASE WHEN t.mail2_sent_at IS NOT NULL THEN 2 ELSE 0 END,
    CASE WHEN t.mail3_sent_at IS NOT NULL THEN 3 ELSE 0 END
  )
WHERE t.reminder_stages = '[]'::jsonb
  AND t.reminder_count = 0
  AND (
    t.mail1_sent_at IS NOT NULL OR t.mail2_sent_at IS NOT NULL OR t.mail3_sent_at IS NOT NULL
    OR t.mail1_scheduled_date IS NOT NULL OR t.mail2_scheduled_date IS NOT NULL
    OR t.mail3_scheduled_date IS NOT NULL
  );
