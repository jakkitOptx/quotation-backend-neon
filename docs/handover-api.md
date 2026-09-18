# หนังสือส่งมอบงาน — Backend แบบที่ 1

เก็บ collection `handovers` แยกจาก QT โดยมี unique `quotationId`: 1 ฉบับต่อ QT และ PUT เพื่อสร้างหรือแทนที่ข้อมูลเดิม ไม่กระทบยอดเงินหรือ approval flow ของ QT ไม่สร้าง PDF หรือ UI ในงานนี้

ทุก endpoint ต้องส่ง `Authorization: Bearer <token>` ตรวจสิทธิ์ดู QT ด้วย `canViewQuotation` และตรวจ `approvalStatus === "Approved"` ทุกครั้ง; defaults และ PUT ตรวจ `canEditQuotation` เพิ่มด้วย หาก QT เปลี่ยนสถานะจะไม่สามารถอ่าน/บันทึกผ่าน endpoints นี้ แต่ข้อมูลเดิมยังอยู่

| Method | Endpoint | การทำงาน |
|---|---|---|
| GET | `/api/quotations/:id/handover/defaults` | ข้อมูลจาก QT และบริษัทของผู้ login สำหรับเริ่มฟอร์ม |
| GET | `/api/quotations/:id/handover` | อ่านฉบับที่บันทึก |
| PUT | `/api/quotations/:id/handover` | สร้างหรือแทนที่ทั้งฟอร์ม คืนเอกสารที่บันทึก HTTP 200 |

ใช้ GET `/api/clients` เดิมสำหรับ dropdown ส่ง `_id` กลับมา; Backend ตรวจว่า client มีอยู่จริงและเก็บ `customerName` เป็น `companyName` ณ ตอนบันทึก ไม่ใช้ข้อความชื่อบริษัทจาก request

## Mapping ตามหมายเลข

| หมายเลข | Request / Response |
|---|---|
| 1 | `issuerCompany` จาก username (email) ของผู้ login ที่ยืนยันตัวตนแล้ว |
| 2 | `hiringClientId` → `hiringClient: {clientId, companyName}` |
| 3 | `projectName` จาก QT |
| 4 | `quotationType`, `workType` จาก QT; M → Media |
| 5 | `quotationNumber` ประกอบจากผู้สร้าง QT, type, ปี documentDate และ runNumber เติมศูนย์ 3 หลัก ตาม backend QT เดิม |
| 6 | `completionPercentage` ตัวเลข 0–100 ทศนิยมได้ 2 หลัก; server คำนวณ `remainingPercentage` |
| 7 | `deliveredToClientId` → `deliveredToClient` |
| 8–10 | `sender: {name, position, clientId}` |
| 11–13 | `recipients[0]: {name, position, clientId}` เป็นผู้รับมอบตามภาพ |
| 14 | `remarkEnabled`, `remark` |
| 15 | `additionalRecipientEnabled`, `recipients[1]` |

บริษัทข้อ 2, 7, 10, 13 เลือกแยกกันได้ทั้งหมด Response ผู้ลงนามเป็น `{name, position, company: {clientId, companyName}}`; ตอนโหลดกลับเข้า UI ให้ map `company.clientId` เป็น `clientId` ใน request

## ตัวอย่าง PUT

แทนที่ ID ตัวอย่างด้วย client ID ที่มีอยู่จริง

```json
{
  "documentDate": "2026-09-05",
  "hiringClientId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "deliveredToClientId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "completionPercentage": 20,
  "expectedCompletionMonth": "2026-11",
  "sender": {
    "name": "ชวชัย วิชัยดิษฐ",
    "position": "Managing Director",
    "clientId": "bbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "recipients": [
    {
      "name": "ชื่อผู้รับมอบ",
      "position": "Director",
      "clientId": "aaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      "name": "ชื่อผู้รับมอบคนที่สอง",
      "position": "Manager",
      "clientId": "aaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "additionalRecipientEnabled": true,
  "remarkEnabled": true,
  "remark": "รายละเอียดเพิ่มเติม"
}
```

