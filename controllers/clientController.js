// controllers/clientController.js
const Client = require("../models/Client");

const normalizeAuthorizedApprovers = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        return {
          name: "",
          email: item.trim().toLowerCase(),
          position: "",
        };
      }

      return {
        name: item?.name ? String(item.name).trim() : "",
        email: item?.email ? String(item.email).trim().toLowerCase() : "",
        position: item?.position ? String(item.position).trim() : "",
      };
    })
    .filter((item) => item.email);
};

const normalizeClientPayload = (payload = {}) => {
  const normalizedPayload = { ...payload };

  if (Object.prototype.hasOwnProperty.call(normalizedPayload, "email")) {
    normalizedPayload.email = normalizedPayload.email
      ? String(normalizedPayload.email).trim().toLowerCase()
      : undefined;
  }

  if (
    Object.prototype.hasOwnProperty.call(normalizedPayload, "approverEmails") &&
    !Object.prototype.hasOwnProperty.call(normalizedPayload, "authorizedApprovers")
  ) {
    normalizedPayload.authorizedApprovers = normalizeAuthorizedApprovers(
      normalizedPayload.approverEmails
    );
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPayload, "authorizedApprovers")) {
    normalizedPayload.authorizedApprovers = normalizeAuthorizedApprovers(
      normalizedPayload.authorizedApprovers
    );
  }

  delete normalizedPayload.approverEmails;

  return normalizedPayload;
};

// Create Client
exports.createClient = async (req, res) => {
  try {
    const client = new Client(normalizeClientPayload(req.body));
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
    const updatedClient = await Client.findByIdAndUpdate(
      id,
      normalizeClientPayload(req.body),
      { new: true, runValidators: true }
    );
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
