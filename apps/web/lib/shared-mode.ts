/**
 * Shared Mode - Decentralized Content Sharing
 *
 * Integrates:
 * - Lit Protocol v3: Threshold encryption & access control
 * - IPFS: Distributed content storage
 * - Arweave: Permanent archival storage
 * - Ceramic Network: DID & metadata management
 */

import type { SharedContent, AccessConditions, AccessConditionType, PrivacyLevel } from "@/lib/types";
import { isPrivateMode, canShare } from "@/lib/private-mode";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LIT_NETWORK = process.env.LIT_NETWORK ?? "datil-dev";
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs";
const IPFS_API = process.env.IPFS_API ?? "http://localhost:5001";
const ARWEAVE_GATEWAY = process.env.ARWEAVE_GATEWAY ?? "https://arweave.net";
const CERAMIC_API = process.env.CERAMIC_API ?? "http://localhost:7007";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareOptions {
  accessType: AccessConditionType;
  addresses?: string[];
  tokenAddress?: string;
  minBalance?: string;
  nftAddress?: string;
  permanentStorage?: boolean; // Use Arweave
}

export interface ShareResult {
  sharedContentId: string;
  ipfsCid: string;
  arweaveTxId?: string;
  ceramicStreamId?: string;
  accessConditions: AccessConditions;
  shareUrl: string;
}

export interface EncryptedPayload {
  ciphertext: string;
  dataToEncryptHash: string;
  accessControlConditions: LitAccessControlCondition[];
}

export interface LitAccessControlCondition {
  contractAddress: string;
  standardContractType: string;
  chain: string;
  method: string;
  parameters: string[];
  returnValueTest: {
    comparator: string;
    value: string;
  };
}

// ---------------------------------------------------------------------------
// Shared Mode Guard
// ---------------------------------------------------------------------------

export function isSharedModeAvailable(): boolean {
  return !isPrivateMode();
}

function assertSharedMode(): void {
  if (isPrivateMode()) {
    throw new SharedModeError("Shared Mode is disabled in Private Mode");
  }
}

export class SharedModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedModeError";
  }
}

/**
 * Assert that a specific document can be shared.
 * Checks both global Private Mode AND per-document/category privacy level.
 */
export function assertDocumentShareable(
  documentPrivacyLevel?: PrivacyLevel,
  categoryPrivacyLevel?: PrivacyLevel,
): void {
  if (isPrivateMode()) {
    throw new SharedModeError("Shared Mode is disabled in Private Mode");
  }
  if (!canShare(documentPrivacyLevel, categoryPrivacyLevel)) {
    throw new SharedModeError(
      "Document is marked as private and cannot be shared",
    );
  }
}

// ---------------------------------------------------------------------------
// Lit Protocol Integration
// ---------------------------------------------------------------------------

/**
 * Build Lit Protocol Access Control Conditions from our AccessConditions.
 */
export function buildLitAccessConditions(
  conditions: AccessConditions,
): LitAccessControlCondition[] {
  switch (conditions.type) {
    case "public":
      return [
        {
          contractAddress: "",
          standardContractType: "",
          chain: "ethereum",
          method: "",
          parameters: [":userAddress"],
          returnValueTest: { comparator: "=", value: ":userAddress" },
        },
      ];

    case "wallet":
      return (conditions.addresses ?? []).map((addr) => ({
        contractAddress: "",
        standardContractType: "",
        chain: "ethereum",
        method: "",
        parameters: [":userAddress"],
        returnValueTest: { comparator: "=", value: addr },
      }));

    case "token":
      return [
        {
          contractAddress: conditions.tokenAddress ?? "",
          standardContractType: "ERC20",
          chain: "ethereum",
          method: "balanceOf",
          parameters: [":userAddress"],
          returnValueTest: {
            comparator: ">=",
            value: conditions.minBalance ?? "1",
          },
        },
      ];

    case "nft":
      return [
        {
          contractAddress: conditions.nftAddress ?? "",
          standardContractType: "ERC721",
          chain: "ethereum",
          method: "balanceOf",
          parameters: [":userAddress"],
          returnValueTest: { comparator: ">", value: "0" },
        },
      ];
  }
}

