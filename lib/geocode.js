/**
 * Reverse-geocode coordinates into a human-readable address
 * using OpenStreetMap Nominatim (no API key required).
 */

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<string>} Exact location / address string
 */
async function reverseGeocode(latitude, longitude) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: {
        // Nominatim requires a descriptive User-Agent.
        "User-Agent": "PinTrail-LocationSharing/1.0 (educational app)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error("Reverse geocode failed:", response.status);
      return `${latitude}, ${longitude}`;
    }

    const data = await response.json();
    return data.display_name || `${latitude}, ${longitude}`;
  } catch (error) {
    console.error("Reverse geocode error:", error);
    return `${latitude}, ${longitude}`;
  }
}

module.exports = { reverseGeocode };
