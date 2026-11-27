/**
 * Server-safe HTML helpers for inbound mail / CSV imports.
 * Delegates to the central allowlist sanitizer in security/sanitize.ts.
 */

export {
  sanitizeUserHtml as sanitizeInboundHtml,
  htmlToSafePlainText as htmlToPlainTextServer,
  escapeHtml,
  sanitizePlainTextField,
  sanitizeUserHtml,
} from '../security/sanitize.js';
