# SV Workspace

One website for a video editing studio: a public landing page, and behind one sign-in three roles — Super Admin, Client and Editor.

The public page is the supplied `SV_Workspace_Premium_Landing.html` design (navy / cyan, Manrope and DM Sans); the dashboards use the same design. **There is no self-registration**: people contact the studio, and a Super Admin creates their account and sends them the login details.

- **Frontend:** plain HTML, CSS and JavaScript (`index.html`, `assets/`), hosted on GitHub Pages.
- **Backend:** Google Apps Script (`backend/Code.gs`), deployed as a Web App.
- **Database:** one Google Sheet. The script creates every tab itself.

Every permission is checked in the backend. The frontend only decides what to show.

## 1. Set up the Google Sheet and the backend

1. Create a new Google Sheet (any name, for example "SV Workspace DB").
2. In the Sheet: **Extensions → Apps Script**.
3. Delete the sample code, paste the whole of `backend/Code.gs`, and save.
4. In the function list choose **`setup`** and press **Run**. Approve the permission prompt (it asks to manage this spreadsheet; if you later switch on Razorpay it also asks to connect to an external service).
   The Sheet now has 23 tabs with headers. Running `setup` again is safe — **run it again whenever you paste a newer `Code.gs`**, so new tabs (such as Comments) are added.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL (it ends in `/exec`).

When you change `Code.gs` later: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.

## 2. Publish the website on GitHub Pages

1. Open `assets/config.js` and paste the Web App URL:
   ```js
   window.SV_CONFIG = { API_URL: 'https://script.google.com/macros/s/XXXX/exec' };
   ```
2. Create a GitHub repository and upload `index.html` and the `assets` folder (it now also holds `landing.css` and `landing.js`) (the other folders are optional there; `backend/Code.gs` contains no secrets).
3. Repository **Settings → Pages → Deploy from a branch → main / root**.
4. Open the Pages address and press **Sign In**. While no Super Admin exists, the box offers **Set up your studio** — create the first Super Admin there. It can be done once; after that the only way to get an account is for a Super Admin to create it.

## 3. First things to do as Super Admin

| Where | What |
|---|---|
| Pricings | Set the three prices. A client cannot request a type that has no price. |
| Settings / Profile → Manual payment details | Enter your UPI ID and/or bank account. Until then clients cannot submit manual payments. |
| Settings / Profile → How new clients reach you | Enter the email, WhatsApp or phone number shown when a visitor presses "Start a Project". |
| User Accounts | Create each Client and Editor (and any further Super Admin). For an editor, choose Full-Time (monthly salary) or Freelance (per-video rate). A box then shows the login details to copy and send. |

## 4. Online payments (optional — off until you do this)

Online payment uses Razorpay and is switched off until keys exist. Nothing is simulated: with no keys, the client sees "not available" and a disabled button.

1. Create a Razorpay account and generate API keys.
2. Apps Script editor → **Project Settings → Script Properties** → add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. Run any function once from the editor to approve the "connect to an external service" permission, then redeploy a new version.

The secret stays in Script Properties; it is never sent to a browser. A payment counts only after the backend checks Razorpay's signature **and** asks Razorpay whether the payment was captured for the right amount.
**This path was tested only against a stand-in for Razorpay, not with a live account** — make one small test-mode payment before relying on it.

## 5. How the workflows connect

```
Client: Add Video ──► video (Not Started) + invoice at today's price
        │                 └─► shown in Client → Status and Super Admin → Videos / Projects
Super Admin: Assign (editor, deadline, optional rate)
        └─► shown in Editor → My Videos (no client identity)
Editor: Start editing ──► In Progress ──► Submit link ──► In Review
Super Admin: Approve ──► Awaiting Client Approval (freelance / per-video pay becomes payable, once)
             or Request revision ──► Revision Requested ──► editor resubmits
Client: Approve ──► Completed        or Request changes ──► Revision Requested
```

- **One record per video.** All three dashboards read the same row.
- **Prices:** the price is copied onto the video when it is submitted. Changing Pricings affects new videos only. One video's price can be changed with *Adjust price* on the video (reason required, audited).
- **Payments received outside the website** (cash, a direct transfer, a cheque): Payment Requests → *Record a payment received*, or *Record payment* on the client's page. It needs a reference, cannot exceed what the client owes, and the same reference cannot be recorded twice for a client.
- **Client balance** = issued invoices − payments received (verified submissions, confirmed online payments and payments you recorded). A manual payment shows as *Pending Verification* and reduces nothing until the Super Admin verifies it; it is counted once.
- **Editor balance** = earnings − recorded payouts. One open payment request at a time; payouts can be partial.
- **Full-Time editors:** add the month's salary from the editor's page (*Add monthly salary*, once per month). A per-video amount is paid only if a rate is typed on the assignment.

## 5a. Working tools

