# Contributing to Recall

Thanks for helping improve Recall. Small, focused changes are easier to review and safer for an extension that stores revision history locally.

## Set up a development checkout

1. Fork the repository on GitHub and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/Recall.git
   cd Recall
   ```

2. Install the locked dependency set:

   ```bash
   npm ci
   ```

3. Create a feature branch from the latest `main`:

   ```bash
   git switch -c feature/short-description
   ```

## Run checks

Run the full local check set before opening a pull request:

```bash
npm test
npm run lint
npm run build
```

Tests use Node's built-in `node:test` runner and live beside the pure logic modules in `src/lib/`. Add or update tests when changing tracking, importing, scheduling, or pattern-selection behavior. Load the generated `dist/` directory as an unpacked extension for manual popup or LeetCode testing when a change affects browser behavior.

## Pull requests

- Keep each pull request limited to one coherent topic.
- Explain the behavior change and list the checks you ran.
- Update the README or other documentation when user-visible behavior, permissions, installation, or privacy details change.
- Do not add dependencies without a clear need.
- Do not intentionally change revision scheduling semantics, daily pattern selection, import behavior, or Remembered/Forgotten intervals without updating the relevant tests and documentation.
- Never commit secrets, `.env` files, `node_modules/`, generated `dist/`, or local backup files.

Push your branch and open a pull request targeting `main`. Use the repository pull request template and include manual browser-testing details when relevant.

## Issues and security

Use the provided issue templates for bugs and feature requests. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
