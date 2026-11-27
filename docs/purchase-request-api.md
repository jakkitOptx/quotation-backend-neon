# Purchase request API

Base URL: `/api/purchase-requests`. All endpoints require `Authorization: Bearer <token>`.

The PDF is a form reference. Identity and approval rules follow the user's request.

## Create

`POST /api/purchase-requests` creates and submits a request (no draft stage).

```json
{
  "managerName": "Manager Fullname",
  "documentDate": "2026-11-25",
  "purchaseReason": "Other",
  "otherReason": "Equipment for a new employee",
  "assetCode": "",
  "urgency": "High",
  "requiredDate": "2026-12-01",
  "items": [
    { "quantity": 1, "description": "Laptop", "unitPrice": 30000, "note": "" }
  ]
}
```

Reasons: `Lost` (สูญหาย), `Damaged` (ชำรุด), `OutOfStock` (ขาดสต็อก), `Other` (อื่นๆ).
`Other` requires nonblank `otherReason`. Urgency: `High`, `Medium`, `Low`.
At least one item with positive quantity and description is required. Unit price is optional; if supplied it must be nonnegative. `assetCode` is optional as indicated in the form.

The server snapshots the authenticated creator's first/last name, position and department; client-supplied identity, status and approval steps are ignored.
The frontend sends `managerName` as a display label using its existing department-specific mapping. An empty name returns 400. The backend does not look up this name or either fixed name in User records when creating a request. The creator must have a configured, nonempty QT `ApproveFlow` with valid approver usernames/emails and levels. NEONWORKS creation also requires the `natorn@neonworks.co.th` account to exist.

Approval order:

OPTX:

1. All steps from the creator's QT flow, sorted by level, each reset to `Pending`. Assignees are the `approver` usernames/emails in that flow, not the names printed on the form.
2. An appended admin step as described below.

NEONWORKS (always three steps at most):

1. `manager` (หัวหน้างาน): the QT step with the level just before `natorn@neonworks.co.th` in the creator's flow. If Natorn is not in the flow, the last (highest-level) QT step is used. If Natorn is the first step, this step is omitted. Other QT steps are not used.
2. `approver`: always `natorn@neonworks.co.th`, bound to that account's `userId` (looked up by username when the request is created; 400 if the account does not exist). `level` is Natorn's QT level when he is in the flow.
3. `admin`: Sureerat, bound by `userId` as described below.

Response fields for printing: `preparedBy`, `managerName`, `finalApproverName`, `adminName`. These labels do not override QT approver assignment. `approvalSteps` may have more than three entries depending on the QT flow. Its `name` is the flow email for QT steps; the admin name is uppercase. QT steps contain `approver` and `level`; `userId` is optional and is retained for old records. Changes to flow configuration do not rewrite existing requests.

Company is read from the authenticated creator, not the request body. `OPTX`/`OPTXFI` map to `OPTX`; `NEON`/`NEONWORKS` map to `NEONWORKS` (case-insensitive). For older accounts without a recognized company, an `@optx.` or `@optxfi.` username domain selects OPTX; otherwise NEONWORKS. The resolved `company` is saved on new requests.

| Company | `finalApproverName` | `adminName` | Admin authorization |
| --- | --- | --- | --- |
| NEONWORKS | NATORN MANEEKORN | SUREERAT JANHOM | Authenticated user `_id` equals `PURCHASE_REQUEST_ADMIN_USER_ID` (stored as the admin step's `userId`) |
| OPTX | CHAWACHAI WICHAIDIT | CHAWACHAI WICHAIDIT | Same username/email as the creator's QT level 5 approver |

OPTX flow must have exactly one level 5 entry (Chawachai's existing QT assignment); otherwise creation returns 400. NEONWORKS requires env `PURCHASE_REQUEST_ADMIN_USER_ID` set to Sureerat's User `_id`; if it is missing, invalid, or the account does not exist, creation returns 400. Names are never used for authorization because users can edit their own first/last name. Legacy NEONWORKS records whose admin step has `identityName: "sureerat janhom"` are authorized and readable only by that configured account ID. No fixed-name account lookup is performed. For OPTX, Chawachai approves the final QT step and then approves the admin step separately; the first action leaves status `Approved`, and the admin action sets `Completed`. Existing documents retain the assignments captured when created.

To show approval buttons, find the first `Pending` step while the document is not `Rejected` or `Completed`. For QT steps compare `approver` with the signed-in user's username/email (case-insensitive). For steps with `userId` (NEONWORKS admin and older records) compare it with the signed-in user's `_id`. For legacy steps with only `identityName`, only the configured NEONWORKS admin account may act. The server enforces the same rules; client-supplied actor names/emails do not grant permission.

## Read

- `GET /api/purchase-requests?page=1&limit=20`: `{items,total,page,limit}`, max 100 per page.
- `GET /api/purchase-requests/:id`: full document including approval steps and timestamps.

Only the creator, assigned QT flow accounts, and the company-specific admin account may read a request. Other users receive 404 for individual documents.

## Edit / resubmit

`PATCH /api/purchase-requests/:id`

Only the creator may edit (others get 403; non-participants get 404). Allowed when nobody has acted yet (status `Pending` and every step `Pending`) or when the request is `Rejected`; otherwise 409.
Send any subset of `managerName`, `documentDate`, `purchaseReason`, `otherReason`, `assetCode`, `urgency`, `requiredDate`, `items` (`items` replaces the whole list). Other fields such as status, approval steps and creator are ignored. Same validation as create; an empty body returns 400.

Editing a `Rejected` request resubmits it: each rejected step is copied to `rejectionHistory` (`role`, `approver`, `name`, `reason`, `actedAt`, `actedBy`), all approval steps reset to `Pending`, status becomes `Pending`, `resubmittedAt` is set, and approval restarts from the first step with the same assignees captured at creation.

## Cancel (delete)

`DELETE /api/purchase-requests/:id`

Soft delete: sets status `Cancelled` and `cancelledAt`; the document is kept and still appears in lists. Same permission and state rules as edit (creator only; untouched or `Rejected`). A cancelled request cannot be approved, edited or cancelled again (409).

## Act

`PATCH /api/purchase-requests/:id/approval`

Manager/final approver: `{"status":"Approved"}` or `{"status":"Rejected","reason":"Over budget"}`.
Only the current pending assignee can act. Rejection requires a reason and closes the request. Intermediate QT approvals keep status `Pending`; the last QT flow approval sets status `Approved`. Each action records `actedAt`, `actedBy` (authenticated username/email), and `reason`.

Admin after final QT approval: `{"status":"Approved"}`. This records the admin signature timestamp and sets the document status to `Completed`, with step status `Approved`. No delivery date is required. An optional `expectedDeliveryDate` may be included; if supplied, it must be a valid date. The previous `{"status":"Completed","expectedDeliveryDate":"2026-12-01"}` payload remains accepted. Admin may also reject with a nonblank reason.

400: invalid data or missing/invalid QT flow; 401/403: authentication or action denied; 404: missing/inaccessible request; 409: concurrent modification or request already closed. Creation no longer returns 409 for missing/duplicate display-name accounts.
Concurrent approval writes use Mongoose optimistic concurrency; reload after 409.

This module reuses the requester's QT flow configuration and has its own purchase-request approval records. QT approval endpoints and email notifications remain specific to quotations; purchase-request email delivery and PDF export are not included.

Verification: `node --test tests/purchase-request.js` (offline validation and flow/action tests).
