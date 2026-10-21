# Recall

Recall is an open-source Chrome extension that helps LeetCode users revisit solved problems with spaced repetition and pattern-focused daily practice.

## Why Recall?

Solving a problem once does not make the approach permanent. Recall keeps track of accepted solutions, schedules future revisions, and turns the problems due today into a small, focused review queue.

## Features

- Tracks accepted LeetCode submissions from problem pages.
- Imports solved problems through the explicit **Sync LeetCode History** button.
- Schedules imported problems across future days instead of putting the entire history in one queue.
- Lets you mark due problems **Remembered** or **Forgotten**. Remembered reviews use consecutive intervals of 3, 7, 14, and 30 days; Forgotten reviews are due again the next day.
- Chooses a daily focus from available DSA pattern tags, with untagged or generic-tag-only problems shown under **Other**.
- Shows due and overdue questions, while future dates provide a preview of questions scheduled for that day.
- Stores problem records locally in `chrome.storage.local`.
- Uses a compact branded popup with direct links back to LeetCode problems.

## How It Works

1. Install or load the extension.
2. Open `leetcode.com` in a tab and sign in.
3. Click **Sync LeetCode History** in the Recall popup to import your solved-problem history. Sync is explicit; it does not run automatically.
4. Review the questions scheduled for today.
5. Open a problem when needed, then mark it **Remembered** or **Forgotten**.
6. Return later to continue the revision queue.

Accepted submissions on LeetCode problem pages are also tracked after a real **Submit** click and an `Accepted` result.

## Installation for Users

Recall is not currently published in the Chrome Web Store. To install a local build:

1. Follow the [development setup](#development-setup).
2. Run `npm run build`.
3. Open `chrome://extensions` in Chrome or another Chromium browser.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the repository's `dist/` directory.

## Development Setup

Prerequisites:

- Node.js 24 (the CI workflow uses Node 24)
- npm
- Chrome or another Chromium browser for manual extension testing

Install dependencies and run the checks:

```bash
npm ci
npm test
npm run lint
npm run build
```

The build writes the unpacked extension to `dist/`. The directory is generated and must not be committed. Load it through Chrome's **Load unpacked** workflow when testing the popup or content script.

## Project Structure

- `src/` — popup UI, content script, styles, assets, and application logic.
- `src/lib/` — testable tracking, importing, scheduling, and pattern-selection modules plus their `node:test` suites.
- `public/` — files copied into the extension package.
- `public/manifest.json` — Manifest V3 metadata, icons, permissions, popup entry point, and content-script registration.
- `vite.config.js` — builds the React popup and copies public extension assets.
- `vite.content.config.js` — separately bundles `src/content.js` as a classic IIFE for Manifest V3 content-script compatibility.
- `.github/` — CI, issue templates, and the pull request template.

Two Vite configurations are required because the popup can use the React module build, while Chrome content scripts must be packaged as a self-contained classic script.

## Architecture and Data

The popup reads and writes problem records in `chrome.storage.local`. A record includes the problem slug, title, URL, difficulty, topic tags, accepted-solve timestamps, revision history, and the next revision day.

The content tracker watches LeetCode problem pages for a real Submit click followed by an exact `Accepted` verdict, then records the problem. The history importer runs in the LeetCode tab when the popup sends a sync request; it paginates LeetCode's solved-problem GraphQL result, merges records by slug, and schedules newly imported problems. The revision scheduler applies the Remembered/Forgotten intervals, while the pattern module selects and groups the daily queue.

## Privacy

- Problem records are stored locally in Chrome's `chrome.storage.local`; Recall has no account system or backend.
- Recall does not include telemetry or analytics.
- On LeetCode problem pages, the content script reads the current problem URL, page title, and best-effort difficulty/topic metadata to recognize accepted submissions.
- When you explicitly click **Sync LeetCode History**, Recall reads the solved-problem list exposed by LeetCode, including slugs, titles, difficulty, and topic tags.
- The sync request reads the `csrftoken` cookie locally in the LeetCode tab and sends it as the `x-csrftoken` header only to `https://leetcode.com/graphql/`. The token is not stored or logged.
- The extension communicates with LeetCode for tracking context and history sync. It does not send problem records or usage data to any other service.
- The `storage` permission is used for local problem records. The LeetCode host permission allows the content script and the explicit history-sync request to operate on LeetCode pages.

## Limitations

- Submission detection depends on LeetCode's DOM and exact `Accepted` text, so LeetCode UI changes may require maintenance.
- Title, difficulty, and topic tags are best-effort metadata. Topic-tag retrieval may be unavailable when LeetCode does not expose the data on a page.
- History sync requires a signed-in LeetCode tab and must be started by clicking the sync button.
- Recall is not currently available through the Chrome Web Store.
- **Support Recall** is currently a disabled placeholder because `SUPPORT_URL` is not configured.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, branch, and pull request guidance.

## Security

Please see [SECURITY.md](SECURITY.md) for private vulnerability-reporting instructions. Do not disclose exploitable vulnerabilities in a public issue.

## License

Recall is available under the [MIT License](LICENSE).
