// Shared address normalisation for Movd (content script + popup).
// Goal: "123 Main Street, Apt #4" and "123 MAIN ST APT 4" become the same key,
// and partial appearances (just the ZIP, just "Springfield, IL") are still caught.
const AddressNorm = (() => {
  const ABBR = {
    street: "st", str: "st", avenue: "ave", av: "ave", boulevard: "blvd", boul: "blvd",
    drive: "dr", drv: "dr", road: "rd", lane: "ln", court: "ct", place: "pl", circle: "cir",
    parkway: "pkwy", pky: "pkwy", highway: "hwy", terrace: "ter", terr: "ter", trail: "trl",
    square: "sq", alley: "aly", crossing: "xing", expressway: "expy", freeway: "fwy",
    point: "pt", ridge: "rdg", station: "sta", turnpike: "tpke", plaza: "plz", center: "ctr",
    north: "n", south: "s", east: "e", west: "w",
    northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
    apartment: "apt", suite: "ste", building: "bldg", floor: "fl", room: "rm", department: "dept",
    first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
    sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th"
  };
  const UNIT = new Set(["apt", "ste", "unit", "bldg", "fl", "rm", "dept", "lot", "trlr", "spc"]);
  const DIRECTION = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
  const STATES = {
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
    ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
    il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
    me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
    ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
    nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
    nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
    ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
    ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
    wi: "wisconsin", wy: "wyoming", dc: "district of columbia"
  };
  const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATES).map(([a, n]) => [n, a]));

  function tokens(s) {
    return String(s).toLowerCase()
      .replace(/\bp\.?\s*o\.?\s*box\b/g, "po box")   // P.O. Box / P O Box -> po box
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/).filter(Boolean)
      .map(t => (t in ABBR ? ABBR[t] : t));
  }

  // Find the state in the tail of an address ("Springfield, IL 62701",
  // "New York, New York", "Washington DC"). Prefers a trailing 2-letter code,
  // then a trailing spelled-out name, so "Washington, DC" is DC not WA.
  function findState(text) {
    const toks = tokens(text).filter(t => !/^\d{5}$/.test(t));
    if (!toks.length) return null;
    const last = toks[toks.length - 1];
    if (last in STATES) return last;
    const joined = toks.join(" ");
    for (const name in NAME_TO_ABBR) if (joined === name || joined.endsWith(" " + name)) return NAME_TO_ABBR[name];
    return null;
  }

  // Parse a user-entered address into the bits we match on.
  //   streetKey: "123 main st"    (number + street, unit stripped)
  //   looseKey:  "123 main"       (number + street name only; null if same as streetKey)
  //   zip:       "62701" | null
  //   city:      "springfield" | null
  //   state:     "il" | null
  function parse(raw) {
    const segs = String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!segs.length) return null;

    let si = segs.findIndex(s => /^\d/.test(s) || /^p\.?\s*o\.?\s*box/i.test(s));
    if (si < 0) si = 0;

    let streetKey, looseKey = null;
    const po = segs[si].match(/^p\.?\s*o\.?\s*box\s*#?\s*(\w+)/i);
    if (po) {
      streetKey = `po box ${po[1].toLowerCase()}`;
    } else {
      const toks = tokens(segs[si]);
      const key = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (i > 0 && (UNIT.has(t) || /^\d+[a-z]?$/.test(t))) break; // unit designator or "#4" / "4b"
        key.push(t);
      }
      streetKey = key.join(" ");
      if (/^\d/.test(key[0] || "")) {
        const name = key.slice(1).find(t => !DIRECTION.has(t));
        if (name) {
          looseKey = `${key[0]} ${name}`;
          if (looseKey === streetKey) looseKey = null;
        }
      }
    }
    if (!streetKey) return null;

    const tail = segs.slice(si + 1).join(", ");
    const zipM = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
    const zip = zipM ? zipM[1] : null;
    const state = findState(tail);

    // City: first segment after the street line that isn't a unit ("Apt #4"),
    // with a trailing zip / state stripped ("Austin TX 78701" -> "austin",
    // "New York, New York" -> "new york").
    let city = null;
    for (let i = si + 1; i < segs.length; i++) {
      const seg = segs[i];
      const toks = tokens(seg);
      if (!toks.length || UNIT.has(toks[0]) || /^\d/.test(seg) || seg.startsWith("#")) continue;
      let joined = toks.filter(t => !/^\d{5}$/.test(t)).join(" ");
      if (state) {
        const name = STATES[state];
        if (joined === state || joined === name) {
          // "New York, New York": it's the city if a later segment still carries the state
          if (findState(segs.slice(i + 1).join(", ")) !== state) break;
          city = joined; break;
        }
        joined = joined.replace(new RegExp(`\\s+(${state}|${name})$`), "");
      }
      if (!joined) break;
      city = joined;
      break;
    }

    return { streetKey, looseKey, zip, city, state };
  }

  // Which tier of `parsed` appears in `text`? Returns "street" | "zip" | "city" | null.
  // `skip` is an optional Set of tiers to ignore (used to suppress overlap with
  // the user's current address).
  function matches(parsed, text, skip) {
    const norm = " " + tokens(text).join(" ") + " ";
    const has = s => norm.includes(" " + s + " ");
    const want = tier => !skip || !skip.has(tier);

    if (want("street")) {
      if (has(parsed.streetKey)) return "street";
      if (parsed.looseKey) {
        // "123 main" also matches "123 n main ..." — allow one direction token between
        const [num, name] = parsed.looseKey.split(" ");
        if (new RegExp(` ${num} (?:(?:n|s|e|w|ne|nw|se|sw) )?${name} `).test(norm)) return "street";
      }
    }
    if (want("zip") && parsed.zip && has(parsed.zip)) return "zip";
    if (want("city") && parsed.city && parsed.state && has(parsed.city) &&
        (has(parsed.state) || has(STATES[parsed.state]))) return "city";
    return null;
  }

  // Tiers on which `old` overlaps `current` (same zip, same city/state).
  function overlap(old, current) {
    const skip = new Set();
    if (!old || !current) return skip;
    if (old.zip && old.zip === current.zip) skip.add("zip");
    if (old.city && old.state && old.city === current.city && old.state === current.state) skip.add("city");
    return skip;
  }

  const TIER_LABEL = { street: "street address", zip: "ZIP code", city: "city + state" };

  return { tokens, parse, matches, overlap, TIER_LABEL, STATES };
})();
