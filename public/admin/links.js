/**
 * Admin invite-link builder — you choose the ?c= characters.
 * Open: /admin/links.html?key=YOUR_ADMIN_MAP_KEY
 */

const statusEl = document.getElementById("status-line");
const keyInput = document.getElementById("admin-key");
const codeInput = document.getElementById("invite-code");
const labelInput = document.getElementById("invite-label");
const previewEl = document.getElementById("link-preview");
const createBtn = document.getElementById("create-btn");
const refreshBtn = document.getElementById("refresh-btn");
const listEl = document.getElementById("invite-list");
const resultBox = document.getElementById("result-box");
const resultCode = document.getElementById("result-code");
const resultLink = document.getElementById("result-link");
const copyBtn = document.getElementById("copy-btn");
const mapLink = document.getElementById("map-link");

const params = new URLSearchParams(window.location.search);
const initialKey = params.get("key") || localStorage.getItem("admin_map_key") || "";
if (initialKey) keyInput.value = initialKey;

let lastLink = "";

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = `status-line${tone ? ` is-${tone}` : ""}`;
}

function getAdminKey() {
  return keyInput.value.trim();
}

function cleanCode(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function rememberKey(key) {
  try {
    localStorage.setItem("admin_map_key", key);
  } catch {
    /* ignore */
  }
  const next = new URL(window.location.href);
  next.searchParams.set("key", key);
  window.history.replaceState({}, "", next.toString());
  if (mapLink) {
    mapLink.href = `/admin/map.html?key=${encodeURIComponent(key)}`;
  }
}

function updatePreview() {
  const code = cleanCode(codeInput.value);
  previewEl.textContent = `${window.location.origin}/?c=${code || "…"}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showResult(invite, link) {
  lastLink = link;
  resultBox.hidden = false;
  resultCode.textContent = invite.code;
  resultLink.textContent = link;
}

function renderList(invites) {
  listEl.innerHTML = "";
  if (!invites.length) {
    const empty = document.createElement("li");
    empty.className = "invite-item";
    empty.textContent = "No codes yet. Enter one above and copy the link.";
    listEl.appendChild(empty);
    return;
  }

  invites.forEach((invite) => {
    const link = `${window.location.origin}/?c=${encodeURIComponent(invite.code)}`;
    const li = document.createElement("li");
    li.className = "invite-item";
    li.innerHTML = `
      <strong>${escapeHtml(invite.code)}</strong>
      <span>${escapeHtml(invite.label || "No private note")}</span>
      <code>${escapeHtml(link)}</code>
      <div class="row-actions">
        <button type="button" data-copy>Copy link</button>
        <button type="button" data-delete class="btn-danger">Delete</button>
      </div>
    `;
    li.querySelector("[data-copy]").addEventListener("click", async () => {
      const ok = await copyText(link);
      setStatus(ok ? `Copied ${invite.code}` : "Could not copy", ok ? "ok" : "error");
    });
    li.querySelector("[data-delete]").addEventListener("click", () => {
      deleteInvite(invite.code);
    });
    listEl.appendChild(li);
  });
}

async function deleteInvite(code) {
  const key = getAdminKey();
  if (!key) {
    setStatus("Enter admin key first.", "error");
    return;
  }
  if (!window.confirm(`Delete code "${code}"?`)) return;

  rememberKey(key);
  setStatus(`Deleting ${code}…`);

  try {
    const response = await fetch(
      `/api/admin/invites/${encodeURIComponent(code)}?key=${encodeURIComponent(key)}`,
      { method: "DELETE" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (resultCode.textContent === code) {
      resultBox.hidden = true;
      lastLink = "";
    }
    setStatus(`Deleted ${code}`, "ok");
    await loadInvites();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to delete invite", "error");
  }
}

async function loadInvites() {
  const key = getAdminKey();
  if (!key) {
    setStatus("Enter admin key to load codes.", "error");
    return;
  }
  rememberKey(key);
  setStatus("Loading codes…");

  try {
    const response = await fetch(`/api/admin/invites?key=${encodeURIComponent(key)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderList(Array.isArray(data.invites) ? data.invites : []);
    setStatus(`${data.count || 0} invite code(s)`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to load invites", "error");
  }
}

async function createInvite() {
  const key = getAdminKey();
  const code = cleanCode(codeInput.value);
  if (!key) {
    setStatus("Enter admin key first.", "error");
    return;
  }
  if (!code) {
    setStatus("Type the code you want in the link (e.g. ali).", "error");
    codeInput.focus();
    return;
  }

  rememberKey(key);
  createBtn.disabled = true;
  setStatus("Saving…");

  try {
    const response = await fetch(`/api/admin/invites?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        label: labelInput.value.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    const link = data.link || `${window.location.origin}/?c=${encodeURIComponent(data.invite.code)}`;
    showResult(data.invite, link);
    const copied = await copyText(link);
    setStatus(
      copied
        ? `Link ready with ?c=${data.invite.code} — copied. Send on WhatsApp.`
        : `Link ready with ?c=${data.invite.code} — copy below.`,
      "ok"
    );
    codeInput.value = "";
    labelInput.value = "";
    updatePreview();
    await loadInvites();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to create invite", "error");
  } finally {
    createBtn.disabled = false;
  }
}

codeInput.addEventListener("input", updatePreview);
createBtn.addEventListener("click", createInvite);
refreshBtn.addEventListener("click", loadInvites);
copyBtn.addEventListener("click", async () => {
  if (!lastLink) return;
  const ok = await copyText(lastLink);
  setStatus(ok ? "Link copied." : "Could not copy", ok ? "ok" : "error");
});
keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadInvites();
});
codeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") createInvite();
});

updatePreview();

if (initialKey) {
  rememberKey(initialKey);
  loadInvites();
} else if (mapLink) {
  mapLink.href = "/admin/map.html";
}
