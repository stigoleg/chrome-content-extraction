import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const TARGETS = new Set(["chrome", "firefox", "all"]);

function parseTarget(argv) {
  const targetArg = argv.find((arg) => arg.startsWith("--target="));
  const target = targetArg ? targetArg.split("=")[1] : "all";
  if (!TARGETS.has(target)) {
    throw new Error(`Unsupported target "${target}". Use chrome, firefox, or all.`);
  }
  return target;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * @param {Record<string, any>} manifest
 * @param {"chrome"|"firefox"} target
 * @returns {string[]}
 */
export function validateManifestForTarget(manifest, target) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest.json is not a valid JSON object."];
  }

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version must be 3 (found ${manifest.manifest_version ?? "missing"}).`);
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const hasOffscreenPermission = permissions.includes("offscreen");

  if (target === "chrome" && !hasOffscreenPermission) {
    errors.push('Chrome manifest must include "offscreen" permission.');
  }

  if (target === "firefox" && hasOffscreenPermission) {
    errors.push('Firefox manifest must not include "offscreen" permission.');
  }

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const contentScriptFiles = new Set(
    contentScripts.flatMap((entry) => (Array.isArray(entry?.js) ? entry.js : []))
  );
  if (contentScriptFiles.has("src/content.js")) {
    const requiredModuleResources = [
      "src/content-main.js",
      "src/content-metadata.js",
      "src/bubble-settings.js",
      "src/url-helpers.js"
    ];
    const webAccessibleEntries = Array.isArray(manifest.web_accessible_resources)
      ? manifest.web_accessible_resources
      : [];
    const exposedResources = new Set(
      webAccessibleEntries.flatMap((entry) => (Array.isArray(entry?.resources) ? entry.resources : []))
    );

    for (const resource of requiredModuleResources) {
      if (!exposedResources.has(resource)) {
        errors.push(
          `Manifest missing web_accessible_resources entry for "${resource}" required by content script bootstrap.`
        );
      }
    }
  }

  return errors;
}

/**
 * @param {{ target?: "chrome"|"firefox"|"all"; distDir?: string }} [options]
 */
export async function validateBuildOutputs(options = {}) {
  const target = options.target || "all";
  const distDir = options.distDir || DIST_DIR;
  const targets = target === "all" ? ["chrome", "firefox"] : [target];
  const errors = [];

  for (const currentTarget of targets) {
    const targetDir = path.join(distDir, currentTarget);
    const manifestPath = path.join(targetDir, "manifest.json");
    if (!(await exists(targetDir))) {
      errors.push(`Missing output directory: ${path.relative(ROOT_DIR, targetDir)}`);
      continue;
    }
    if (!(await exists(manifestPath))) {
      errors.push(`Missing manifest: ${path.relative(ROOT_DIR, manifestPath)}`);
      continue;
    }

    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      errors.push(
        `Invalid manifest JSON for ${currentTarget}: ${error?.message || "parse error"}`
      );
      continue;
    }

    for (const issue of validateManifestForTarget(manifest, /** @type {"chrome"|"firefox"} */ (currentTarget))) {
      errors.push(`${currentTarget}: ${issue}`);
    }
  }

  const requiredZips = [];
  if (target === "all" || target === "chrome") {
    requiredZips.push("context-capture-saver-chrome.zip", "context-capture-saver.zip");
  }
  if (target === "all" || target === "firefox") {
    requiredZips.push("context-capture-saver-firefox.zip");
  }

  for (const zipName of requiredZips) {
    const zipPath = path.join(distDir, zipName);
    if (!(await exists(zipPath))) {
      errors.push(`Missing build artifact: ${path.relative(ROOT_DIR, zipPath)}`);
    }
  }

  if (errors.length > 0) {
    const detail = errors.map((issue) => `- ${issue}`).join("\n");
    throw new Error(`Build validation failed with ${errors.length} issue(s):\n${detail}`);
  }

  return {
    ok: true,
    target,
    validatedTargets: targets
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = parseTarget(process.argv.slice(2));
  validateBuildOutputs({ target })
    .then((result) => {
      console.log(
        `Build validation passed for target "${result.target}" (${result.validatedTargets.join(", ")}).`
      );
    })
    .catch((error) => {
      console.error(error?.message || String(error));
      process.exitCode = 1;
    });
}