- **Search (Ctrl K):** jump to any section, video, client or editor.
- **Light / dark theme:** the moon / sun button; remembered per browser.
- **Project board:** Videos / Projects → Board shows every video by stage. Videos move through the workflow buttons, not by dragging.
- **Review comments:** every video has a comment thread with an optional timecode (0:42). A client's comments reach the studio and the editor; an editor's comments stay with the studio team; the Super Admin chooses "Everyone" or "Team only". Clients and editors never see each other's names.
- **In-page preview:** Google Drive, YouTube and Vimeo links get a Preview button. A Drive file must be shared as "Anyone with the link".
- **Version history:** every edited link an editor submitted is kept as v1, v2, …
- **Expected delivery:** the client sees the deadline set at assignment.
- **Invoices:** View / print opens a printable invoice (use the browser's "Save as PDF").
- **Charts:** revenue for the last six months and the project pipeline on the Super Admin Overview.

Fonts load from Google Fonts (Manrope and DM Sans); without a connection the site falls back to the system font.

## 6. The Sheet (created by `setup()`)

| Tab | Holds |
|---|---|
| Users | Every account: role, email, salted password hash, name, photo, status |
| Clients / Editors | Role details: social media name; employment type, salary, per-video rate |
| Channels | A client's YouTube / Instagram channels |
| Videos | The single record of each video: client, type, price, links, status, editor, deadline |
| Assignments | Who was assigned which video, when, at what rate (history kept on reassignment) |
| Reviews | Every submission, approval and revision request (also the version history of edited links) |
| Comments | Review comments on a video, with optional timecode and audience (everyone / team only) |
| Pricings | The three prices |
| Notifications | One row per notification per user |
| Invoices | One per video, issued at submission |
| ManualPayments | What clients submitted, and the decision |
| ClientPayments | Money actually received (verified manual, confirmed online, and payments recorded by the Super Admin) — the only source for balances and revenue |
| OnlineOrders | Razorpay orders |
| EditorEarnings / SalaryPeriods | What editors earned: per video, salary by month, bonus |
| PaymentRequests / EditorPayouts | Editor requests and what was paid against them |
| Expenses | Other costs for the Budget Tracker |
| Sessions | Hashed sign-in tokens with expiry |
| AuditLogs | Who did what, when |
| Settings / Counters | Manual payment details; counters for readable ids (VID-0001 …) |

Do not edit rows by hand while people are using the site, and never rename a header.

## 7. Run and test it on your computer

Needs Node.js 20 or newer. The preview runs the real `Code.gs` against an in-memory copy of the Sheet.

```bash
npm install          # only for the browser test (playwright-core; uses your installed Chrome)
npm run dev          # http://localhost:8787
npm test             # 19 backend tests
npm run test:ui      # 22 browser steps in Chrome
node tools/build-preview.js   # rebuilds preview.html, a single file you can open by double-click
```

## 8. What was tested

Both suites pass (run 22 Nov 2026).

| Scenario | Backend test | Browser test |
|---|---|---|
| A — client video request, price, Not Started, notifications | ✔ | ✔ |
| B — assignment, editor never sees the client, link submission, review, final approval | ✔ | ✔ |
| C — pricing change reaches the client; old videos keep their price | ✔ | ✔ |
| D — manual payment verified once; editor request, partial payout | ✔ | ✔ |
| E — client channels / profile and editor name / email / photo reach the Super Admin | ✔ | ✔ |
| F — every sidebar tab, logout, each role refused the others' actions | ✔ | ✔ |
| Invalid input, duplicate requests, page reload, sign-in lockout, suspended account, mobile menu | ✔ | ✔ |
| Comments (timecode, team-only, no identities across client and editor), version history | ✔ | ✔ |
| Project board, in-page preview, search palette, dark theme, notification popover, invoice view | — | ✔ |

**Not tested, because it needs your Google account:** the live Apps Script deployment and the browser → Apps Script connection from GitHub Pages; real Google Sheets behaviour and speed; a live Razorpay payment. After deploying, repeat scenarios A–D by hand once.

## 9. Limits of this stack — please read

- **Anyone who has the Web App URL can call it.** That is how Apps Script web apps work; protection is the sign-in check on every action, a 15-minute lock after 5 wrong passwords, and 7-day sessions.
- **Passwords** are stored as a salted, 2,000-round HMAC-SHA-256 hash. Apps Script has no bcrypt / Argon2, so this is weaker than a dedicated auth service. Anyone you share the Sheet with can see the hashes — keep the Sheet private.
- **No email.** The site sends none: the Super Admin copies the login details from the "Account created" box and sends them, and resets a forgotten password from User Accounts.
- **The landing page images** are loaded from Unsplash, as in the supplied design, and its portfolio shows inspiration images — replace them with your own work before launch (edit `assets/landing.js`).
- **Speed.** Each action takes roughly 1–3 seconds on Apps Script, and requests run one at a time. That suits one studio; it slows down past a few thousand videos.
- **Photos** are shrunk to 160 px and stored in the Sheet.

If the studio outgrows this, the smallest change is to keep the frontend and move the backend to Firebase (Authentication + Firestore) — the action names in `Code.gs` map one-to-one.

## 10. Not included

- **Tasks** and **Messages** — the brief keeps them only "if already present" in the original Admin page, which was not available when this was built.
- Email notifications, real-time chat, drag-and-drop on the board, and direct video file uploads (the brief asks for links only).
