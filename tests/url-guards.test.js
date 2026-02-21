import test from "node:test";
import assert from "node:assert/strict";

import { assertAllowedYouTubeFetchUrl, isAllowedYouTubeFetchUrl } from "../src/url-guards.js";

test("assertAllowedYouTubeFetchUrl accepts https youtube and googlevideo hosts", () => {
  const allowed = [
    "https://www.youtube.com/api/timedtext?v=abc",
    "https://youtube.com/api/timedtext?v=abc",
    "https://m.youtube.com/watch?v=abc",
    "https://music.youtube.com/youtubei/v1/get_transcript",
    "https://r5---sn-ab5l6nze.googlevideo.com/videoplayback?id=123"
  ];

  for (const url of allowed) {
    const normalized = assertAllowedYouTubeFetchUrl(url);
    assert.equal(typeof normalized, "string");
    assert.equal(normalized.startsWith("https://"), true);
  }
});

test("assertAllowedYouTubeFetchUrl rejects non-https urls", () => {
  assert.throws(
    () => assertAllowedYouTubeFetchUrl("http://www.youtube.com/api/timedtext?v=abc"),
    /https/i
  );
});

test("assertAllowedYouTubeFetchUrl rejects disallowed hosts", () => {
  assert.throws(
    () => assertAllowedYouTubeFetchUrl("https://example.com/api/timedtext?v=abc"),
    /host is not allowed/i
  );
});

test("assertAllowedYouTubeFetchUrl rejects invalid url input", () => {
  assert.throws(() => assertAllowedYouTubeFetchUrl("not-a-url"), /invalid fetch url/i);
  assert.throws(() => assertAllowedYouTubeFetchUrl(""), /missing fetch url/i);
  assert.throws(() => assertAllowedYouTubeFetchUrl(null), /missing fetch url/i);
});

test("isAllowedYouTubeFetchUrl returns true only for allowed urls", () => {
  assert.equal(isAllowedYouTubeFetchUrl("https://www.youtube.com/api/timedtext?v=abc"), true);
  assert.equal(isAllowedYouTubeFetchUrl("https://example.com"), false);
  assert.equal(isAllowedYouTubeFetchUrl("http://youtube.com/watch?v=abc"), false);
  assert.equal(isAllowedYouTubeFetchUrl(undefined), false);
});
