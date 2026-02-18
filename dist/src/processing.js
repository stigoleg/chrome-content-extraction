import * as pako from "./vendor/pako.mjs";

function toBase64(uint8Array) {
  let binary = "";
  for (let i = 0; i < uint8Array.length; i += 1) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

async function gzipTextToBase64(text) {
  if (typeof CompressionStream !== "function") {
    return gzipWithPako(text);
  }

  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();

  const compressedBuffer = await new Response(stream.readable).arrayBuffer();
  return toBase64(new Uint8Array(compressedBuffer));
}

function gzipWithPako(text) {
  try {
    const data = new TextEncoder().encode(text || "");
    const compressed = pako.gzip(data);
    return toBase64(compressed);
  } catch (_error) {
    return null;
  }
}

async function gzipPartsToBase64(parts) {
  if (typeof CompressionStream !== "function") {
    return gzipPartsWithPako(parts);
  }

  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  for (let i = 0; i < parts.length; i += 1) {
    const chunk = parts[i] || "";
    if (chunk) {
      writer.write(encoder.encode(chunk));
    }
    if (i < parts.length - 1) {
      writer.write(encoder.encode("\n\n"));
    }
  }

  writer.close();
  const compressedBuffer = await new Response(stream.readable).arrayBuffer();
  return toBase64(new Uint8Array(compressedBuffer));
}

function gzipPartsWithPako(parts) {
  try {
    const encoder = new TextEncoder();
    const GzipCtor = /** @type {any} */ (pako).Gzip;
    if (!GzipCtor) {
      return gzipWithPako(parts.join("\n\n"));
    }
    const gzip = new GzipCtor();
    for (let i = 0; i < parts.length; i += 1) {
      const chunk = parts[i] || "";
      if (chunk) {
        gzip.push(encoder.encode(chunk), false);
      }
      if (i < parts.length - 1) {
        gzip.push(encoder.encode("\n\n"), false);
      }
    }
    gzip.push(new Uint8Array(0), true);
    if (gzip.err) {
      return null;
    }
    return toBase64(gzip.result);
  } catch (_error) {
    return null;
  }
}

 

export async function applyContentPolicies(record, settings) {
  const next = {
    ...(record || {})
  };
  const diagnostics = {
    ...(record?.diagnostics || {})
  };
  const content = {
    ...(record?.content || {})
  };
  const hasParts = Array.isArray(content.documentTextParts);
  const originalDocumentText = content.documentText || "";
  const originalPartsLength = hasParts
    ? content.documentTextParts.reduce((total, part) => total + (part ? part.length : 0), 0)
    : 0;
  const originalLength = originalDocumentText.length || originalPartsLength;

  diagnostics.contentPolicies = {
    maxDocumentChars: settings.maxDocumentChars,
    compressLargeText: settings.compressLargeText,
    compressionThresholdChars: settings.compressionThresholdChars,
    documentTextOriginalLength: originalLength,
    documentTextStoredLength: originalLength,
    truncated: false,
    compressed: false,
    compressionType: null,
    compressionError: null
  };

  const currentText = content.documentText || "";
  const currentLength = currentText.length || originalPartsLength;
  const shouldCompress =
    settings.compressLargeText &&
    settings.compressionThresholdChars > 0 &&
    currentLength > settings.compressionThresholdChars;

  if (shouldCompress) {
    try {
      const compressedBase64 = hasParts
        ? await gzipPartsToBase64(content.documentTextParts)
        : await gzipTextToBase64(currentText);
      if (compressedBase64) {
        content.documentTextCompressed = {
          algorithm: "gzip+base64",
          value: compressedBase64,
          originalLength: currentLength
        };
        diagnostics.contentPolicies.compressed = true;
        diagnostics.contentPolicies.compressionType = "gzip+base64";
        diagnostics.contentPolicies.documentTextStoredLength = currentLength;
      } else {
        diagnostics.contentPolicies.compressionError = "CompressionStream unavailable";
      }
    } catch (error) {
      diagnostics.contentPolicies.compressionError = error?.message || "Compression failed";
    }
  }

  if (hasParts && (!content.documentText || content.documentText.length === 0)) {
    content.documentText = content.documentTextParts.join("\n\n");
    if (!diagnostics.contentPolicies.documentTextStoredLength) {
      diagnostics.contentPolicies.documentTextStoredLength = content.documentText.length;
    }
  }

  if (hasParts) {
    delete content.documentTextParts;
  }

  next.content = content;
  next.diagnostics = diagnostics;
  return next;
}
