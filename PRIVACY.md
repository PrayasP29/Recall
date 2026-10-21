# Recall Privacy Policy

**Last updated: October 21, 2026**

## 1. Overview

Recall is an open-source Chrome extension that helps LeetCode users review solved problems using spaced repetition. This policy describes what Recall accesses, how it uses that information, and where the information is stored.

Recall is designed to keep problem records in the browser. It does not provide an account system or a Recall-owned backend.

## 2. Information Recall Accesses

Recall accesses the following information while running:

- The current LeetCode problem page URL, including its problem slug.
- The page title and, when available in the page data, the problem title, difficulty, and topic tags.
- The exact visible submission result needed to recognize an `Accepted` verdict.
- For an accepted submission, a locally generated timestamp and the problem metadata described above.
- When the user starts **Sync LeetCode History**, the solved-problem information returned by LeetCode, including problem slugs, titles, difficulty values, and topic tags.
- Existing Recall records, including accepted-solve timestamps, revision dates, revision history, and problem metadata.

Recall does not intentionally read solution source code, passwords, or payment information.

## 3. How Recall Uses Information

Recall uses this information to:

- Recognize a real **Submit** action followed by an observable exact `Accepted` verdict on a LeetCode problem page.
- Add or update one local record for the accepted problem without creating duplicates.
- Import and schedule existing solved problems when the user explicitly clicks **Sync LeetCode History**.
- Calculate revision dates and display due, overdue, and scheduled problems in the popup.
- Preserve review history when the user marks a problem **Remembered** or **Forgotten**.

Automatic accepted-submission tracking and full history synchronization are separate features. Recall does not automatically synchronize the user's entire LeetCode account history in the background, and it does not run a full history import after every accepted submission.

## 4. Local Storage and Data Retention

Problem records are stored in the browser using `chrome.storage.local`. The Manifest V3 service worker is the single storage authority for accepted submissions, history merges, review actions, and record migration. Popup and content-script code send messages to the service worker rather than writing problem records directly.

Stored records can include:

- Problem slug, title, URL, difficulty, and topic tags.
- `firstSolvedAt` and `lastAcceptedAt` timestamps.
- Revision dates and revision history.
- Import and scheduling metadata used by Recall.

Recall has no code that sends these records to a Recall-owned server. It also has no user-facing delete-record feature in the current implementation. The code does not explicitly clear records when the extension is uninstalled; browser-managed extension storage behavior may determine what happens to extension data at removal. Recall cannot make promises about browser backups, profiles, or other copies outside the extension's code.

## 5. LeetCode and External Services

LeetCode is an external service. When the user explicitly starts history synchronization, Recall makes authenticated `POST` requests to:

`https://leetcode.com/graphql/`

The request uses LeetCode's `userProgressQuestionList` GraphQL query with a `SOLVED` question-status filter and paginates the returned results. The request uses the user's existing LeetCode browser session.

To make that request, the content script reads the `csrftoken` cookie from the current LeetCode page and sends it as the `x-csrftoken` request header to LeetCode's GraphQL endpoint. Recall does not store or log the token. Recall does not send the token to Recall or to another service.

Automatic accepted-submission tracking does not perform a full history request. It reads the current page context, then sends a message inside the extension to the Recall service worker. The service worker updates local storage.

Recall also creates ordinary links to LeetCode problem pages when the user chooses to open a problem. Those navigations are to LeetCode and are subject to LeetCode's own policies.

## 6. Data Sharing

Recall does not sell, rent, or share problem records with the project maintainer or another third party through a Recall server. There is no Recall-owned server in the current implementation.

Information is sent to LeetCode when Recall performs the user-requested history synchronization described above. LeetCode may process requests according to its own privacy policy and terms. Browser, operating-system, and extension-management features may also have their own handling of locally stored data; those behaviors are outside Recall's control.

## 7. Analytics and Advertising

Recall has no analytics, telemetry, advertising, tracking pixels, or account registration flow in the current implementation.

## 8. Permissions

Recall requests these permissions:

- **`storage`** — stores problem records and revision history in `chrome.storage.local`.
- **`https://leetcode.com/*` host permission** — injects the content script on LeetCode pages so Recall can observe accepted-submission results, communicate with the popup and service worker, and perform the user-requested LeetCode history GraphQL request in the logged-in LeetCode page context.

Recall does not request a general `tabs` permission, broad web access, or permissions for unrelated websites.

## 9. Security

Recall validates messages received by the service worker before changing stored problem records. Storage-changing operations are serialized in the service worker to reduce conflicts between accepted-submission tracking, history synchronization, migration, and review actions.

These measures do not make browser storage completely secure. Anyone or any software with access to the relevant browser profile or extension environment may potentially access locally stored data. Recall does not claim to protect against compromise of the browser, operating system, LeetCode account, or device.

Recall does not log or store the `csrftoken` used for the explicit history request. Automatic tracking depends on LeetCode's page structure and an observable exact `Accepted` result; a missed result can require a later manual history sync.

## 10. User Choices and Data Deletion

You choose whether to:

- Install or remove Recall.
- Open LeetCode pages where the content script runs.
- Click **Sync LeetCode History**.
- Use the automatic accepted-submission tracking flow by submitting solutions on pages where Recall is active.

You can avoid the history request by not clicking **Sync LeetCode History**. You can also disable or remove the extension through Chrome's extension settings.

The current UI does not provide a button to delete one problem record or clear all Recall records. Recall does not delete data from LeetCode. If you remove the extension, Chrome controls the lifecycle of extension-owned storage; Recall has no uninstall handler that explicitly erases it, and this policy does not promise removal of browser backups, synchronized browser data, or other copies.

## 11. Children's Privacy

Recall is a general-purpose developer project and is not directed specifically at children. The current implementation does not intentionally collect information through an account or backend. If you believe a child has provided information through a context not described here, please contact the project through its GitHub repository.

## 12. Changes to This Policy

This policy may be updated when Recall's implementation, permissions, data flows, or documentation change. The current version is published in this repository as `PRIVACY.md`; the effective date appears at the top of the document.

## 13. Contact

Recall does not publish a dedicated support email or physical contact address. For general questions, use the project's GitHub repository. For security vulnerabilities, follow [`SECURITY.md`](SECURITY.md) and do not disclose exploitable details in a public issue.
