# Contributing to Recall

Thanks for helping! This project is small on purpose — keep it that way.

## Workflow

1. **Fork** the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/Recall.git
   cd Recall
   ```

2. **Create a feature branch** from `main`. Never work on `main` directly:

   ```bash
   git checkout -b feature/your-feature-name   # or fix/bug-name
   ```

3. **Install dependencies**:

   ```bash
   npm install
   ```

4. **Make your change**, then verify everything before committing:

   ```bash
   npm test
   npm run lint
   npm run build
   ```

   All three must pass.

5. **Commit** with a clear message, then push and open a **Pull Request**:

   ```bash
   git push origin your-branch-name
   ```

## Pull request rules

- **One topic per PR.** No drive-by refactors, no unrelated formatting churn, no bundled feature + bugfix.
- Describe *what* changed and *how you tested it* (the PR template walks you through it).
- New behavior needs a test where it is practical (pure logic belongs in `src/lib/` so it can be unit-tested).
- Do not add dependencies without a good reason — prefer the standard library.
- Never commit secrets, `node_modules/`, or `dist/`.

## Reporting bugs / requesting features

Open an issue using the provided templates. For bugs: include exact steps, expected vs. actual behavior, and your Chrome/Node versions.
