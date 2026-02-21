import test from "node:test";
import assert from "node:assert/strict";

import { isRetryableWriteError, writeFileHandleWithRetry } from "../src/write-retry.js";

test("writeFileHandleWithRetry retries transient write errors and succeeds", async () => {
  let writeAttempts = 0;
  const fileHandle = {
    async createWritable() {
      return {
        async write() {
          writeAttempts += 1;
          if (writeAttempts === 1) {
            const error = new Error("temporary lock, try again");
            error.name = "NoModificationAllowedError";
            throw error;
          }
        },
        async close() {}
      };
    }
  };

  const result = await writeFileHandleWithRetry(fileHandle, "payload", {
    target: "capture.json",
    maxAttempts: 3,
    baseDelayMs: 0
  });

  assert.equal(result.attempts, 2);
  assert.equal(writeAttempts, 2);
});

test("writeFileHandleWithRetry does not retry non-retryable errors", async () => {
  let writeAttempts = 0;
  const fileHandle = {
    async createWritable() {
      return {
        async write() {
          writeAttempts += 1;
          const error = new Error("permission denied");
          error.name = "NotAllowedError";
          throw error;
        },
        async close() {}
      };
    }
  };

  await assert.rejects(
    () =>
      writeFileHandleWithRetry(fileHandle, "payload", {
        target: "capture.sqlite",
        maxAttempts: 3,
        baseDelayMs: 0
      }),
    /permission denied/i
  );
  assert.equal(writeAttempts, 1);
});

test("writeFileHandleWithRetry composes write and close failures clearly", async () => {
  const fileHandle = {
    async createWritable() {
      return {
        async write() {
          throw new Error("write failed hard");
        },
        async close() {
          throw new Error("close failed hard");
        }
      };
    }
  };

  await assert.rejects(
    () =>
      writeFileHandleWithRetry(fileHandle, "payload", {
        target: "broken.json",
        maxAttempts: 1,
        baseDelayMs: 0
      }),
    /Failed while writing broken\.json: write failed hard\. Also failed to close stream: close failed hard\./i
  );
});

test("isRetryableWriteError detects code/name/message retryable markers", () => {
  const codeError = /** @type {Error & { code?: string }} */ (new Error("busy"));
  codeError.code = "EBUSY";
  assert.equal(isRetryableWriteError(codeError), true);

  const nameError = new Error("network timeout");
  nameError.name = "TimeoutError";
  assert.equal(isRetryableWriteError(nameError), true);

  const messageError = new Error("filesystem temporarily unavailable");
  assert.equal(isRetryableWriteError(messageError), true);

  const nonRetryable = new Error("permission denied");
  nonRetryable.name = "NotAllowedError";
  assert.equal(isRetryableWriteError(nonRetryable), false);
});
