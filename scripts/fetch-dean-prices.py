#!/usr/bin/env python3
"""Rebuild data/dean-ra-prices.json from the PumpResource product pages.

Reads each page's option list, then asks the storefront for the price of
one configuration at a time. Bare-pump prices are the full-size impeller
with no motor, baseplate, or coupling. Motor, baseplate, and coupling
prices are the difference from that bare pump. The trim adder is the
difference between a trimmed impeller and the full-size impeller.

Run from the repo root:

    python3 scripts/fetch-dean-prices.py

No prices in the output are estimated. A missing option is left out.
"""
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "dean-ra-prices.json"
PAGES = [
    "https://pumpresource.us/dean-ra2096-pump/",
    "https://pumpresource.us/dean-ra3146-pump/",
    "https://pumpresource.us/dean-ra3186-pump/",
    "https://pumpresource.us/dean-ra3246-pump/",
    "https://pumpresource.us/dean-rwa2096-pump/",
    "https://pumpresource.us/dean-rwa4166-pump/",
    "https://pumpresource.us/dean-rwa4206-pump/",
]
UA = "Mozilla/5.0 (compatible; HydroSuitePriceRefresh/1.0)"


def fetch(url, data=None):
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": UA,
            "Accept": "application/json,text/html",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as err:
            last = err
            time.sleep(0.4 * (attempt + 1))
    raise last


def text(fragment):
    cleaned = re.sub(r"<[^>]+>", " ", fragment)
    cleaned = cleaned.replace("&quot;", '"').replace("&amp;", "&").replace("&#39;", "'")
    return re.sub(r"\s+", " ", cleaned).strip()


def parse_page(html):
    product = re.search(r'name="product_id"\s+value="(\d+)"', html)
    if not product:
        raise SystemExit("no product id")
    fields = []
    chunks = re.split(r'<div class="form-field"', html)
    for chunk in chunks[1:]:
        kind_match = re.search(r'data-product-attribute="([^"]+)"', chunk[:400])
        if not kind_match:
            continue
        kind = kind_match.group(1)
        label_match = re.search(r'form-label--alternate[^>]*>(.*?)</label>', chunk, re.S)
        label = text(label_match.group(1)) if label_match else ""
        name = re.search(r'name="(attribute\[\d+\])"', chunk)
        if not name:
            continue
        options = []
        if kind == "set-select":
            body = re.search(r'<select[\s\S]*?</select>', chunk)
            if not body:
                continue
            for opt in re.finditer(r'<option[^>]*value="(\d+)"[^>]*>(.*?)</option>', body.group(0), re.S):
                options.append({"id": opt.group(1), "label": text(opt.group(2))})
        else:
            for inp in re.finditer(r'<input([^>]*type="radio"[^>]*)>', chunk):
                tag = inp.group(1)
                val = re.search(r'value="(\d+)"', tag)
                if not val:
                    continue
                ident = re.search(r'id="([^"]+)"', tag)
                lab = ""
                if ident:
                    found = re.search(
                        r'<label[^>]*for="%s"[^>]*>(.*?)</label>' % re.escape(ident.group(1)),
                        chunk,
                        re.S,
                    )
                    if found:
                        lab = text(found.group(1))
                options.append({"id": val.group(1), "label": lab})
        if options:
            fields.append({"name": name.group(1), "label": label, "kind": kind, "options": options})
    return product.group(1), fields


def classify(fields):
    found = {}
    for field in fields:
        title = field["label"].lower()
        if "impeller trim" in title:
            found["trim"] = field
        elif title.startswith("baseplate") or "baseplate" in title:
            found["base"] = field
        elif title.startswith("motor"):
            found["motor"] = field
        elif title.startswith("coupling"):
            found["coupling"] = field
        elif "balance" in title:
            found["balance"] = field
        elif "size" in title and "baseplate" not in title:
            found["size"] = field
    return found


def pick(field, pred, default=None):
    if not field:
        return default
    for opt in field["options"]:
        if pred(opt["label"]):
            return opt
    return default


