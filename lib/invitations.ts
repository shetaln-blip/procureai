import crypto from "crypto";

// Invitation credentials for supplier RFQ responses (P0 #2). A supplier
// is granted access to their own — and only their own — RFQ invitation
// via a cryptographically random token, not a guessable vendor id.
//
// Design:
//  - The plaintext token is generated with crypto.randomBytes and handed
//    to the buyer exactly once, at issuance/reissuance time (see
//    issueInvitationToken in lib/store.ts) — it is never written to
//    disk.
//  - Only a SHA-256 hash of the token is persisted, on the
//    InvitedSupplier record it belongs to ("store only what is
//    necessary to validate the invitation").
//  - Validation re-hashes the presented token and compares it against
//    the stored hash using a constant-time comparison, so response
//    timing can't be used to guess a valid token character-by-character.
//  - There's no separate "revoked" flag: reissuing a token for a
//    supplier simply overwrites their tokenHash, which immediately
//    invalidates whatever token they had before. A supplier only ever
//    has at most one valid token at a time.
export function generateInvitationToken(): string {
  // 256 bits of entropy, URL-safe.
  return crypto.randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyInvitationToken(
  token: string,
  storedHash: string
): boolean {
  if (!token || !storedHash) return false;

  const candidateHash = hashInvitationToken(token);

  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");

  // Different lengths would throw inside timingSafeEqual — treat that
  // as "doesn't match" rather than letting the mismatch itself become
  // an observable timing signal beyond what's already unavoidable.
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
