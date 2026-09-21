# Movd

You moved. Your saved addresses didn't.

Movd is a personal Chrome extension that warns you before an order ships to
an address you don't live at anymore — the one still sitting in some
retailer's saved-addresses list.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Pin the red icon, click it, paste in each address you've moved away from
   (Enter saves, Shift+Enter for a new line)
5. Optionally fill in **Where you live now** — see "Overlap" below

## What it does

On every page, the content script scans visible text **and form field values**
for your watched addresses. When one is found:

- a red banner appears at the top: *Movd: you don't live at 123 Main St anymore*
- clicking anything that looks like **Place order / Buy now / Pay now /
  Complete purchase / Checkout**, or submitting a form containing such a
  button, is intercepted with a dialog: **Go back** or **Ship anyway**

"Ignore on this page" in the banner silences both for that page load.

## Matching — what counts as a hit

Everything is case-insensitive, punctuation-insensitive, and common
abbreviations are folded (Street/St, Avenue/Ave, Boulevard/Blvd, North/N,
Northwest/NW, Apartment/Apt, Suite/Ste, Fifth/5th, P.O. Box/PO Box, …).
Fields can be split (Address 1 / City / State / ZIP) or all on one line.

Three tiers, checked in order; the banner tells you which one hit:

| Tier | Watched `123 Main Street, Apt #4, Springfield, IL 62701` matches… |
|---|---|
| **street** | `123 MAIN ST APT 4`, `123 Main St #4`, `123 Main` (no suffix), `123 N Main St`, unit missing entirely |
| **ZIP** | `62701` or `62701-1234` anywhere on the page |
| **city + state** | `Springfield, IL`, `Springfield Illinois`, `SPRINGFIELD IL` |

Not matched: a different house number (`1123 Main St`), city without a
state, typos, spelled-out house numbers ("One Main Street").

The popup shows exactly what each entry will match on.

## Overlap with where you live now

If you moved across town, your old and new addresses share a city (and maybe
a ZIP). Enter your current address under **Where you live now** and any tier
the two share is switched off for that old address — so `Springfield, IL`
alone won't trigger, but the old street or old ZIP still will.

## Known limits

- Pages that list *all* your saved addresses (e.g. Amazon's "choose an
  address" step) will show the banner even if a different one is selected.
  That's intentional — it's a nudge to go delete the old one.
- Only `chrome.storage.sync` is used; the watchlist follows your Chrome
  profile and never leaves the browser.

## Test page

`test/checkout.html` runs the content script against a fake checkout with a
stubbed `chrome.storage` — serve the folder with any static server.