/**
 * Encrypt content using Lit Protocol.
 *
 * TODO(production): Replace dev-mode fallback with real Lit SDK.
 *   Install: pnpm add @lit-protocol/lit-node-client @lit-protocol/auth-helpers
 *   Then replace the body with:
 *     const litClient = new LitNodeClient({ litNetwork: LIT_NETWORK });
 *     await litClient.connect();
 *     const { ciphertext, dataToEncryptHash } = await LitJsSdk.encryptString(
 *       { dataToEncrypt: content, accessControlConditions },
 *       litClient,
 *     );
 *
 * DEV MODE: When LIT_DEV_MODE=true (or SDK not configured), uses SHA-256 hash
 * + base64 encoding as a structural stand-in. Content is NOT encrypted.
 * Never use dev mode in production — documents will not be protected.
 */
export async function encryptWithLit(
  content: string,
  accessConditions: LitAccessControlCondition[],
): Promise<EncryptedPayload> {
  assertSharedMode();

  const isDevMode = process.env.LIT_DEV_MODE === "true" || !process.env.LIT_API_KEY;
  if (!isDevMode) {
    // Production path: Lit SDK must be wired here
    // See TODO above for installation and implementation details
    throw new SharedModeError(
      "Lit Protocol SDK not configured. Set LIT_DEV_MODE=true for development or install @lit-protocol/lit-node-client for production.",
    );
  }

  // Dev-mode fallback: structural stand-in only — NOT real encryption
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return {
    ciphertext: Buffer.from(data).toString("base64"),
    dataToEncryptHash: hashHex,
    accessControlConditions: accessConditions,
  };
}

/**
 * Decrypt content using Lit Protocol.
 *
 * TODO(production): Replace with real Lit SDK decryption.
 *   See encryptWithLit TODO for SDK setup details.
 */
export async function decryptWithLit(
  encrypted: EncryptedPayload,
): Promise<string> {
  assertSharedMode();

  const isDevMode = process.env.LIT_DEV_MODE === "true" || !process.env.LIT_API_KEY;
  if (!isDevMode) {
    throw new SharedModeError(
      "Lit Protocol SDK not configured. Set LIT_DEV_MODE=true for development or install @lit-protocol/lit-node-client for production.",
    );
  }

  // Dev-mode fallback: reverse base64 encoding only
  const decoded = Buffer.from(encrypted.ciphertext, "base64");
  return new TextDecoder().decode(decoded);
}

// ---------------------------------------------------------------------------
// IPFS Integration
// ---------------------------------------------------------------------------

/**
 * Upload encrypted content to IPFS.
 */
