//  Model/Quotation.js
const mongoose = require("mongoose");
const _ = require("lodash"); // ✅ Import lodash

// ✅ ฟังก์ชันปัดเศษให้เป็นทศนิยม 2 ตำแหน่ง (ปัดขึ้นถ้าหลักที่ 3 >= 5)
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

// Schema สำหรับ Items ในใบเสนอราคา
const ItemSchema = new mongoose.Schema({
  description: { type: String, required: true }, // รายละเอียดสินค้า/บริการ
  unit: { type: Number, required: true }, // จำนวน
  unitPrice: { type: Number, required: true }, // ✅ เปลี่ยน unitPrice เป็น Number เพื่อให้คำนวณได้ถูกต้อง
  amount: { type: Number, required: true }, // รวมเงิน (Unit * UnitPrice)
});

// Schema หลักสำหรับ Quotation
const QuotationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  amount: { type: Number, required: true }, // ยอดรวมทั้งหมด
  allocation: { type: String }, // ไม่ required
  description: { type: String }, // คำอธิบายเอกสาร
  approvalStatus: { type: String, enum: ["Draft", "Pending", "Approved", "Rejected", "Canceled"], default: "Pending" },
  approvedBy: { type: String },
  runNumber: { type: String, required: true }, // เลขที่ใบเสนอราคา
  type: { type: String, default: "" }, // ประเภทเอกสาร
  approvalHierarchy: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Approval" }, // เชื่อมกับ Approval
  ],
  items: [ItemSchema], // รายการในใบเสนอราคา
  createdAt: { type: Date, default: Date.now }, // วันที่สร้าง

  // ฟิลด์ใหม่ตามข้อกำหนด
  time: { type: Date, default: Date.now }, // Timestamp
  client: { type: String, required: true }, // ชื่อลูกค้า
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: true,
  }, // ✅ เพิ่ม clientId (เชื่อมกับ Client collection)
  salePerson: { type: String, required: true }, // ชื่อพนักงานขาย
  documentDate: { type: Date, required: true }, // วันที่เอกสาร
  productName: { type: String, required: true }, // ชื่อสินค้า
  projectName: { type: String, required: true }, // ชื่อโปรเจกต์
  period: { type: String, required: true }, // ระยะเวลา (เช่น NOV 2024 - DEC 2024)
  startDate: { type: Date, required: true }, // วันที่เริ่มต้น
  endDate: { type: Date, required: true }, // วันที่สิ้นสุด
  createBy: { type: String, required: true }, // ผู้สร้างเอกสาร
  proposedBy: { type: String, required: true }, // ผู้เสนอเอกสาร
  createdByUser: { type: String, required: true }, // ผู้ใช้งานที่สร้างเอกสาร
  department: { type: String, default: "" },
  team: { type: String, default: "" },
  teamGroup: { type: String, default: "" },
  discount: { type: Number, default: 0 }, // ส่วนลด
  fee: { type: Number, default: 0 }, // ค่า fee default เป็น 0
  calFee: { type: Number, default: 0 }, // ค่าคำนวนจาก amount * fee / 100
  amountBeforeTax: { type: Number, default: 0 }, // ยอดรวมก่อนหักภาษี
  vat: { type: Number, default: 0 }, // VAT 7%
  netAmount: { type: Number, default: 0 }, // ยอดรวมสุทธิ
  totalBeforeFee: { type: Number, default: 0 }, // รวมยอด amount ของ items
  total: { type: Number, default: 0 }, // totalBeforeFee + calFee
  // ฟิลด์ใหม่สำหรับการยกเลิก
  cancelDate: { type: Date, default: null }, // วันที่ยกเลิก
  reason: { type: String, default: null }, // เหตุผลในการยกเลิก
  canceledBy: { type: String, default: null }, // ใครเป็นคนยกเลิก
  remark: { type: String, default: "" },
  CreditTerm: { type: Number, default: 0 },
  isDetailedForm: { type: Boolean, default: false }, // ✅ เพิ่มฟิลด์นี้เพื่อระบุประเภทฟอร์ม
  isSpecialForm: { type: Boolean, default: false }, // ฟอร์มแบบพิเศษ
  numberOfSpecialPages: { type: Number, default: 1 }, // จำนวนหน้าของฟอร์มแบบพิเศษ
});

// ✅ ใช้ `pre-save hook` เพื่อปัดเศษค่าตัวเลขทั้งหมดก่อนบันทึกลงฐานข้อมูล
QuotationSchema.pre("save", function (next) {
  // ✅ ปัดเศษค่าตัวเลขทั้งหมดให้เป็นทศนิยม 2 ตำแหน่ง
  this.amount = roundUp(this.amount);
  this.discount = roundUp(this.discount);
  this.fee = roundUp(this.fee);
  this.calFee = roundUp(this.calFee);
  this.totalBeforeFee = roundUp(this.totalBeforeFee);
  this.total = roundUp(this.total);
  this.amountBeforeTax = roundUp(this.amountBeforeTax);
  this.vat = roundUp(this.vat);
  this.netAmount = roundUp(this.netAmount);

  // ✅ ปัดเศษ amount ใน items ด้วย
  this.items = this.items.map((item) => ({
    ...item,
    unitPrice: roundUp(item.unitPrice),
    amount: roundUp(item.amount),
  }));

  next();
});

// ✅ เพิ่ม Virtual เพื่อ Populate ข้อมูลลูกค้าอัตโนมัติ
QuotationSchema.virtual("clientDetails", {
  ref: "Client",
  localField: "clientId",
  foreignField: "_id",
  justOne: true,
});

// ✅ ให้ mongoose เรียก Virtual fields เสมอ
QuotationSchema.set("toObject", { virtuals: true });
QuotationSchema.set("toJSON", { virtuals: true });

QuotationSchema.index({ approvalStatus: 1, documentDate: 1 });

module.exports = mongoose.model("Quotation", QuotationSchema);
