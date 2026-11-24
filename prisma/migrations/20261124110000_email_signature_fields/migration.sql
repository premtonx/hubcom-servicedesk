-- Email Signature System (document-store fields).
-- Users and email_channels live in geistdesk_documents (JSONB `data`).
-- This migration documents the canonical keys; initDb is a no-op for JSONB docs.
--
-- users.data:
--   job_title TEXT  — Position (e.g. IT-Systemengineer)
--   phone     TEXT  — Durchwahl (e.g. +49 6201 39093-30)
--
-- email_channels.data:
--   signature_enabled    BOOLEAN DEFAULT true
--   signature_html       TEXT    — HTML template with {{agent.*}} / {{ticket.number}} / {{organization.name}} / {{channel.logo}}
--   signature_logo_data  TEXT    — base64 or data-URL (PNG/JPEG/WebP ≤256 KB)
--   signature_logo_mime  TEXT    — image/png | image/jpeg | image/webp
--
-- No DDL changes required for the document store. Kept for migrate deploy history.

SELECT 1;
