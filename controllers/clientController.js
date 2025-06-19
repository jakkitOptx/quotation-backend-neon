// controllers/clientController.js
const Client = require("../models/Client");

// Create Client
exports.createClient = async (req, res) => {
  try {
    const client = new Client(req.body);
    const savedClient = await client.save();
    res.status(201).json({ message: "Client created successfully", client: savedClient });
  } catch (error) {
    console.error("Error creating client:", error);
    res.status(500).json({ message: "Failed to create client", error });
  }
};

// Update Client by ID
exports.updateClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedClient = await Client.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedClient) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.status(200).json({ message: "Client updated successfully", client: updatedClient });
  } catch (error) {
    console.error("Error updating client:", error);
    res.status(500).json({ message: "Failed to update client", error });
  }
};

// Delete Client by ID
exports.deleteClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedClient = await Client.findByIdAndDelete(id);
    if (!deletedClient) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.status(200).json({ message: "Client deleted successfully" });
  } catch (error) {
    console.error("Error deleting client:", error);
    res.status(500).json({ message: "Failed to delete client", error });
  }
};

// Get Client by ID
exports.getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.status(200).json(client);
  } catch (error) {
    console.error("Error fetching client:", error);
    res.status(500).json({ message: "Failed to fetch client", error });
  }
};

// Get All Clients
exports.getAllClients = async (req, res) => {
  try {
    const clients = await Client.find().collation({ locale: "th", strength: 1 }).sort({ customerName: 1 });
    res.status(200).json(clients);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ message: "Server Error" });
  }
};