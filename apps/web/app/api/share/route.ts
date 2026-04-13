import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { shareDocument, SharedModeError } from "@/lib/shared-mode";
import type { ShareOptions } from "@/lib/shared-mode";

export const dynamic = "force-dynamic";

/** POST /api/share — create a new share link */
export async function POST(request: NextRequest) {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const body = await request.json() as {
      documentId: string;
      accessType: "public" | "passphrase";
      passphrase?: string;
      expiryHours?: number;
    };

    if (!body.documentId || !body.accessType) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "documentId and accessType are required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    if (body.accessType === "passphrase" && !body.passphrase) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Passphrase is required for passphrase-protected shares", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Verify document ownership and get content + metadata
    const docResult = await pool.query(
      `SELECT d.id, d.content, d.title, d.summary, d.url, d.source_type, d.metadata, d.privacy_level,
              (SELECT c.privacy_level FROM categories c
               JOIN document_categories dc ON dc.category_id = c.id
               WHERE dc.document_id = d.id LIMIT 1) as category_privacy
       FROM documents d WHERE d.id = $1 AND d.user_id = $2`,
      [body.documentId, userId],
    );

    if (docResult.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const doc = docResult.rows[0];
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    // For URL sources, raw content is scraped HTML — only include for text/file types
    const includeRawContent = doc.source_type === "text" || doc.source_type === "file";
    const shareContent = JSON.stringify({
      title: doc.title,
      summary: doc.summary,
      content: includeRawContent ? doc.content : undefined,
      url: doc.url,
      sourceType: doc.source_type,
      ogImage: typeof meta.ogImage === "string" ? meta.ogImage : undefined,
      aiSummary: typeof meta.summary === "string" ? meta.summary : undefined,
      whatItSolves: typeof meta.what_it_solves === "string" ? meta.what_it_solves : undefined,
      keyPoints: Array.isArray(meta.key_points) ? meta.key_points : undefined,
      readingTimeMinutes: typeof meta.reading_time_minutes === "number" ? meta.reading_time_minutes : undefined,
      tags: [...new Set([
        ...(Array.isArray(meta.aiTags) ? meta.aiTags : []),
        ...(Array.isArray(meta.userTags) ? meta.userTags : []),
        ...(Array.isArray(meta.tags) ? meta.tags : []),
      ].filter((t): t is string => typeof t === "string"))],
    });

    const options: ShareOptions = {
      accessType: body.accessType,
      passphrase: body.passphrase,
      expiryHours: body.expiryHours ?? 0,
    };

    const result = await shareDocument(
      body.documentId,
      shareContent,
      userId,
      options,
      doc.privacy_level,
      doc.category_privacy,
    );

    return NextResponse.json({
      id: result.sharedContentId,
      shareToken: result.shareToken,
      ipfsCid: result.ipfsCid,
      passphraseRequired: result.passphraseRequired,
      expiresAt: options.expiryHours
        ? new Date(Date.now() + options.expiryHours * 3600_000).toISOString()
        : null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof SharedModeError) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: error.message, timestamp: new Date().toISOString() },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Failed to create share";
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** GET /api/share — list current user's shares */
export async function GET(request: NextRequest) {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "24", 10) || 24, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM shared_content WHERE user_id = $1`,
      [userId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await pool.query(
      `SELECT sc.id, sc.share_token, sc.document_id, sc.ipfs_cid,
              sc.access_conditions, sc.encryption_method, sc.is_revoked,
              sc.expires_at, sc.created_at, sc.revoked_at,
              d.title, d.summary, d.url, d.source_type, d.metadata
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE sc.user_id = $1
       ORDER BY sc.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const shares = result.rows.map((row: Record<string, unknown>) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        shareToken: row.share_token,
        documentId: row.document_id,
        title: row.title,
        summary: row.summary,
        url: row.url,
        sourceType: row.source_type,
        ogImage: typeof meta.ogImage === "string" ? meta.ogImage : null,
        tags: [...new Set([
          ...(Array.isArray(meta.aiTags) ? meta.aiTags : []),
          ...(Array.isArray(meta.userTags) ? meta.userTags : []),
          ...(Array.isArray(meta.tags) ? meta.tags : []),
        ].filter((t): t is string => typeof t === "string"))],
        readingTimeMinutes: typeof meta.reading_time_minutes === "number" ? meta.reading_time_minutes : null,
        accessType: (row.access_conditions as Record<string, unknown>)?.type ?? "public",
        encryptionMethod: row.encryption_method,
        isRevoked: row.is_revoked,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
      };
    });

    return NextResponse.json({ shares, total, hasMore: offset + shares.length < total });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list shares";
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