def price_for(product_id, chosen):
    payload = [("action", "add"), ("product_id", product_id), ("qty[]", "1")]
    for key, value in chosen.items():
        payload.append((key, value))
    raw = fetch(
        "https://pumpresource.us/remote/v1/product-attributes/" + product_id,
        urllib.parse.urlencode(payload).encode(),
    )
    data = json.loads(raw.decode())
    return data["data"]["price"]["without_tax"]["value"]


def frame_token(label):
    match = re.search(r"(\d{3}TS?)", label)
    return match.group(1) if match else None


def is_formed_steel(label):
    """The store's plain steel base, not the drip pan and not the API rim."""
    if "drip" in label.lower() or "api" in label.lower():
        return False
    return bool(re.match(r"^Economy (Formed )?Steel\b", label))


def is_standard_coupling(label):
    return bool(frame_token(label)) and "no coupling" not in label.lower()


def motor_spec(label):
    match = re.match(
        r"^(\d+(?:\.\d+)?)hp\s+(\d+)rpm\s+(?:230-460V/3/60\s+)?(\d{3}TS?)\b(.*)$",
        label,
    )
    if not match:
        return None
    rest = match.group(4) or ""
    if re.search(r"ieee|baldor", rest, re.I):
        return None
    only = None
    only_match = re.search(r"(.+?)\s+ONLY", rest, re.I)
    if only_match:
        only = re.sub(r"\s+", "", only_match.group(1)).lower()
    return {
        "hp": float(match.group(1)),
        "rpm": int(match.group(2)),
        "frame": match.group(3),
        "label": label,
        "only": only,
    }


