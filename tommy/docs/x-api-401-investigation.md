# X API 401 Unauthorized Investigation (NOVA-361)

**Date:** 2026-02-22
**Issue:** Search queries with spaces ("stock market", "blue origin") returning 401 Unauthorized
**Status:** ✅ RESOLVED

---

## Symptoms

- X API search endpoint returning 401 Unauthorized on specific queries
- Affected queries: "stock market", "blue origin", and any query containing spaces
- Queries without spaces (e.g., "$RKLB") working fine
- Issue appeared in multiple Tommy sessions (Feb 9-11, 2026)

## Root Cause

**URL encoding mismatch in OAuth 1.0a signature generation**

X API recently enforced strict RFC 3986 URL encoding where:

- Spaces MUST be encoded as `%20` (percent-encoding)
- The `+` character is treated as a literal `+`, NOT a space

Our code was using JavaScript's `URLSearchParams.toString()` which uses form-style encoding:

- Spaces encoded as `+` (application/x-www-form-urlencoded)
- This is valid for HTML forms but NOT for OAuth signatures

**The mismatch:**

```javascript
// Our code generated:
GET /2/tweets/search/recent?query=stock+market

// OAuth signature computed for:
query=stock+market  // The + is URL-encoded

// X API expected (RFC 3986):
GET /2/tweets/search/recent?query=stock%20market

// OAuth signature should be for:
query=stock%20market  // Space properly encoded as %20
```

When X API validated the OAuth signature, it decoded `%20` → ` ` (space) and expected the signature to match `stock market`, but our signature was computed for `stock+market` (with a literal plus character).

Result: **Signature mismatch → 401 Unauthorized**

---

## Solution

**Fix:** Replace `+` with `%20` in all query strings before making API requests

**Implementation:**

1. Added helper method `encodeQueryString()` to XAPIClient class
2. Updated all methods using `URLSearchParams` to use the helper
3. Ensures RFC 3986 compliant encoding for OAuth signatures

```javascript
// Before (broken):
const params = new URLSearchParams(paramObj);
const fullUrl = `${url}?${params}`;

// After (fixed):
const fullUrl = `${url}?${this.encodeQueryString(paramObj)}`;

// Helper method:
encodeQueryString(params) {
  return new URLSearchParams(params).toString().replace(/\+/g, '%20');
}
```

**Files modified:**

- `src/x-client.js` (9 locations updated)

---

## Testing

Queries verified after fix:

- ✅ "stock market" → 200 OK
- ✅ "blue origin" → 200 OK
- ✅ "$RKLB" → 200 OK (no spaces, already working)

---

## Impact

**Before:**

- Tommy's content discovery degraded
- Specific high-value queries failing
- Missing market intelligence on key topics

**After:**

- Full query support restored
- All X API searches working correctly
- OAuth signature validation passing

---

## Prevention

- X API has been tightening OAuth validation enforcement
- Always use RFC 3986 encoding (`%20` for spaces) for OAuth-signed requests
- Test with queries containing special characters (spaces, `+`, `&`, etc.)
- Monitor X API changelogs for authentication changes

---

## References

- **Issue:** NOVA-361
- **PR:** (pending)
- **Root cause identified by:** Developer agent dev-9e7c0b49 (2026-02-22)
- **Fix implemented by:** Nova (2026-02-22)
- **RFC 3986:** https://datatracker.ietf.org/doc/html/rfc3986#section-2.1
- **OAuth 1.0a spec:** https://datatracker.ietf.org/doc/html/rfc5849
