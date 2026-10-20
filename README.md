# Recall

**A Chrome extension that remembers the LeetCode problems you have already solved — so you can actually remember them.**

Solving a problem once is easy to forget. Recall automatically tracks every **Accepted** LeetCode submission in your browser, keeps a local history of what you solved and when, and (coming next) tells you which problems you should revise today.

## Problem

Most people solve LeetCode problems and never see them again. Spaced revision is the part everyone skips: you forget patterns, re-solve the same easy problems, and lose track of what you actually know. Recall automates the bookkeeping so revision can happen.

## Current features

- **Automatic submission tracking** — a content script watches LeetCode problem pages; when you click **Submit** and the verdict is exactly `Accepted`, the problem is recorded automatically. No buttons to click.
- **Duplicate prevention** — one record per problem; re-solving updates `lastAcceptedAt` but preserves `firstSolvedAt`.
- **Local-only storage** — everything lives in `chrome.storage.local`. No accounts, no server, no telemetry. Your data never leaves your browser.
- **Clean data model** — each record stores `problemId` (slug), `title`, normalized `url`, `difficulty`, `firstSolvedAt`, `lastAcceptedAt`, `revisionHistory`, and `nextRevisionAt` (reserved for the scheduler).

## Technology stack

- React 19 + Vite 8 (popup UI scaffold)
- Chrome Extension Manifest V3
- Vanilla JS content script (bundled by Vite)
- `chrome.storage.local`
- ESLint, `node:test` (no test framework dependency)

## Prerequisites

- Node.js 20.19+ / 22.12+ (developed and tested on Node 24)
- npm
- Google Chrome (or any Chromium browser)

## Installation (for developers)

```bash
git clone https://github.com/PrayasP29/Recall.git
cd Recall
npm install
```

## Building the extension

```bash
npm run build
```

This produces a ready-to-load extension in `dist/` (`manifest.json`, `content.js`, and the popup app).

## Loading the extension in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `dist/` folder.
5. Visit any [LeetCode problem](https://leetcode.com/problems/two-sum/), solve it, and click **Submit**.
6. After an **Accepted** verdict, open the extension popup → right-click → *Inspect* → console:
   `chrome.storage.local.get(null, r => console.log(r))`
   You should see the problem under the `problems` key.

## Testing

```bash
npm test    # unit tests for the tracking logic (node:test, no extra deps)
npm run lint
```

The unit tests cover verdict classification, URL normalization, slug extraction, and the first-solve / re-solve / duplicate storage behavior.

## Current limitations

- **The popup UI is still the Vite starter scaffold** — tracking works, but there is no UI to browse your solved problems yet.
- **Revision calendar and daily recommendations are not implemented.** `nextRevisionAt` exists in the data model but stays `null` until the scheduler lands.
- **No extension icons yet** (Chrome shows the default puzzle icon).
- **Submission detection is DOM-based.** It requires an actual Submit click and an exact `Accepted` verdict text (verified on live LeetCode, but LeetCode's UI can change).
- Title/difficulty capture is best-effort and may be `null` if LeetCode changes its page data.
- Not published to the Chrome Web Store.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: fork → feature branch → tests/lint/build green → pull request. Never commit directly to `main`.

## Planned features

- **Revision calendar** — a calendar of solved problems with scheduled revision dates.
- **Daily revision recommendations** — spaced-repetition scheduling; you mark each problem as *remembered* or *forgot*, and future dates adjust.
- **Support Recall button** — an external, voluntary-contribution page (Razorpay for eligible Indian users, GitHub Sponsors for international supporters). Payments stay fully external: no checkout, accounts, or payment backend inside the extension.
- Real popup UI for browsing your history.

## License

[MIT](LICENSE) © Prayas P29