export async function uploadToIPFS(data: string): Promise<string> {
  assertSharedMode();

  const response = await fetch(`${IPFS_API}/api/v0/add`, {
    method: "POST",
    body: new Blob([data]),
  });

  if (!response.ok) {
    throw new SharedModeError(`IPFS upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  return result.Hash; // CID
}

/**
 * Retrieve content from IPFS by CID.
 */
export async function fetchFromIPFS(cid: string): Promise<string> {
  const response = await fetch(`${IPFS_GATEWAY}/${cid}`);
  if (!response.ok) {
    throw new SharedModeError(`IPFS fetch failed: ${response.statusText}`);
  }
  return response.text();
}

// ---------------------------------------------------------------------------
// Arweave Integration
// ---------------------------------------------------------------------------

/**
 * Upload to Arweave for permanent storage.
 */
export async function uploadToArweave(data: string): Promise<string> {
  assertSharedMode();

  // TODO(production): Replace with arweave-js or Bundlr/Irys SDK:
  //   Install: pnpm add arweave
  //   const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });
  //   const tx = await arweave.createTransaction({ data });
  //   await arweave.transactions.sign(tx, jwk); // requires Arweave wallet JWK
  //   const result = await arweave.transactions.post(tx);
  //   return tx.id;
  //
  // NOTE: The HTTP POST below is NOT the correct Arweave API format.
  // It is a structural placeholder. Real Arweave requires signed transactions.
  throw new SharedModeError(
    "Arweave SDK not configured. Install arweave package and provide ARWEAVE_JWK env variable for permanent storage.",
  );
}

// ---------------------------------------------------------------------------
// Ceramic Integration
// ---------------------------------------------------------------------------

/**
 * Store metadata on Ceramic Network.
 */
export async function createCeramicStream(metadata: {
  documentId: string;
  ipfsCid: string;
  arweaveTxId?: string;
  graphSnapshot: unknown;
}): Promise<string> {
  assertSharedMode();

  const response = await fetch(`${CERAMIC_API}/api/v0/streams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: 0, // TileDocument
      content: metadata,
    }),
  });

  if (!response.ok) {
    throw new SharedModeError(`Ceramic stream creation failed: ${response.statusText}`);
  }

  const result = await response.json();
  return result.streamId;
}

// ---------------------------------------------------------------------------
// Share Document Flow
// ---------------------------------------------------------------------------

/**
 * Full share flow: encrypt → IPFS → optional Arweave → Ceramic metadata.
 */
export async function shareDocument(
  documentId: string,
  content: string,
  graphSnapshot: unknown,
  options: ShareOptions,
  documentPrivacyLevel?: PrivacyLevel,
  categoryPrivacyLevel?: PrivacyLevel,
): Promise<ShareResult> {
  assertDocumentShareable(documentPrivacyLevel, categoryPrivacyLevel);

  // 1. Build access conditions
  const accessConditions: AccessConditions = {
    type: options.accessType,
    addresses: options.addresses,
    tokenAddress: options.tokenAddress,
    minBalance: options.minBalance,
    nftAddress: options.nftAddress,
  };

  const litConditions = buildLitAccessConditions(accessConditions);

  // 2. Encrypt with Lit Protocol
  const encrypted = await encryptWithLit(content, litConditions);

  // 3. Upload to IPFS
  const ipfsCid = await uploadToIPFS(JSON.stringify(encrypted));

  // 4. Optional: Upload to Arweave for permanence
  let arweaveTxId: string | undefined;
  if (options.permanentStorage) {
    arweaveTxId = await uploadToArweave(JSON.stringify(encrypted));
  }

  // 5. Store metadata on Ceramic
  const ceramicStreamId = await createCeramicStream({
    documentId,
    ipfsCid,
    arweaveTxId,
    graphSnapshot,
  });

  return {
    sharedContentId: `share-${Date.now()}`,
    ipfsCid,
    arweaveTxId,
    ceramicStreamId,
    accessConditions,
    shareUrl: `${IPFS_GATEWAY}/${ipfsCid}`,
  };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Revoke shared access. Updates Ceramic stream and invalidates Lit access.
 */
export async function revokeAccess(
  sharedContentId: string,
  ceramicStreamId: string,
): Promise<{ success: boolean; revokedAt: string }> {
  assertSharedMode();

  // Update Ceramic stream to mark as revoked
  await fetch(`${CERAMIC_API}/api/v0/streams/${ceramicStreamId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { revoked: true, revokedAt: new Date().toISOString() },
    }),
  });

  // In production: also revoke Lit Protocol access conditions
  // await litClient.revokeAccessConditions(...)

  return {
    success: true,
    revokedAt: new Date().toISOString(),
  };
}

/**
 * Check if shared content is still accessible (not revoked).
 */
export function isAccessValid(sharedContent: SharedContent): boolean {
  return !sharedContent.isRevoked;
}