- ตัวอย่างนี้คืน `remainingPercentage: 80`; ต่ำกว่า 100 ต้องส่งเดือนและปี ค.ศ. รูปแบบ `YYYY-MM` เพื่อให้ UI แสดงเป็นเดือน/ปี พ.ศ. ได้โดยไม่กำกวม
- เมื่อครบ 100 ระบบบันทึกเดือนเป็น null; ไม่ต้องส่ง `%` ในตัวเลข
- เมื่อไม่เพิ่มผู้รับมอบ ให้ส่ง `additionalRecipientEnabled: false` และ recipients 1 คนเท่านั้น
- เมื่อปิด remark ระบบล้างข้อความเป็น `""`; เมื่อเปิดต้องมีข้อความไม่เกิน 5,000 ตัวอักษร
- `documentDate` เป็นวันที่หนังสือ รูปแบบ `YYYY-MM-DD` (ค.ศ.) แยกจากวันที่ QT; GET คืนวันที่แบบ ISO
- เก็บ snapshot ของชื่อบริษัทและข้อมูล QT ทุกครั้งที่ PUT พร้อม `createdBy`, `updatedBy`, `createdAt`, `updatedAt` การเปลี่ยน client/QT ไม่แก้ฉบับที่บันทึกไว้จนกว่าจะ PUT ใหม่
- ฟิลด์ที่ server คำนวณเองไม่รับค่าทับจาก request; PUT จากผู้ใช้คนล่าสุดจะอัปเดตบริษัทผู้ออกหนังสือตาม email ของผู้ใช้นั้น

## การตั้งค่าและขอบเขต

`config/handover.js` ใช้เฉพาะหนังสือส่งมอบงาน จึงไม่เปลี่ยน type หรือ label ของ API QT อื่น บริษัทผู้ออกหนังสือระบุจาก email ผู้ login: `optx.co.th` → OPTX และ `neonworks.co.th`/`neonworks.com` → NEON

| บริษัท | Type → ประเภทงานในหนังสือส่งมอบงาน |
|---|---|
| NEON | `C` Creative, `G` General, `K` Kols, `M` Media, `P` Production, `S` Strategy, `V` Vertix |
| OPTX | `M` Biddable Media, `S` SEO, `W` Website, `D` Database |

ชนิดเดิมที่มี label ไม่ซ้ำกัน เช่น `D` → Database จะใช้เป็น fallback ได้ แม้ QT เก่ามี prefix/บริษัทไม่ตรง mapping ปัจจุบัน ส่วน `S` ไม่มี fallback เพราะ NEON คือ Strategy แต่ OPTX คือ SEO หากไม่พบ mapping คืน 400

HTTP errors: 400 ข้อมูลไม่ถูกต้อง/client ไม่พบ/mapping ไม่รองรับ; 401/403 ตาม auth middleware; 403 ไม่มีสิทธิ์ QT; 404 QT หรือหนังสือไม่พบ; 409 QT ไม่ Approved หรือชน unique key ขณะสร้างพร้อมกัน (ให้ retry PUT)

การเขียนพร้อมกันเป็น last-write-wins; ไม่มี revision history ในรุ่นนี้ การตรวจ Approved เกิดก่อนบันทึก ไม่ใช่ transaction ร่วมกับการเปลี่ยนสถานะ QT

## ตรวจสอบ

รัน `node --test tests/handover.test.js` ทดสอบ validation, snapshots, การคำนวณและ permission/status gates โดย mock database; ยังไม่ทดสอบกับ MongoDB จริง ต้องให้ deployment สร้าง unique index ของ `quotationId` (หากปิด autoIndex ให้สร้างผ่านขั้นตอน migration ของระบบ)
