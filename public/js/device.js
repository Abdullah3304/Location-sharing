  /**
 * Collect browser/device details available to a website.
 * Device ID + Device Name persist in localStorage so the same phone
 * keeps the same identity across visits (until site data is cleared).
 */

const DEVICE_ID_KEY = "pintrail_device_id";
const DEVICE_NAME_KEY = "pintrail_device_name";

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

function guessBrowser(ua) {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return "Opera";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/CriOS/i.test(ua)) return "Chrome iOS";
  if (/FxiOS/i.test(ua)) return "Firefox iOS";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return "Browser";
}

function guessOs(ua, platform) {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([\d.]+)/i);
    return m ? `Android ${m[1]}` : "Android";
  }
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua) || platform === "MacIntel") return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return platform || "Unknown";
}

function guessModelFromUa(ua) {
  // Android often embeds a model token: ...; SM-A546E Build/...
  const android = ua.match(/Android[^;]*;\s*([^;)]+)\s+Build/i);
  if (android && android[1] && !/wv|Mobile/i.test(android[1].trim())) {
    return android[1].trim();
  }
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  return "";
}

async function readClientHints() {
  const empty = { model: "", platform: "", platformVersion: "", mobile: "" };
  try {
    if (!navigator.userAgentData?.getHighEntropyValues) return empty;
    const hints = await navigator.userAgentData.getHighEntropyValues([
      "model",
      "platform",
      "platformVersion",
      "mobile",
    ]);
    return {
      model: hints.model || "",
      platform: hints.platform || "",
      platformVersion: hints.platformVersion || "",
      mobile: hints.mobile ? "yes" : "no",
    };
  } catch {
    return empty;
  }
}

function buildDeviceName(deviceId, model, os, browser) {
  try {
    const existing = localStorage.getItem(DEVICE_NAME_KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }

  const short = String(deviceId).replace(/-/g, "").slice(0, 6).toUpperCase();
  const label = model || os || "Phone";
  const name = `${label.replace(/\s+/g, "")}-${short}`;

  try {
    localStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    /* ignore */
  }
  return name;
}

/**
 * @returns {Promise<{
 *   deviceId: string,
 *   deviceName: string,
 *   model: string,
 *   os: string,
 *   browser: string,
 *   platform: string,
 *   screen: string,
 *   language: string,
 *   timezone: string,
 *   userAgent: string
 * }>}
 */
async function collectDeviceInfo() {
  const ua = navigator.userAgent || "";
  const hints = await readClientHints();
  const deviceId = getOrCreateDeviceId();
  const model = hints.model || guessModelFromUa(ua) || "";
  const os =
    hints.platform && hints.platformVersion
      ? `${hints.platform} ${hints.platformVersion}`
      : guessOs(ua, navigator.platform || "");
  const browser = guessBrowser(ua);
  const deviceName = buildDeviceName(deviceId, model, os, browser);

  return {
    deviceId,
    deviceName,
    model: model || "Unknown",
    os,
    browser,
    platform: navigator.platform || hints.platform || "",
    screen: `${window.screen?.width || "?"}x${window.screen?.height || "?"}@${
      window.devicePixelRatio || 1
    }x`,
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    userAgent: ua.slice(0, 300),
  };
}

window.collectDeviceInfo = collectDeviceInfo;
