const express = require("express");
const router = express.Router();
const quotationController = require("../controllers/quotationController");

router.get("/:token/signature-url", quotationController.getCustomerSignatureSignedUrl);
router.post("/:token/accept", quotationController.acceptCustomerSignature);

module.exports = router;
