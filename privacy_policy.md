# Privacy Policy for Context Capture Saver

Last updated: 2026-02-21

## Summary

Context Capture Saver is a browser extension that lets you save selected text, page context, and related metadata for your own use. The extension is designed to work without collecting or selling user data. Captures and settings are stored locally on your device.

## Data We Collect

Context Capture Saver does not collect user data for the developer or any third party.

The extension does not:
- send your data to external servers
- sell or share your data with third parties
- use analytics, tracking pixels, or advertising identifiers
- create user profiles

## Data Processed on Your Device

To perform the features you trigger, the extension may process the following data locally:

### Captured content
When you use the extension to save something, it may store:
- selected text (or text you explicitly choose to capture)
- the page URL and page title
- timestamp of the capture
- optional notes you add
- optional context such as nearby text or a structured page extract, depending on your chosen capture type

### Settings and preferences
The extension stores configuration locally, such as:
- feature toggles and UI preferences
- storage mode selection
- other operational settings required for the extension to function

### Clipboard access (only when needed)
In some contexts (for example certain PDFs or embedded content), the extension may not be able to read the selection reliably. If you trigger a capture and selection cannot be read, the extension may read clipboard text as a fallback to capture the text you already copied.

Clipboard reading is not performed continuously and is not used unless you initiate a capture action.

### PDF and page extraction
When you capture from PDFs or webpages, the extension may parse page content locally in order to extract text for saving. This happens only when you initiate a capture.

## Permissions and Why They Are Needed

The extension requests permissions to enable user initiated capture features:

- **activeTab**: Access the current tab only when you trigger a capture action.
- **contextMenus**: Provide right click menu actions for saving content.
- **scripting**: Run small scripts in the current page to read selection or extract content when you request it.
- **offscreen**: Use an offscreen document to support MV3 technical requirements for PDF and certain extraction workflows.
- **clipboardRead**: Fallback to capture text you copied when selection cannot be read in the page context.
- **storage**: Store settings and operational state locally.
- **Host permissions (all sites)**: The extension must work on whatever site you choose to capture from. Access is used only when you initiate a capture.

## Where Your Data Is Stored

All captures and settings are stored locally on your device. Depending on your configuration, this may include:
- local browser storage for settings and small state
- local files in a folder you choose for saved captures

The extension does not require an account.

## Data Sharing

The extension does not share your data with the developer or any third party. No external transmission is performed as part of normal operation.

## Data Retention and Deletion

All data is stored locally under your control.

You can delete your data at any time by:
- removing the saved capture files from the configured folder
- clearing extension storage from the browser extension settings
- uninstalling the extension, which removes extension storage

## Security

The extension is built to minimize data access and only processes content when you initiate a capture. Because data is stored locally, you are responsible for protecting access to your device and any folders you select for saving captures.

## Children’s Privacy

Context Capture Saver is not intended for children and does not knowingly collect personal information from children.

## Changes to This Policy

If this policy changes, the "Last updated" date will be updated. Material changes will be reflected in the published policy and, when applicable, in extension release notes.

## Contact

If you have questions about this policy, contact:
- GitHub repository: https://github.com/stigoleg/Context-Capture-Saver