import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { shareDocument } from "@/lib/shared-mode";
import type { ShareOptions } from "@/lib/shared-mode";

export const dynamic = "force-dynamic";

/** POST /api/share — create a new share link */
export async function POST(request: NextRequest) {
  const userId = await getUserIdFromRequest();
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

    // Verify document ownership and get content
    const docResult = await pool.query(
      `SELECT d.id, d.content, d.title, d.summary, d.privacy_level,
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
    const shareContent = JSON.stringify({
      title: doc.title,
      summary: doc.summary,
      content: doc.content,
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
    const message = error instanceof Error ? error.message : "Failed to create share";
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** GET /api/share — list current user's shares */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const result = await pool.query(
      `SELECT sc.id, sc.share_token, sc.document_id, sc.ipfs_cid,
              sc.access_conditions, sc.encryption_method, sc.is_revoked,
              sc.expires_at, sc.created_at, sc.revoked_at,
              d.title, d.summary, d.url, d.source_type, d.metadata
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE sc.user_id = $1
       ORDER BY sc.created_at DESC`,
      [userId],
    );

    const shares = result.rows.map((row) => ({
      id: row.id,
      shareToken: row.share_token,
      documentId: row.document_id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      sourceType: row.source_type,
      accessType: row.access_conditions?.type ?? "public",
      encryptionMethod: row.encryption_method,
      isRevoked: row.is_revoked,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    }));

    return NextResponse.json({ shares, total: shares.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list shares";
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
