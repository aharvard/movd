// Movd — content script.
// Scans the page (visible text + form field values) for addresses you no longer live at.
// When one is present: shows a warning banner and intercepts "Place order" style
// buttons / form submits with a confirm dialog.
(() => {
  if (window.top !== window && !document.body) return;

  const ORDER_RE = /\b(place (your |my )?order|buy now|complete (purchase|order|checkout)|submit order|pay now|pay \$|confirm (order|purchase|and pay)|purchase|order now|finish (order|checkout)|check ?out)\b/i;

  let watched = [];       // [{ raw, parsed, skip }]
  let enabled = true;
  let current = null;     // { raw, tier } for the watched entry currently found on the page
  let ignoredHere = false;
  let bypass = false;
  let scanTimer = null;

  // ---- UI (in a shadow root so page CSS can't touch it) --------------------
  let shadow = null;
  function ui() {
    if (shadow) return shadow;
    const host = document.createElement("movd-guard");
    host.style.all = "initial";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .banner {
          position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
          background: #c62828; color: #fff; padding: 12px 16px;
          font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex; align-items: center; gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,.35);
        }
        .banner b { font-weight: 700; }
        .banner .addr { font-family: ui-monospace, Menlo, monospace; background: rgba(0,0,0,.2); padding: 2px 6px; border-radius: 4px; }
        .banner .tier { opacity: .8; font-size: 12px; }
        .banner .spacer { flex: 1; }
        .banner button, .modal button {
          font: inherit; cursor: pointer; border-radius: 6px; padding: 6px 12px; border: 1px solid transparent;
        }
        .banner button { background: rgba(255,255,255,.15); color: #fff; border-color: rgba(255,255,255,.4); }
        .banner button:hover { background: rgba(255,255,255,.3); }
        .backdrop {
          position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.55);
          display: flex; align-items: center; justify-content: center;
          font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .modal {
          background: #fff; color: #1a1a1a; border-radius: 12px; padding: 24px 26px; width: 420px; max-width: 90vw;
          box-shadow: 0 12px 40px rgba(0,0,0,.4); border-top: 6px solid #c62828;
        }
        .modal h1 { font-size: 18px; margin: 0 0 8px; }
        .modal p { margin: 0 0 8px; }
        .modal .addr { font-family: ui-monospace, Menlo, monospace; background: #fdecea; color: #7a1414; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; margin: 10px 0 18px; }
        .modal .row { display: flex; gap: 10px; justify-content: flex-end; }
        .modal .back { background: #c62828; color: #fff; font-weight: 600; }
        .modal .back:hover { background: #a71f1f; }
        .modal .anyway { background: #fff; color: #555; border-color: #ccc; }
        .modal .anyway:hover { background: #f3f3f3; }
      </style>
      <div id="banner-slot"></div>
      <div id="modal-slot"></div>
    `;
    (document.body || document.documentElement).appendChild(host);
    return shadow;
  }

  function showBanner() {
    const slot = ui().getElementById("banner-slot");
    slot.innerHTML = "";
    if (!current || ignoredHere) return;
    const el = document.createElement("div");
    el.className = "banner";
    el.innerHTML = `
      <span>⚠️</span>
      <span><b>Movd:</b> you don't live at
        <span class="addr"></span> anymore <span class="tier"></span></span>
      <span class="spacer"></span>
      <button class="ignore">Ignore on this page</button>
    `;
    el.querySelector(".addr").textContent = current.raw.replace(/\s*\n\s*/g, ", ");
    el.querySelector(".tier").textContent = `(matched on ${AddressNorm.TIER_LABEL[current.tier]})`;
    el.querySelector(".ignore").addEventListener("click", () => { ignoredHere = true; showBanner(); });
    slot.appendChild(el);
  }

  function showModal(onProceed) {
    const slot = ui().getElementById("modal-slot");
    slot.innerHTML = "";
    const el = document.createElement("div");
    el.className = "backdrop";
    el.innerHTML = `
      <div class="modal" role="alertdialog">
        <h1>Hold on — you moved</h1>
        <p>You're about to ship this order to an address you don't live at anymore
          <span class="tier"></span>:</p>
        <div class="addr"></div>
        <div class="row">
          <button class="anyway">Ship anyway</button>
          <button class="back" autofocus>Go back</button>
        </div>
      </div>
    `;
    el.querySelector(".addr").textContent = current.raw;
    el.querySelector(".tier").textContent = `(matched on ${AddressNorm.TIER_LABEL[current.tier]})`;
    el.querySelector(".back").addEventListener("click", () => { slot.innerHTML = ""; });
    el.querySelector(".anyway").addEventListener("click", () => { slot.innerHTML = ""; onProceed(); });
    el.addEventListener("click", e => { if (e.target === el) slot.innerHTML = ""; });
    slot.appendChild(el);
    el.querySelector(".back").focus();
  }

  // ---- Scanning -------------------------------------------------------------
  function pageText() {
    const parts = [document.body ? document.body.innerText : ""];
    for (const f of document.querySelectorAll("input, textarea, select")) {
      if (f.type === "password" || f.type === "hidden") continue;
      if (f.tagName === "SELECT") {
        const o = f.selectedOptions && f.selectedOptions[0];
        if (o) parts.push(o.textContent);
      } else if (f.value) {
        parts.push(f.value);
      }
    }
    return parts.join("\n");
  }

  function scan() {
    scanTimer = null;
    if (!enabled || !watched.length) { setCurrent(null); return; }
    const text = pageText();
    const lower = text.toLowerCase();
    const RANK = { street: 3, zip: 2, city: 1 };
    let found = null;
    for (const w of watched) {
      // cheap pre-check: some raw fragment must appear before we tokenise the whole page
      const keyToks = w.parsed.streetKey.split(" ");
      const num = keyToks.find(t => /^\d/.test(t)) || keyToks[0]; // house / box number
      const hints = [num, w.parsed.zip, w.parsed.city].filter(Boolean);
      if (!hints.some(h => lower.includes(h))) continue;
      const tier = AddressNorm.matches(w.parsed, text, w.skip);
      if (tier && (!found || RANK[tier] > RANK[found.tier])) found = { raw: w.raw, tier };
    }
    setCurrent(found);
  }

  function setCurrent(w) {
    const changed = (w && w.raw + w.tier) !== (current && current.raw + current.tier);
    current = w;
    if (changed) { ignoredHere = false; showBanner(); }
  }

  function scheduleScan(delay = 500) {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, delay);
  }

  // ---- Interception -----------------------------------------------------------
  function labelOf(el) {
    return (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").trim();
  }

  document.addEventListener("click", e => {
    if (!current || ignoredHere || bypass) return;
    const el = e.target instanceof Element && e.target.closest("button, input[type=submit], input[type=image], input[type=button], a, [role=button]");
    if (!el || !ORDER_RE.test(labelOf(el))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    scan(); // make sure we're current before we warn
    if (!current) { bypass = true; el.click(); bypass = false; return; }
    showModal(() => { bypass = true; try { el.click(); } finally { setTimeout(() => (bypass = false), 1500); } });
  }, true);

  document.addEventListener("submit", e => {
    if (!current || ignoredHere || bypass) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const btns = [...form.querySelectorAll("button, input[type=submit], input[type=image]")];
    if (!btns.some(b => ORDER_RE.test(labelOf(b)))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showModal(() => {
      bypass = true;
      try { form.requestSubmit ? form.requestSubmit() : form.submit(); }
      finally { setTimeout(() => (bypass = false), 1500); }
    });
  }, true);

  // ---- Wiring -------------------------------------------------------------------
  async function loadWatchlist() {
    const data = await chrome.storage.sync.get(["addresses", "enabled", "current"]);
    enabled = data.enabled !== false;
    const home = data.current ? AddressNorm.parse(data.current) : null;
    watched = (data.addresses || [])
      .map(raw => ({ raw, parsed: AddressNorm.parse(raw) }))
      .filter(w => w.parsed)
      // tiers the old address shares with where you live now (same ZIP / same city) don't count
      .map(w => ({ ...w, skip: AddressNorm.overlap(w.parsed, home) }));
    scan();
  }

  chrome.storage.onChanged.addListener((_, area) => { if (area === "sync") loadWatchlist(); });
  document.addEventListener("input", () => scheduleScan(400), true);
  document.addEventListener("change", () => scheduleScan(200), true);
  new MutationObserver(() => scheduleScan(600)).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });

  loadWatchlist();
})();
