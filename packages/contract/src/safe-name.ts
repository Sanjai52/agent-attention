/**
 * Safe-name rules (PRD.md §17.3).
 *
 * Applied at validation and again at presentation. Names are
 * attacker-influenceable, so they are never trusted as display or speech
 * input without sanitization.
 */

import { createHash } from "node:crypto";

const DEFAULT_MAX_LENGTH = 64;
const VOICE_SAFE = /^[\p{L}\p{Nd} ._-]+$/u;

function isUnsafeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** True when the value contains a control or bidirectional-override character. */
export function containsUnsafeCharacters(value: string): boolean {
  return Array.from(value).some((character) => isUnsafeCodePoint(character.codePointAt(0) ?? 0));
}

/**
 * Strip control and bidirectional-override characters, collapse whitespace,
 * trim, and truncate to `maxLength` (including the ellipsis). Returns
 * `undefined` when nothing displayable remains.
 */
export function sanitizeDisplayName(
  value: string,
  maxLength = DEFAULT_MAX_LENGTH,
): string | undefined {
  if (maxLength <= 0) {
    return undefined;
  }

  const cleaned = Array.from(value)
    .filter((character) => !isUnsafeCodePoint(character.codePointAt(0) ?? 0))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return undefined;
  }

  const codePoints = Array.from(cleaned);
  if (codePoints.length <= maxLength) {
    return cleaned;
  }

  return `${codePoints.slice(0, maxLength - 1).join("")}…`;
}

/**
 * Voice may use a name only when it matches the allowlist: Unicode letters,
 * digits, space, `.`, `_`, and `-`.
 */
export function isVoiceSafeName(value: string): boolean {
  return value.length > 0 && VOICE_SAFE.test(value);
}

/** Display form of a session ID: first 8 characters of its SHA-256 hex hash. */
export function shortSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 8);
}
