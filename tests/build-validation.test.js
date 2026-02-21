import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";

import {
  validateBuildOutputs,
  validateManifestForTarget
} from "../scripts/validate-build.mjs";

test("validateManifestForTarget enforces target-specific offscreen permissions", () => {
  const chromeManifest = {
    manifest_version: 3,
    permissions: ["storage", "offscreen"],
    content_scripts: [{ js: ["src/content.js"] }],
    web_accessible_resources: [
      {
        resources: [
          "src/content-main.js",
          "src/content-metadata.js",
          "src/bubble-settings.js",
          "src/url-helpers.js"
        ],
        matches: ["<all_urls>"]
      }
    ]
  };
  assert.deepEqual(validateManifestForTarget(chromeManifest, "chrome"), []);

  const firefoxManifest = {
    manifest_version: 3,
    permissions: ["storage"],
    content_scripts: [{ js: ["src/content.js"] }],
    web_accessible_resources: [
      {
        resources: [
          "src/content-main.js",
          "src/content-metadata.js",
          "src/bubble-settings.js",
          "src/url-helpers.js"
        ],
        matches: ["<all_urls>"]
      }
    ]
  };
  assert.deepEqual(validateManifestForTarget(firefoxManifest, "firefox"), []);

  const invalidFirefox = {
    manifest_version: 3,
    permissions: ["storage", "offscreen"],
    content_scripts: [{ js: ["src/content.js"] }],
    web_accessible_resources: [
      {
        resources: [
          "src/content-main.js",
          "src/content-metadata.js",
          "src/bubble-settings.js",
          "src/url-helpers.js"
        ],
        matches: ["<all_urls>"]
      }
    ]
  };
  assert.equal(validateManifestForTarget(invalidFirefox, "firefox").length > 0, true);

  const missingBootstrapResource = {
    manifest_version: 3,
    permissions: ["storage", "offscreen"],
    content_scripts: [{ js: ["src/content.js"] }],
    web_accessible_resources: [
      {
        resources: ["src/content-main.js"],
        matches: ["<all_urls>"]
      }
    ]
  };
  assert.equal(
    validateManifestForTarget(missingBootstrapResource, "chrome").some((issue) =>
      issue.includes('src/content-metadata.js')
    ),
    true
  );
});

test("validateBuildOutputs checks required structure and zip artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ccs-build-validate-"));
  const distDir = path.join(tempRoot, "dist");
  try {
    const chromeDir = path.join(distDir, "chrome");
    const firefoxDir = path.join(distDir, "firefox");
    await mkdir(chromeDir, { recursive: true });
    await mkdir(firefoxDir, { recursive: true });

    await writeFile(
      path.join(chromeDir, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        permissions: ["offscreen"],
        content_scripts: [{ js: ["src/content.js"] }],
        web_accessible_resources: [
          {
            resources: [
              "src/content-main.js",
              "src/content-metadata.js",
              "src/bubble-settings.js",
              "src/url-helpers.js"
            ],
            matches: ["<all_urls>"]
          }
        ]
      })
    );
    await writeFile(
      path.join(firefoxDir, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        permissions: [],
        content_scripts: [{ js: ["src/content.js"] }],
        web_accessible_resources: [
          {
            resources: [
              "src/content-main.js",
              "src/content-metadata.js",
              "src/bubble-settings.js",
              "src/url-helpers.js"
            ],
            matches: ["<all_urls>"]
          }
        ]
      })
    );

    for (const zipName of [
      "context-capture-saver-chrome.zip",
      "context-capture-saver-firefox.zip",
      "context-capture-saver.zip"
    ]) {
      await writeFile(path.join(distDir, zipName), "zip");
    }

    const result = await validateBuildOutputs({ target: "all", distDir });
    assert.equal(result.ok, true);

    await rm(path.join(distDir, "context-capture-saver-firefox.zip"));
    await assert.rejects(
      () => validateBuildOutputs({ target: "all", distDir }),
      /Missing build artifact:/
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