def scrape(url):
    print("page", url, flush=True)
    html = fetch(url).decode("utf-8", "replace")
    product_id, fields = parse_page(html)
    kinds = classify(fields)
    full = pick(kinds.get("trim"), lambda s: "full sized" in s.lower() or "no trim" in s.lower())
    no_base = pick(kinds.get("base"), lambda s: s.lower() == "no baseplate")
    no_motor = pick(kinds.get("motor"), lambda s: s.lower() == "no motor")
    no_coupling = pick(kinds.get("coupling"), lambda s: s.lower() == "no coupling")
    balance_no = pick(kinds.get("balance"), lambda s: s.lower() == "no")
    sizes = [o for o in (kinds.get("size") or {"options": []})["options"] if o["label"] and "choose" not in o["label"].lower()]
    if not sizes:
        # A one-size product has no size menu. The name carries the size.
        named = re.search(r"(\d+(?:\.\d+)?x\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:\s*#\s*\d+)?)", html, re.I)
        if not named:
            raise SystemExit("no size on " + url)
        raw = named.group(1).replace("×", "x")
        hash_at = raw.find("#")
        body = re.sub(r"\s+", "", raw[:hash_at] if hash_at >= 0 else raw)
        mark = re.sub(r"\s+", "", raw[hash_at + 1:]) if hash_at >= 0 else ""
        sizes = [{"id": None, "label": (body + " #" + mark) if mark else body}]

    def chosen(size_id, **over):
        base = {}
        if kinds.get("size") and size_id:
            base[kinds["size"]["name"]] = size_id
        if full:
            base[kinds["trim"]["name"]] = full["id"]
        if no_base:
            base[kinds["base"]["name"]] = no_base["id"]
        if no_motor:
            base[kinds["motor"]["name"]] = no_motor["id"]
        if no_coupling:
            base[kinds["coupling"]["name"]] = no_coupling["id"]
        if balance_no:
            base[kinds["balance"]["name"]] = balance_no["id"]
        base.update(over)
        return base

    jobs = []
    for size in sizes:
        jobs.append(("size", size["label"], chosen(size["id"])))
    trims = []
    if kinds.get("trim") and sizes:
        for opt in kinds["trim"]["options"]:
            if not opt["label"] or "choose" in opt["label"].lower():
                continue
            if "full sized" in opt["label"].lower():
                continue
            trims.append(opt)
        # A few trims on the first two sizes are enough to see if the adder is flat.
        for size in sizes[:2]:
            for opt in trims[:4]:
                jobs.append(("trim", size["label"] + "|" + opt["label"], chosen(size["id"], **{kinds["trim"]["name"]: opt["id"]})))
    if kinds.get("motor") and sizes:
        for opt in kinds["motor"]["options"]:
            spec = motor_spec(opt["label"])
            if not spec:
                continue
            jobs.append(("motor", opt["label"], chosen(sizes[0]["id"], **{kinds["motor"]["name"]: opt["id"]})))
    steel = []
    if kinds.get("base") and sizes:
        for opt in kinds["base"]["options"]:
            if is_formed_steel(opt["label"]):
                steel.append(opt)
                jobs.append(("base", opt["label"], chosen(sizes[0]["id"], **{kinds["base"]["name"]: opt["id"]})))
    couplings = []
    if kinds.get("coupling") and sizes:
        for opt in kinds["coupling"]["options"]:
            if is_standard_coupling(opt["label"]):
                couplings.append(opt)
                jobs.append(("coupling", opt["label"], chosen(sizes[0]["id"], **{kinds["coupling"]["name"]: opt["id"]})))

    print("  jobs", len(jobs), flush=True)
    results = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        future_map = {pool.submit(price_for, product_id, spec): (kind, label) for kind, label, spec in jobs}
        for future in as_completed(future_map):
            kind, label = future_map[future]
            results[(kind, label)] = future.result()

    bare = {label: results[("size", label)] for label, _id in [(s["label"], s["id"]) for s in sizes]}
    first_bare = bare[sizes[0]["label"]]
    trim_deltas = []
    for key, amount in results.items():
        if key[0] != "trim":
            continue
        size_label = key[1].split("|", 1)[0]
        trim_deltas.append(amount - bare[size_label])
    adder = None
    if trim_deltas:
        if len(set(trim_deltas)) == 1:
            adder = trim_deltas[0]
        else:
            adder = sorted(set(trim_deltas))
    motors = []
    for opt in (kinds.get("motor") or {"options": []})["options"]:
        spec = motor_spec(opt["label"])
        if not spec or ("motor", opt["label"]) not in results:
            continue
        spec["price_usd"] = results[("motor", opt["label"])] - first_bare
        motors.append(spec)
    bases = {}
    for opt in steel:
        token = frame_token(opt["label"])
        bases[token] = {
            "label": opt["label"],
            "price_usd": results[("base", opt["label"])] - first_bare,
        }
    coups = {}
    for opt in couplings:
        token = frame_token(opt["label"])
        item = {
            "label": opt["label"],
            "price_usd": results[("coupling", opt["label"])] - first_bare,
        }
        # Prefer the Dodge spacer when a frame has more than one coupling.
        previous = coups.get(token)
        if previous and "dodge" in previous["label"].lower() and "dodge" not in item["label"].lower():
            continue
        coups[token] = item
    print("  bare", len(bare), "trim", adder, "motors", len(motors), "bases", len(bases), flush=True)
    return {
        "url": url,
        "product_id": int(product_id),
        "trim_adder_usd": adder,
        "sizes": bare,
        "motors": motors,
        "baseplates": bases,
        "couplings": coups,
        "coupling_included": kinds.get("coupling") is None,
    }


def main():
    products = [scrape(url) for url in PAGES]
    doc = {
        "taken": date.today().isoformat(),
        "source": "pumpresource.us storefront option prices via /remote/v1/product-attributes/",
        "note": "Motor, baseplate, and coupling amounts are the store's add-on over the bare full-size pump. Trim adder is the same for every trimmed impeller on that page. Economy Steel is the formed-steel baseplate.",
        "pump_rpm_to_motor_rpm": {"3500": 3600, "1750": 1800, "1150": 1200},
        "products": products,
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
