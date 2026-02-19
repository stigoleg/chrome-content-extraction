# Context Capture Saver (Chrome Extension)

This extension stores page content (selection optional) and YouTube transcript captures as JSON files or a SQLite database in a local folder you choose.

## Features

- Right-click page or selection -> **Save content**.
- Right-click page or selection -> **Save with note**.
- Right-click page or selection -> **Add highlight and note** (queue multiple highlights before saving).
- Right-click selected text -> **Add highlight** (quick queue without note).
- In-page highlights panel shows queued highlight count with a **Save** button.
- Selection bubble appears above highlighted text for quick **Add highlight** or **Add highlight and note**.
- Keyboard shortcuts:
  - **Shift+Cmd+D** on macOS (**Ctrl+Shift+D** on other platforms) to save content.
  - **Shift+Cmd+C** on macOS (**Ctrl+Shift+C** on other platforms) to save with a note.
- On YouTube pages -> right-click page -> **Save YouTube transcript** or **Save transcript with note**.
- Popup includes:
  - quick capture buttons
  - latest capture status (success/failure)
  - one-click access to settings
- Each JSON file includes:
  - full page text snapshot (`documentText`)
  - optional compressed document text (`documentTextCompressed`) for large captures
  - annotations array (`annotations`) containing `selectedText`, `comment` (note), and `createdAt` per note
  - title, URL
  - `savedAt`
  - `publishedAt` (best effort extraction)
- Storage can optionally be grouped by date and/or capture type.
- JSON folder grouping order is configurable (type → date by default).
- Folder order selection appears only when both date and type grouping are enabled.
- SQLite storage writes to `context-captures.sqlite` in the chosen folder.
- Content is never truncated; large captures can be compressed instead.
- Gzip compression is always available (built-in or bundled fallback).
- Notes queued with **Add highlight and note** are stored in `annotations` and cleared after saving.
- YouTube transcript storage mode is configurable:
  - `documentText` only (default)
  - `transcriptSegments` only (timestamped)
  - both `documentText` and `transcriptSegments`

## Extraction Coverage

The extension tries to capture structured data from a wide range of sources:

- Web pages:
  - selected text (optional)
  - full page text (`documentText`)
  - metadata fields when present:
    - `description`, `author`, `keywords`
    - canonical URL
    - site name
    - article tags (`article:tag`) and section (`article:section`)
    - article published/modified time (`article:published_time`, `article:modified_time`)
    - document content type and content language
  - published date (best effort)
- YouTube pages:
  - transcript text and segmented timestamps when available
  - video ID and transcript availability diagnostics
  - page HTML is not stored; only transcript content is captured
- PDFs:
  - extracted PDF text (all pages)
  - PDF metadata when available (title, author, subject, keywords, creator, producer)
  - page count and file size
  - annotations for highlights and notes (selection, comment, createdAt)

## Install (Load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Configure Local Folder

1. Open extension settings (Details -> Extension options).
2. Click **Choose folder** and pick your destination folder.
3. Optional: click **Test write** to confirm files are written.
4. Optional: configure large content policy:
   - max characters to store from page text
   - enable/disable gzip compression for large documents
   - choose compression threshold

## Development checks

- Syntax check: `npm run check`
- Unit tests: `npm test`
- Build: `npm run build` (outputs an unpacked extension in `dist/`)
- Build output also includes `dist/context-capture-saver.zip` for sharing or archival.

## Notes

- Chrome extensions cannot silently write to arbitrary paths; user folder selection is required.
- YouTube transcript extraction reads transcript rows from the page UI. If transcript is unavailable, a JSON file is still saved with diagnostics.
- `publishedAt` is heuristic and may be null on some pages.
- Compression uses `CompressionStream` when available in the extension runtime.
- On PDFs rendered by Chrome's built-in PDF viewer, inline bubble overlays may be unavailable due viewer frame restrictions. Use right-click selection actions as the stable fallback.
