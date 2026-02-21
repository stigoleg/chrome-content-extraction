import test from "node:test";
import assert from "node:assert/strict";

import {
  describeRuntimeCapabilities,
  getClipboardFallbackGuidance,
  getPdfFallbackGuidance,
  supportsOffscreenApi
} from "../src/runtime-capabilities.js";

test("supportsOffscreenApi detects offscreen availability", () => {
  const supported = {
    offscreen: {
      createDocument() {},
      hasDocument() {}
    }
  };
  const unsupported = {
    offscreen: {
      createDocument() {}
    }
  };

  assert.equal(supportsOffscreenApi(supported), true);
  assert.equal(supportsOffscreenApi(unsupported), false);
  assert.equal(supportsOffscreenApi(null), false);
});

test("describeRuntimeCapabilities returns stable capability flags", () => {
  const capabilities = describeRuntimeCapabilities({
    offscreen: {
      createDocument() {},
      hasDocument() {}
    }
  });
  assert.deepEqual(capabilities, { offscreen: true });
});

test("fallback guidance messages are non-empty", () => {
  assert.equal(getClipboardFallbackGuidance().length > 10, true);
  assert.equal(getPdfFallbackGuidance().length > 10, true);
});
