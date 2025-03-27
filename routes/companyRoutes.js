const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");

// Routes
router.post("/", companyController.createCompany);
router.put("/:id", companyController.updateCompany);
router.delete("/:id", companyController.deleteCompany);
router.get("/:id", companyController.getCompanyById);
router.get("/", companyController.getAllCompanies);

module.exports = router;
