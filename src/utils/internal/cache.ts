/**
 * Evaluate an `If-None-Match` field-value against an ETag using the weak
 * comparison function (RFC 9110 §8.8.3.2 and §13.1.2).
 *
 * - `*` matches any current representation.
 * - The field-value is a comma-separated list of entity-tags. An opaque-tag is
 *   a quoted string whose value may itself contain commas, so tags are matched
 *   by their quoted boundaries rather than by naive comma splitting.
 * - Weak comparison ignores the `W/` weakness indicator on either side.
 */
export function matchETag(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === "*") {
    return true;
  }
  const target = opaqueTag(etag);
  return splitETags(ifNoneMatch).some((tag) => opaqueTag(tag.trim()) === target);
}

/**
 * Evaluate an `If-Match` field-value against an ETag using the strong
 * comparison function (RFC 9110 §8.8.3.2 and §13.1.1).
 *
 * - `*` matches any current representation.
 * - An entity-tag is strong unless it is explicitly marked as weak (`W/`).
 * - Strong comparison requires both entity-tags to not be weak and match character-by-character.
 */
export function matchETagStrong(ifMatch: string, etag: string): boolean {
  if (ifMatch.trim() === "*") {
    return true;
  }
  if (!etag || /^W\//i.test(etag)) {
    return false;
  }
  return splitETags(ifMatch).some((tag) => {
    const trimmed = tag.trim();
    return !/^W\//i.test(trimmed) && trimmed === etag;
  });
}

/**
 * Evaluate an incoming conditional request against RFC 9110 §13.2.2 preconditions:
 * `If-Match` and `If-Unmodified-Since`.
 *
 * RFC 9110 §13.1.4: a recipient MUST ignore `If-Unmodified-Since` when the request
 * contains an `If-Match` header field.
 *
 * Returns `true` if preconditions failed (caller MUST return 412 Precondition Failed).
 */
export function isPreconditionFailed(
  headers: Headers,
  validators: {
    etag?: string;
    lastModified?: Date;
    ifMatch?: string;
    ifUnmodifiedSince?: string;
  },
): boolean {
  const ifMatch = validators.ifMatch ?? headers.get("if-match");
  if (ifMatch) {
    return !validators.etag || !matchETagStrong(ifMatch, validators.etag);
  }
  if (validators.lastModified) {
    const ifUnmodifiedSince = validators.ifUnmodifiedSince ?? headers.get("if-unmodified-since");
    if (ifUnmodifiedSince) {
      const since = Date.parse(ifUnmodifiedSince);
      if (!Number.isNaN(since)) {
        return validators.lastModified.getTime() > since;
      }
    }
  }
  return false;
}

/**
 * Evaluate an incoming conditional request against the current representation's
 * validators, returning `true` when it matches. The caller determines the
 * applicable validators and response status for the request method.
 *
 * RFC 9110 §13.1.3: a recipient MUST ignore `If-Modified-Since` when the request
 * contains an `If-None-Match` header field. `If-None-Match` takes precedence;
 * `If-Modified-Since` is only evaluated when it is absent. A present-but-empty
 * `If-None-Match` is malformed and treated as absent.
 */
export function isCacheMatch(
  headers: Headers,
  validators: {
    etag?: string;
    lastModified?: Date;
    /** Overrides the request header, for a caller holding the original value. */
    ifNoneMatch?: string;
    /** Overrides the request header, for a caller holding the original value. */
    ifModifiedSince?: string;
  },
): boolean {
  const ifNoneMatch = validators.ifNoneMatch ?? headers.get("if-none-match");
  if (ifNoneMatch) {
    return !!validators.etag && matchETag(ifNoneMatch, validators.etag);
  }
  if (validators.lastModified) {
    const ifModifiedSince = validators.ifModifiedSince ?? headers.get("if-modified-since");
    return !!ifModifiedSince && new Date(ifModifiedSince) >= validators.lastModified;
  }
  return false;
}

function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/**
 * Split an `If-None-Match` list into entity-tags, treating commas inside a
 * quoted opaque-tag as literal. A `"` cannot appear within an opaque-tag
 * (RFC 9110 §8.8.3), so it unambiguously toggles the quoted state.
 */
function splitETags(value: string): string[] {
  const tags: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      tags.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tags.push(current);
  return tags;
}
