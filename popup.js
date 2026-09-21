const $ = id => document.getElementById(id);

function describe(parsed) {
  if (!parsed) return "";
  const bits = [parsed.streetKey];
  if (parsed.zip) bits.push(parsed.zip);
  if (parsed.city && parsed.state) bits.push(`${parsed.city}, ${parsed.state}`);
  return bits.join("  ·  ");
}

async function load() {
  const { addresses = [], enabled = true, current = "" } = await chrome.storage.sync.get(["addresses", "enabled", "current"]);
  $("enabled").checked = enabled;
  if (document.activeElement !== $("current")) $("current").value = current;
  document.body.classList.toggle("disabled", !enabled);

  const list = $("list");
  list.innerHTML = "";
  for (const raw of addresses) {
    const li = document.createElement("li");
    const text = document.createElement("div");
    text.className = "addr";
    const main = document.createElement("div");
    main.textContent = raw.replace(/\s*\n\s*/g, ", ");
    main.title = raw;
    const sub = document.createElement("div");
    sub.className = "meta";
    sub.textContent = "matches: " + describe(AddressNorm.parse(raw));
    text.append(main, sub);
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.textContent = "×";
    btn.title = "Stop watching";
    btn.addEventListener("click", () => remove(raw));
    li.append(text, btn);
    list.appendChild(li);
  }
  $("count").textContent = addresses.length ? `(${addresses.length})` : "";
  $("empty").hidden = addresses.length > 0;
}

async function add(raw) {
  raw = raw.trim();
  if (!raw || !AddressNorm.parse(raw)) return;
  const { addresses = [] } = await chrome.storage.sync.get("addresses");
  if (addresses.includes(raw)) return;
  await chrome.storage.sync.set({ addresses: [...addresses, raw] });
}

async function remove(raw) {
  const { addresses = [] } = await chrome.storage.sync.get("addresses");
  await chrome.storage.sync.set({ addresses: addresses.filter(a => a !== raw) });
}

$("address").addEventListener("input", e => {
  const parsed = AddressNorm.parse(e.target.value);
  $("preview").textContent = parsed ? "will match: " + describe(parsed) : "";
});

// Enter submits; Shift+Enter makes a new line.
$("address").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("add-form").requestSubmit(); }
});

$("add-form").addEventListener("submit", async e => {
  e.preventDefault();
  await add($("address").value);
  $("address").value = "";
  $("preview").textContent = "";
  $("address").focus();
});

$("current").addEventListener("change", e => chrome.storage.sync.set({ current: e.target.value.trim() }));
$("current").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
});

$("enabled").addEventListener("change", e => chrome.storage.sync.set({ enabled: e.target.checked }));
chrome.storage.onChanged.addListener((_, area) => { if (area === "sync") load(); });

load();
