import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isAccessValid } from "@/lib/shared-mode";
import { ageDecrypt, fetchFromIPFS } from "@/lib/shared-mode";
import type { SharedContent } from "@/lib/types";
import type { AgeEncryptedPayload } from "@/lib/shared-mode";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

/** GET /api/share/view/[token] — public endpoint, no auth required */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;

    const result = await pool.query(
      `SELECT sc.*, d.title, d.summary
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE sc.share_token = $1`,
      [token],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "not_found", message: "Share not found" },
        { status: 404 },
      );
    }

    const row = result.rows[0];
    const shared: SharedContent = {
      id: row.id,
      documentId: row.document_id,
      userId: row.user_id,
      ipfsCid: row.ipfs_cid,
      accessConditions: row.access_conditions,
      encryptionMethod: row.encryption_method,
      isRevoked: row.is_revoked,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      expiresAt: row.expires_at,
    };

    if (!isAccessValid(shared)) {
      const reason = shared.isRevoked ? "revoked" : "expired";
      return NextResponse.json(
        { error: reason, message: `This share has been ${reason}`, title: row.title },
        { status: 410 },
      );
    }

    const accessType = row.access_conditions?.type ?? "public";

    // Passphrase-protected: check for passphrase param
    if (accessType === "passphrase") {
      const passphrase = request.nextUrl.searchParams.get("passphrase");

      if (!passphrase) {
        // Return metadata only — prompt for passphrase
        return NextResponse.json({
          passphraseRequired: true,
          title: row.title,
          expiresAt: row.expires_at,
        });
      }

      // Decrypt content
      try {
        const ipfsData = await fetchFromIPFS(row.ipfs_cid);
        const payload = JSON.parse(ipfsData) as AgeEncryptedPayload;
        const decrypted = ageDecrypt(payload, { passphrase });
        const content = JSON.parse(decrypted);
        return NextResponse.json({ ...content, accessType });
      } catch {
        return NextResponse.json(
          { error: "wrong_passphrase", message: "Incorrect passphrase" },
          { status: 403 },
        );
      }
    }

    // Public share: fetch raw content from IPFS
    try {
      const ipfsData = await fetchFromIPFS(row.ipfs_cid);
      // Try parsing as JSON (structured content), fall back to raw
      try {
        const content = JSON.parse(ipfsData);
        return NextResponse.json({ ...content, accessType });
      } catch {
        return NextResponse.json({ title: row.title, content: ipfsData, accessType });
      }
    } catch {
      // IPFS unavailable — fall back to DB data
      return NextResponse.json({
        title: row.title,
        summary: row.summary,
        content: null,
        accessType,
        fallback: true,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load shared content";
    return NextResponse.json({ error: "server_error", message }, { status: 500 });
  }
}
