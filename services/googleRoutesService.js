const axios = require("axios");

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const formatDurationMinutes = (durationValue) => {
  if (!durationValue) return null;

  const matchedSeconds = String(durationValue).match(/^(\d+)(?:\.\d+)?s$/i);
  if (!matchedSeconds) {
    return durationValue;
  }

  const totalSeconds = Number(matchedSeconds[1]);
  const totalMinutes = Math.ceil(totalSeconds / 60);

  return `${totalMinutes} mins`;
};

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return undefined;
};

const resolveAvoidTolls = (options = {}) => {
  const directAvoidTolls = normalizeBoolean(options.avoidTolls);
  if (typeof directAvoidTolls === "boolean") {
    return directAvoidTolls;
  }

  const useExpressway = normalizeBoolean(options.useExpressway);
  if (typeof useExpressway === "boolean") {
    return !useExpressway;
  }

  const useTolls = normalizeBoolean(options.useTolls);
  if (typeof useTolls === "boolean") {
    return !useTolls;
  }

  return false;
};

const resolveAvoidHighways = (options = {}) => {
  const directAvoidHighways = normalizeBoolean(options.avoidHighways);
  if (typeof directAvoidHighways === "boolean") {
    return directAvoidHighways;
  }

  const useExpressway = normalizeBoolean(options.useExpressway);
  if (typeof useExpressway === "boolean") {
    return !useExpressway;
  }

  return false;
};

async function getDrivingDistance(origin, destination, options = {}) {
  try {
    if (!GOOGLE_API_KEY) {
      throw new Error("GOOGLE_MAPS_API_KEY is missing in .env");
    }

    const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
    const avoidTolls = resolveAvoidTolls(options);
    const avoidHighways = resolveAvoidHighways(options);

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
      routeModifiers: {
        avoidTolls,
        avoidHighways,
      },
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
      durationText: formatDurationMinutes(route.duration),
      avoidTolls,
      avoidHighways,
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
