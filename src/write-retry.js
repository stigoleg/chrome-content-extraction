const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 30;
const MAX_DELAY_MS = 300;

const RETRYABLE_ERROR_NAMES = new Set([
  "AbortError",
  "InvalidStateError",
  "NoModificationAllowedError",
  "NetworkError",
  "TimeoutError",
  "UnknownError"
]);

const RETRYABLE_ERROR_CODES = new Set(["EAGAIN", "EBUSY", "ETIMEDOUT", "EINTR"]);

function normalizeAttempts(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeDelayMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_BASE_DELAY_MS;
  }
  return Math.min(MAX_DELAY_MS, Math.floor(parsed));
}

function sleep(ms) {
  if (!ms) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildWriteCloseError(target, writeError, closeError) {
  const writeMessage = writeError?.message || "write failed";
  const closeMessage = closeError?.message || "close failed";
  return new Error(
    `Failed while writing ${target}: ${writeMessage}. ` +
      `Also failed to close stream: ${closeMessage}.`
  );
}

export function isRetryableWriteError(error) {
  if (!error) {
    return false;
  }

  const code = String(error?.code || "").toUpperCase();
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const name = String(error?.name || "");
  if (name && RETRYABLE_ERROR_NAMES.has(name)) {
    return true;
  }

  const message = String(error?.message || "");
  if (!message) {
    return false;
  }
  return /(temporar|try again|busy|lock|timeout|timed out|interrupted)/i.test(message);
}

export async function writeFileHandleWithRetry(fileHandle, payload, options = {}) {
  const maxAttempts = normalizeAttempts(options.maxAttempts);
  const baseDelayMs = normalizeDelayMs(options.baseDelayMs);
  const target = String(options.target || "file");

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;

    const writable = await fileHandle.createWritable();
    let writeError = null;
    try {
      await writable.write(payload);
    } catch (error) {
      writeError = error;
    } finally {
      try {
        await writable.close();
      } catch (closeError) {
        if (writeError) {
          writeError = buildWriteCloseError(target, writeError, closeError);
        } else {
          writeError = closeError;
        }
      }
    }

    if (!writeError) {
      return { attempts: attempt };
    }
    if (attempt >= maxAttempts || !isRetryableWriteError(writeError)) {
      throw writeError;
    }
    await sleep(baseDelayMs * attempt);
  }

  return { attempts: maxAttempts };
}
