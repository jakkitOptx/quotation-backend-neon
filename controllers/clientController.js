// controllers/clientController.js
const mongoose = require("mongoose");
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

const normalizeProjects = (value) => {
  if (!Array.isArray(value)) {
    const error = new TypeError("projects must be an array");
    error.status = 400;
    throw error;
  }

  const seen = new Set();

  return value.reduce((projects, item) => {
    if (typeof item !== "string") {
      const error = new TypeError("each project must be a string");
      error.status = 400;
      throw error;
    }

    const name = item.trim().replace(/\s+/g, " ");
    const normalizedName = name.toLowerCase();

    if (!name || seen.has(normalizedName)) {
      return projects;
    }

    seen.add(normalizedName);
    projects.push(name);
    return projects;
  }, []);
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

  if (Object.prototype.hasOwnProperty.call(normalizedPayload, "projects")) {
    normalizedPayload.projects = normalizeProjects(normalizedPayload.projects);
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
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Failed to create client" });
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
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Failed to update client" });
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
    const client = await Client.findById(id).lean();
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.status(200).json({
      ...client,
      email: client.email || "",
      projects: client.projects || [],
    });
  } catch (error) {
    console.error("Error fetching client:", error);
    res.status(500).json({ message: "Failed to fetch client", error });
  }
};

// Get All Clients
exports.getAllClients = async (req, res) => {
  try {
    const clients = await Client.find()
      .collation({ locale: "th", strength: 1 })
      .sort({ customerName: 1 })
      .lean();
    res.status(200).json(
      clients.map((client) => ({
        ...client,
        projects: client.projects || [],
      }))
    );
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// Get project names belonging to a client (for dropdowns such as Timesheet)
exports.getClientProjects = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    const client = await Client.findById(req.params.id)
      .select("_id projects")
      .lean();

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    return res.status(200).json({
      clientId: client._id,
      projects: client.projects || [],
    });
  } catch (error) {
    console.error("Error fetching client projects:", error);
    return res.status(500).json({ message: "Failed to fetch client projects" });
  }
};

exports.normalizeProjects = normalizeProjects;
exports.normalizeClientPayload = normalizeClientPayload;
