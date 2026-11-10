import { describe, expect, it } from "vitest";
import { H3Event, handleCacheHeaders } from "../../src/index.ts";
import { isPreconditionFailed, matchETagStrong } from "../../src/utils/internal/cache.ts";

describe("handleCacheHeaders", () => {
  for (const method of ["OPTIONS", "TRACE", "CONNECT"]) {
    for (const override of [false, true]) {
      it(`ignores conditional headers for ${method} (override: ${override})`, () => {
        const req = new Request("http://localhost/", {
          headers: override
            ? {}
            : {
                "if-none-match": '"v1"',
                "if-modified-since": "Fri, 01 Jan 2021 00:00:00 GMT",
              },
        });
        Object.defineProperty(req, "method", { value: method });
        const event = new H3Event(req);
        event.res.status = 202;
        const stop = handleCacheHeaders(event, {
          etag: '"v1"',
          modifiedTime: new Date("2021-01-01"),
          ifNoneMatch: override ? '"v1"' : undefined,
          ifModifiedSince: override ? "Fri, 01 Jan 2021 00:00:00 GMT" : undefined,
        });
        expect(stop).toBe(false);
        expect(event.res.status).toBe(202);
        expect(event.res.headers.get("etag")).toBe('"v1"');
        expect(event.res.headers.get("last-modified")).toBe("Fri, 01 Jan 2021 00:00:00 GMT");
        expect(event.res.headers.get("cache-control")).toBe("public");
      });
    }
  }
});

describe("matchETagStrong", () => {
  it("matches wildcard * to any representation", () => {
    expect(matchETagStrong("*", '"123"')).toBe(true);
    expect(matchETagStrong("*", 'W/"123"')).toBe(true);
  });

  it("matches strong ETag against exact strong tag", () => {
    expect(matchETagStrong('"123"', '"123"')).toBe(true);
    expect(matchETagStrong('"123", "456"', '"456"')).toBe(true);
    expect(matchETagStrong('"123"', '"456"')).toBe(false);
  });

  it("never matches weak representation or weak tag in If-Match", () => {
    expect(matchETagStrong('W/"123"', '"123"')).toBe(false);
    expect(matchETagStrong('"123"', 'W/"123"')).toBe(false);
    expect(matchETagStrong('W/"123"', 'W/"123"')).toBe(false);
  });
});

describe("isPreconditionFailed", () => {
  it("returns true when If-Match fails strong comparison", () => {
    const headers = new Headers({ "if-match": '"stale"' });
    expect(isPreconditionFailed(headers, { etag: '"fresh"' })).toBe(true);
  });

  it("returns false when If-Match matches strong ETag", () => {
    const headers = new Headers({ "if-match": '"fresh"' });
    expect(isPreconditionFailed(headers, { etag: '"fresh"' })).toBe(false);
  });

  it("evaluates If-Unmodified-Since when If-Match is absent", () => {
    const mtime = new Date("2026-01-01T12:00:00Z");
    const past = new Headers({ "if-unmodified-since": "2026-01-01T11:00:00Z" });
    const exact = new Headers({ "if-unmodified-since": "2026-01-01T12:00:00Z" });
    const future = new Headers({ "if-unmodified-since": "2026-01-01T13:00:00Z" });

    expect(isPreconditionFailed(past, { lastModified: mtime })).toBe(true);
    expect(isPreconditionFailed(exact, { lastModified: mtime })).toBe(false);
    expect(isPreconditionFailed(future, { lastModified: mtime })).toBe(false);
  });

  it("ignores If-Unmodified-Since when If-Match is present", () => {
    const mtime = new Date("2026-01-01T12:00:00Z");
    const headers = new Headers({
      "if-match": '"fresh"',
      "if-unmodified-since": "2026-01-01T11:00:00Z",
    });
    expect(isPreconditionFailed(headers, { etag: '"fresh"', lastModified: mtime })).toBe(false);
  });
});
