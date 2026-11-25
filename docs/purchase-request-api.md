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
The frontend sends `managerName` as a display label using its existing department-specific mapping. An empty name returns 400. The backend does not look up this name or either fixed name in User records when creating a request. The creator must have a configured, nonempty QT `ApproveFlow` with valid approver usernames/emails and levels.

Approval order:

1. All steps from the creator's QT flow, sorted by level, each reset to `Pending`. Assignees are the `approver` usernames/emails in that flow, not the names printed on the form.
2. An appended admin step selected by the creator's company as described below.

Response fields for printing: `preparedBy`, `managerName`, `finalApproverName`, `adminName`. These labels do not override QT approver assignment. `approvalSteps` may have more than three entries depending on the QT flow. Its `name` is the flow email for QT steps; the admin name is uppercase. QT steps contain `approver` and `level`; `userId` is optional and is retained for old records. Changes to flow configuration do not rewrite existing requests.

Company is read from the authenticated creator, not the request body. `OPTX`/`OPTXFI` map to `OPTX`; `NEON`/`NEONWORKS` map to `NEONWORKS` (case-insensitive). For older accounts without a recognized company, an `@optx.` or `@optxfi.` username domain selects OPTX; otherwise NEONWORKS. The resolved `company` is saved on new requests.

| Company | `finalApproverName` | `adminName` | Admin authorization |
| --- | --- | --- | --- |
| NEONWORKS | NATORN MANEEKORN | SUREERAT JANHOM | Authenticated first/last name matches `identityName: "sureerat janhom"` |
| OPTX | CHAWACHAI WICHAIDIT | CHAWACHAI WICHAIDIT | Same username/email as the creator's QT level 5 approver |

OPTX flow must have exactly one level 5 entry (Chawachai's existing QT assignment); otherwise creation returns 400. No fixed-name account lookup is performed. For OPTX, Chawachai approves the final QT step and then approves the admin step separately; the first action leaves status `Approved`, and the admin action sets `Completed`. Existing documents retain the assignments captured when created.

To show approval buttons, find the first `Pending` step while the document is not `Rejected` or `Completed`. For QT steps compare `approver` with the signed-in user's username/email (case-insensitive). For admin compare `identityName` with their normalized first/last name. Existing records assigned by `userId` continue to use that ID. The server enforces the same rules; client-supplied actor names/emails do not grant permission.

## Read

- `GET /api/purchase-requests?page=1&limit=20`: `{items,total,page,limit}`, max 100 per page.
- `GET /api/purchase-requests/:id`: full document including approval steps and timestamps.

Only the creator, assigned QT flow accounts, and the company-specific admin account may read a request. Other users receive 404 for individual documents.

## Act

`PATCH /api/purchase-requests/:id/approval`

Manager/final approver: `{"status":"Approved"}` or `{"status":"Rejected","reason":"Over budget"}`.
Only the current pending assignee can act. Rejection requires a reason and closes the request. Intermediate QT approvals keep status `Pending`; the last QT flow approval sets status `Approved`. Each action records `actedAt`, `actedBy` (authenticated username/email), and `reason`.

Admin after final QT approval: `{"status":"Approved"}`. This records the admin signature timestamp and sets the document status to `Completed`, with step status `Approved`. No delivery date is required. An optional `expectedDeliveryDate` may be included; if supplied, it must be a valid date. The previous `{"status":"Completed","expectedDeliveryDate":"2026-12-01"}` payload remains accepted. Admin may also reject with a nonblank reason.

400: invalid data or missing/invalid QT flow; 401/403: authentication or action denied; 404: missing/inaccessible request; 409: concurrent modification or request already closed. Creation no longer returns 409 for missing/duplicate display-name accounts.
Concurrent approval writes use Mongoose optimistic concurrency; reload after 409.

This module reuses the requester's QT flow configuration and has its own purchase-request approval records. QT approval endpoints and email notifications remain specific to quotations; purchase-request email delivery and PDF export are not included.

Verification: `node --test tests/purchase-request.js` (offline validation and flow/action tests).
