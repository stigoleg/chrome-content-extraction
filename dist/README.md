# Context Capture Saver

Save web content, highlights, PDF text, and YouTube transcripts to your own local folder.

This extension is built for people who research online and want clean, structured captures they can keep, search, and process later.

## What You Can Do

- Save full page captures from normal websites.
- Save with or without notes.
- Queue multiple highlights before saving.
- Capture YouTube transcripts (with optional timestamp segments).
- Capture PDF text and metadata.
- Store output as JSON files or in a local SQLite database.

## Install

### Option 1: Install from a release build (recommended)

1. Download `context-capture-saver.zip` from the latest GitHub release.
2. Unzip it on your machine.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unzipped folder.

### Option 2: Run from source

1. Clone this repository.
2. Run:

```bash
npm ci
npm run build
```

3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select `dist/`.

## First-Time Setup

1. Open extension options.
2. Click **Choose folder** and select where captures should be stored.
3. (Optional) Click **Test write** to confirm access.
4. (Optional) Choose:
   - JSON or SQLite storage
   - compression behavior for large text
   - folder organization by date/type

## Usage

### Website capture

- Right-click page or selected text:
  - **Save content**
  - **Save with note**
  - **Add highlight**
  - **Add highlight and note**

Highlights are queued and shown in the notes panel. Click **Save** to write one combined capture.

### YouTube transcript capture

On YouTube video pages:

- **Save YouTube transcript**
- **Save transcript with note**

Transcript storage mode (in settings):

- `documentText` only
- `transcriptSegments` only
- both

### PDF capture

- PDF text and metadata are extracted and saved.
- For many PDFs, right-click highlight actions work reliably.
- Chrome's native PDF viewer can block inline overlay injection, so the floating bubble menu may not appear in some PDF tabs.

## Keyboard Shortcuts

- macOS:
  - `Shift + Command + D` save content
  - `Shift + Command + C` save with note
- Windows/Linux:
  - `Ctrl + Shift + D` save content
  - `Ctrl + Shift + C` save with note

## Output Format

Each capture includes:

- source URL and title
- capture timestamp (`savedAt`)
- extracted content (`documentText` or `documentTextParts`)
- annotations (`selectedText`, `comment`, `createdAt`) when present
- diagnostics fields for traceability

## Privacy

- Data is saved to a local folder you explicitly choose.
- No cloud sync is required.
- The extension does not need an external backend service to store captures.

## Troubleshooting

- **No files saved**
  - Re-open options and re-select your folder.
  - Ensure folder permission is granted.
- **YouTube transcript unavailable**
  - Some videos do not expose transcript/caption data.
  - Capture still saves diagnostics for debugging.
- **PDF bubble menu missing**
  - Use right-click highlight actions (`Add highlight`, `Add highlight and note`) as fallback in Chrome's built-in PDF viewer.

## Development

```bash
npm ci
npm run check
npm run typecheck
npm run test:ci
npm run build
```

## CI/CD

- CI runs syntax checks, type checks, tests, build, and dependency audit.
- Release pipeline runs on tags like `v1.0.0` and publishes:
  - `context-capture-saver.zip`
  - SHA256 checksum
