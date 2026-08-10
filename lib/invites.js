/**
 * Local invite-code store (code → optional private label).
 * Codes are chosen by you (e.g. ali, sara1) — not random secrets.
 * On Vercel /tmp is ephemeral — prefer Sheets when the webhook is configured.
 */

const fs = require("fs").promises;
const path = require("path");
const os = require("os");

function resolveDataDir() {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "location-sharing");
  }
  return path.join(__dirname, "..", "data");
}

const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, "invites.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}

/** Keep letters/numbers/_/- as typed (max 32). */
function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function codeKey(value) {
  return normalizeCode(value).toUpperCase();
}

function normalizeLabel(value) {
  return String(value || "").trim().slice(0, 80);
}

async function listInvites() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const invites = JSON.parse(raw || "[]");
  return invites.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

async function saveInvites(invites) {
  await ensureStore();
  await fs.writeFile(DATA_FILE, JSON.stringify(invites, null, 2), "utf8");
}

async function createInvite({ code, label } = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    const error = new Error("Enter the code you want at the end of the link.");
    error.statusCode = 400;
    throw error;
  }

  const invites = await listInvites();
  const key = codeKey(normalized);
  const existing = invites.find((item) => codeKey(item.code) === key);
  if (existing) {
    const nextLabel = normalizeLabel(label);
    if (nextLabel) existing.label = nextLabel;
    await saveInvites(invites);
    return existing;
  }

  const entry = {
    code: normalized,
    label: normalizeLabel(label),
    createdAt: new Date().toISOString(),
  };
  invites.push(entry);
  await saveInvites(invites);
  return entry;
}

async function deleteInvite(code) {
  const key = codeKey(code);
  if (!key) {
    const error = new Error("Invite code required.");
    error.statusCode = 400;
    throw error;
  }

  const invites = await listInvites();
  const next = invites.filter((item) => codeKey(item.code) !== key);
  if (next.length === invites.length) {
    const error = new Error("Invite code not found.");
    error.statusCode = 404;
    throw error;
  }
  await saveInvites(next);
  return { ok: true, code: normalizeCode(code), deleted: true };
}

async function labelForCode(code) {
  const key = codeKey(code);
  if (!key) return "";
  const invites = await listInvites();
  const match = invites.find((item) => codeKey(item.code) === key);
  return match?.label || "";
}

async function labelsByCode() {
  const invites = await listInvites();
  const map = {};
  for (const invite of invites) {
    map[codeKey(invite.code)] = invite.label || "";
    map[invite.code] = invite.label || "";
  }
  return map;
}

module.exports = {
  normalizeCode,
  codeKey,
  listInvites,
  createInvite,
  deleteInvite,
  labelForCode,
  labelsByCode,
};
