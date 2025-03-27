const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");

router.post("/", clientController.createClient);
router.put("/:id", clientController.updateClientById);
router.delete("/:id", clientController.deleteClientById);
router.get("/:id", clientController.getClientById);
router.get("/", clientController.getAllClients);

module.exports = router;