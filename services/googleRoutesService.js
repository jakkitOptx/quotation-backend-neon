const axios = require("axios");

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

async function getDrivingDistance(origin, destination) {
  try {
    if (!GOOGLE_API_KEY) {
      throw new Error("GOOGLE_MAPS_API_KEY is missing in .env");
    }

    const url = "https://routes.googleapis.com/directions/v2:computeRoutes";

    const body = {
      origin: {
        address: origin,
      },
      destination: {
        address: destination,
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      languageCode: "th",
      units: "METRIC",
    };

    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    };

    const response = await axios.post(url, body, { headers });

    const route = response?.data?.routes?.[0];

    if (!route) {
      throw new Error("Route not found");
    }

    const distanceMeters = route.distanceMeters;
    const distanceKm = Number((distanceMeters / 1000).toFixed(2));

    return {
      distanceMeters,
      distanceKm,
      duration: route.duration,
    };
  } catch (error) {
    console.error(
      "Google Routes API error:",
      error?.response?.data || error.message
    );
    throw new Error("Failed to calculate route distance");
  }
}

module.exports = {
  getDrivingDistance,
};