import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { addDocDirect } from '../lib/postgres-backend.js';
import {
  extractScrapedArticle,
  isPrivateNetworkUrl,
  normalizeKbIngestStatus,
  parseKbIngestBuffer,
} from '../lib/kb-ingestion.js';
import { assertStaffKbCategoryWriteRole } from '../lib/kb/kb-categories.js';
import {
  formatKbCsvImportSummary,
  importKbCsvArticles,
} from '../lib/kb/kb-csv-import-service.js';
import { safeErrorMessage } from '../lib/safe-log.js';

const require = createRequire(
  typeof import.meta !== 'undefined' && import.meta.url
    ? import.meta.url
    : (typeof __filename !== 'undefined' ? __filename : ''),
);
const pdfParse = require('pdf-parse') as (data: Buffer) => Promise<{ text: string }>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();

const scrapeBodySchema = z.object({
  url: z.string().url().max(2000),
  category: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  save: z.boolean().optional(),
});

const uploadFormSchema = z.object({
  category: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  title: z.string().max(500).optional(),
  save: z.string().optional(),
});

async function persistKbArticle(payload: {
  title: string;
  content: string;
  category?: string;
  status?: string;
  tags?: string[];
  authorId?: string;
  source?: string;
  sourceUrl?: string;
}) {
  const now = new Date().toISOString();
  const status = normalizeKbIngestStatus(payload.status);
  const article = await addDocDirect('kb_articles', {
    title: payload.title.trim(),
    content: payload.content,
    category: payload.category?.trim() || 'uncategorized',
    subCategory: 'Imported',
    visibility: 'Public',
    tags: payload.tags ?? [],
    status,
    views: 0,
    helpfulCount: 0,
    unhelpfulCount: 0,
    language: 'English',
    source: payload.source ?? 'ingestion',
    sourceUrl: payload.sourceUrl,
    createdAt: now,
    updatedAt: now,
  });
  return { ...article, id: article.id };
}

router.post('/upload', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded. Use multipart field name "file".' });
    }

    const category = typeof req.body?.category === 'string' ? req.body.category : 'uncategorized';
    const status = typeof req.body?.status === 'string' ? req.body.status : 'draft';
    const titleOverride = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const saveToDb = req.body?.save !== 'false';

    // Multipart fields are strings; validate them when present.
    const formParsed = uploadFormSchema.safeParse(req.body || {});
    if (!formParsed.success) {
      return res.status(400).json({ error: 'Invalid upload form fields.', details: formParsed.error.flatten() });
    }

    const parsed = await parseKbIngestBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
      pdfParse,
      mammoth.extractRawText,
    );

    if (!parsed.plainText) {
      return res.status(422).json({ error: 'No readable text could be extracted from the uploaded file.' });
    }

    const title = titleOverride || parsed.title;
    const responsePayload = {
      title,
      content: parsed.content,
      plainText: parsed.plainText,
      kind: parsed.kind,
      category,
      status: normalizeKbIngestStatus(status),
    };

    if (!saveToDb) {
      return res.json({ ...responsePayload, saved: false });
    }

    const user = (req as Request & { user?: { id?: string } }).user;
    const article = await persistKbArticle({
      title,
      content: parsed.content,
      category,
      status,
      tags: ['imported', parsed.kind],
      authorId: user?.id,
      source: `file:${parsed.kind}`,
    });

    return res.status(201).json({
      ...responsePayload,
      saved: true,
      articleId: article.id,
      article,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to upload and parse file.';
    return res.status(500).json({ error: message });
  }
});

router.post('/parse-file', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const parsed = await parseKbIngestBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
      pdfParse,
      mammoth.extractRawText,
    );

    return res.json({
      title: parsed.title,
      content: parsed.plainText,
      html: parsed.content,
      kind: parsed.kind,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to parse file.';
    return res.status(500).json({ error: message });
  }
});

async function handleScrape(req: Request, res: Response) {
  try {
    const parsed = scrapeBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'URL is required.', details: parsed.error.flatten() });
    }
    const { url, category: categoryRaw, status: statusRaw, save } = parsed.data;
    if (!url) return res.status(400).json({ error: 'URL is required.' });
    if (isPrivateNetworkUrl(url)) {
      return res.status(400).json({ error: 'URL targets a private or disallowed network address.' });
    }

    const category = categoryRaw ?? 'uncategorized';
    const status = statusRaw ?? 'draft';
    const saveToDb = save !== false;

    const response = await axios.get(url, {
      timeout: 20000,
      maxRedirects: 3,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; HubcomServiceDesk-KB-Ingest/1.0; +https://hubcom.ch)',
        Accept: 'text/html,application/xhtml+xml',
      },
      validateStatus: (code) => code >= 200 && code < 400,
    });

    const extracted = extractScrapedArticle(String(response.data ?? ''), url);
    if (!extracted.plainText) {
      return res.status(422).json({ error: 'No article content could be extracted from the target URL.' });
    }

    const payload = {
      title: extracted.title,
      content: extracted.content,
      plainText: extracted.plainText,
      category,
      status: normalizeKbIngestStatus(status),
      sourceUrl: url,
    };

    if (!saveToDb) {
      return res.json({ ...payload, saved: false });
    }

    const user = (req as Request & { user?: { id?: string } }).user;
    const article = await persistKbArticle({
      title: extracted.title,
      content: extracted.content,
      category,
      status,
      tags: ['imported', 'web-scrape'],
      authorId: user?.id,
      source: 'web-scrape',
      sourceUrl: url,
    });

    return res.status(201).json({
      ...payload,
      saved: true,
      articleId: article.id,
      article,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to scrape site.';
    return res.status(500).json({ error: message });
  }
}

router.post('/scrape', authenticate, handleScrape);
router.post('/crawl', authenticate, handleScrape);

const staffCsvImportSchema = z
  .object({
    organizationId: z.string().min(1).max(120),
    visibility: z
      .enum(['organization', 'public', 'internal', 'shared_portal'])
      .optional()
      .default('organization'),
    category: z.string().max(200).optional(),
    publishImmediately: z.boolean().optional().default(true),
    csv: z.string().max(8_000_000).optional(),
    articles: z
      .array(
        z.object({
          title: z.string().min(1).max(500),
          content: z.string().min(1).max(500_000),
          sharePointId: z.string().max(80).optional(),
          matchcode: z.string().max(500).optional(),
          hasAttachments: z.boolean().optional(),
          category: z.string().max(200).optional(),
        }),
      )
      .max(5_000)
      .optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.csv?.trim()) || (Array.isArray(b.articles) && b.articles.length > 0), {
    message: 'csv or articles[] required',
  });

/** SharePoint / CSV KB import — SYSTEM_ADMIN / AGENT (staff). */
router.post('/import-csv', authenticate, async (req: Request, res: Response): Promise<any> => {
  try {
    if (!assertStaffKbCategoryWriteRole(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden: SYSTEM_ADMIN or AGENT required.' });
    }
    const parsed = staffCsvImportSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Import-Daten.', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const result = await importKbCsvArticles({
      organizationId: body.organizationId,
      visibility: body.visibility,
      category: body.category,
      publishImmediately: body.publishImmediately,
      csv: body.csv,
      articles: body.articles,
      dryRun: body.dryRun,
      authorId: req.user?.id,
      authorName: req.user?.name || req.user?.email || req.user?.id,
    });
    return res.json({
      success: true,
      ...result,
      summary: formatKbCsvImportSummary(result),
    });
  } catch (err: any) {
    return res
      .status(err?.status || 500)
      .json({ error: safeErrorMessage(err, 'CSV-Import fehlgeschlagen') });
  }
});

export default router;
