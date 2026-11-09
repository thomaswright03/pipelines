"""Adds Google Maps listings to the business list (the Place table), using
gosom/google-maps-scraper (MIT, https://github.com/gosom/google-maps-scraper)
in its fast mode: one search request per query, no browser.

Google's listings are fresher and more complete than Foursquare's for the
kinds of businesses the daily runs look for, so they're loaded beside the
monthly Foursquare import (scripts/import-places.py), not instead of it.
Cold Outreach's general "business" list still comes from Foursquare only.

Note: Google's terms don't allow scraping Maps. The owner chose to use it
anyway (2026-10-29); see README → Known limitations.

For every city the pipelines rotate through, each query below is searched
around the city's center (US Census coordinates), and only listings whose
address is in that city are kept. Google rows have ids starting "g:", and
only those are replaced, in one transaction, so the Foursquare rows and a
previous good Google import survive a run that Google blocked.

Usage (GitHub Actions runs this monthly, see .github/workflows/import-google-places.yml):
  go install github.com/gosom/google-maps-scraper@<commit>
  pip install "psycopg[binary]==3.2.12"
  PIPELINES_DIRECT_URL=postgresql://... python3 scripts/import-google-places.py

--dry-run prints the counts without writing; --cities N tries only the first N cities.
"""

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip"

# What to search, and which list each result goes on. Agents are only
# searched in the dataleadsell cities (src/lib/agent-cities.ts).
QUERIES = {
    "hauler": ["dumpster rental", "garbage collection service", "junk removal"],
    "remodeler": ["bathroom remodeler", "kitchen remodeler"],
    "agent": ["real estate agency"],
}
# The same names import-places.py leaves out of the hauler list.
NOT_A_HAULER = re.compile(r"\b(landfill|transfer station|recycling center|convenience center|drop[- ]?off|junk cars?)\b", re.I)
# Fewer cities than this with results means Google blocked or changed something;
# the previous Google rows are then left alone.
MIN_CITY_SHARE = 0.5
PAUSE_SECONDS = 1.5  # Between searches, to stay well under Google's rate limits.

# Census names for the few pool cities that aren't "<city> city" / "<city> town" etc.
CENSUS_NAMES = {
    ("Nashville", "TN"): "Nashville-Davidson metropolitan government (balance)",
    ("Louisville", "KY"): "Louisville/Jefferson County metro government (balance)",
    ("Honolulu", "HI"): "Urban Honolulu CDP",
    ("Indianapolis", "IN"): "Indianapolis city (balance)",
    ("Lexington", "KY"): "Lexington-Fayette urban county",
    ("Athens", "GA"): "Athens-Clarke County unified government (balance)",
    ("Augusta", "GA"): "Augusta-Richmond County consolidated government (balance)",
    ("Macon", "GA"): "Macon-Bibb County",
    ("Anchorage", "AK"): "Anchorage municipality",
    ("Boise", "ID"): "Boise City city",
}
# Cities whose Census center is far from where their businesses are (a large
# consolidated area, or water): searched around downtown instead.
CENTER_OVERRIDES = {
    ("Anchorage", "AK"): (61.2176, -149.8997),
    ("Corpus Christi", "TX"): (27.8006, -97.3964),
    ("New York", "NY"): (40.7128, -74.0060),
    ("San Francisco", "CA"): (37.7793, -122.4193),
}
SUFFIX = re.compile(r"\s+(city|town|village|CDP|municipality|borough|city and borough|metro township)$")


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "pipelines-import-google-places/1"})
    with urllib.request.urlopen(request, timeout=60) as r:
        return r.read()


def pool_cities() -> tuple[list[tuple[str, str]], set[tuple[str, str]]]:
    """Every (city, state) a pipeline rotates through, and the dataleadsell ones."""
    found: dict[str, set[tuple[str, str]]] = {}
    for file in ("src/lib/us-cities.ts", "src/lib/agent-cities.ts"):
        text = (ROOT / file).read_text()
        found[file] = {(m.group(1), m.group(2)) for m in re.finditer(r'city:\s*"([^"]+)"[^}]*?state:\s*"([A-Z]{2})"', text)}
    cities = found["src/lib/us-cities.ts"] | found["src/lib/agent-cities.ts"]
    if len(cities) < 200:
        sys.exit(f"Only {len(cities)} cities parsed from the city lists — has their format changed?")
    return sorted(cities), found["src/lib/agent-cities.ts"]


def city_centers(cities: list[tuple[str, str]]) -> dict[tuple[str, str], tuple[float, float]]:
    """Each city's center from the Census Gazetteer; cities it can't place are skipped with a warning."""
    with zipfile.ZipFile(io.BytesIO(fetch(GAZETTEER))) as z:
        text = z.read(z.namelist()[0]).decode("utf-8")
    by_name: dict[tuple[str, str], tuple[float, float]] = {}
    exact: dict[tuple[str, str], tuple[float, float]] = {}
    for line in text.splitlines()[1:]:
        cols = [c.strip() for c in line.split("\t")]
        state, name, lat, lon = cols[0], cols[3], float(cols[10]), float(cols[11])
        exact[(name, state)] = (lat, lon)
        # The first match wins, so a "city" isn't overwritten by a same-named CDP.
        by_name.setdefault((SUFFIX.sub("", name).lower(), state), (lat, lon))
    centers = {}
    for city, state in cities:
        center = CENTER_OVERRIDES.get((city, state))
        center = center or (exact.get((CENSUS_NAMES[(city, state)], state)) if (city, state) in CENSUS_NAMES else None)
        center = center or by_name.get((city.lower(), state)) or by_name.get((re.sub(r"^Saint ", "St. ", city).lower(), state))
        if center:
            centers[(city, state)] = center
        else:
            print(f"  No Census coordinates for {city}, {state}; skipped.")
    return centers


def search(binary: str, query: str, lat: float, lon: float, workdir: Path) -> list[dict]:
    """One fast-mode search: up to 20 listings near the point."""
    (workdir / "q.txt").write_text(query + "\n")
    out = workdir / "out.json"
    out.unlink(missing_ok=True)
    proc = subprocess.run(
        [binary, "-input", str(workdir / "q.txt"), "-results", str(out), "-json", "-fast-mode",
         "-geo", f"{lat:.4f},{lon:.4f}", "-zoom", "13", "-radius", "15000", "-exit-on-inactivity", "1m"],
        capture_output=True, text=True, timeout=180,
    )
    if proc.returncode != 0 or not out.exists():
        print(f"    search failed ({proc.returncode}): {proc.stderr.strip()[-300:]}")
        return []
    try:
        rows = json.loads(out.read_text() or "[]")
    except json.JSONDecodeError:
        return []
    return rows if isinstance(rows, list) else []


def address_city(row: dict) -> tuple[str, str] | None:
    """("Boise", "ID") from "613 Fairview Ave, Boise, ID 83702, United States"."""
    m = re.search(r",\s*([^,]+?),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:,\s*United States)?\s*$", row.get("address") or "")
    return (m.group(1).strip(), m.group(2)) if m else None


def same_city(name: str) -> str:
    """Google writes "St Paul" where the city lists say "Saint Paul"."""
    return re.sub(r"^(saint|st\.?)\s+", "st ", name.strip().lower())


def format_phone(phone: str | None) -> str | None:
    """"(208) 247-6633" from "+1208-247-6633", the way the Foursquare rows are written."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return (phone or "").strip() or None
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"


def clean_website(url: str) -> str | None:
    url = (url or "").strip()
    if not url.startswith("http"):
        return None
    return re.sub(r"[?#].*$", "", url) or None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="print the counts, write nothing")
    parser.add_argument("--cities", type=int, default=0, help="only try the first N cities (for a test)")
    args = parser.parse_args()
    url = os.environ.get("PIPELINES_DIRECT_URL", "").strip()
    if not url and not args.dry_run:
        sys.exit("Set PIPELINES_DIRECT_URL to the database to load (or pass --dry-run).")
    binary = os.environ.get("GOOGLE_MAPS_SCRAPER") or shutil.which("google-maps-scraper")
    if not binary:
        sys.exit("google-maps-scraper isn't installed (go install github.com/gosom/google-maps-scraper@<commit>).")

    started = time.time()
    cities, agent_cities = pool_cities()
    if args.cities:
        cities = cities[: args.cities]
    centers = city_centers(cities)
    print(f"Searching Google Maps in {len(centers)} cities.")

    places: dict[str, dict] = {}
    cities_with_results = 0
    with tempfile.TemporaryDirectory() as tmp:
        for (city, state), (lat, lon) in centers.items():
            before = len(places)
            for kind, queries in QUERIES.items():
                if kind == "agent" and (city, state) not in agent_cities:
                    continue
                for query in queries:
                    for row in search(binary, query, lat, lon, Path(tmp)):
                        name = (row.get("title") or "").strip()
                        key = row.get("data_id") or row.get("place_id") or row.get("cid")
                        if not name or not key or address_city(row) is None:
                            continue
                        row_city, row_state = address_city(row)
                        if same_city(row_city) != same_city(city) or row_state != state:
                            continue  # A neighboring town; the exact-city rule matches the Foursquare list.
                        if kind == "hauler" and NOT_A_HAULER.search(name):
                            continue
                        if re.search(r"permanently closed|temporarily closed", row.get("status") or "", re.I):
                            continue
                        place = places.setdefault(
                            f"g:{key}",
                            {
                                "name": name,
                                "address": (row.get("address") or "").removesuffix(", United States") or None,
                                "city": city,
                                "state": state,
                                "phone": format_phone(row.get("phone")),
                                "website": clean_website(row.get("web_site")),
                                "categories": [c for c in row.get("categories") or [] if c],
                                "kinds": [],
                            },
                        )
                        if kind not in place["kinds"]:
                            place["kinds"].append(kind)
                    time.sleep(PAUSE_SECONDS)
            found = len(places) - before
            cities_with_results += found > 0
            print(f"  {city}, {state}: {found}")

    for kind in QUERIES:
        n = sum(kind in p["kinds"] for p in places.values())
        sites = sum(kind in p["kinds"] and bool(p["website"]) for p in places.values())
        print(f"  {kind:<10} {n:>7}  ({sites} with a website)")
    print(f"  {len(places)} places in {cities_with_results} of {len(centers)} cities ({time.time() - started:.0f} s).")
    if cities_with_results < MIN_CITY_SHARE * len(centers):
        sys.exit("Too few cities returned listings (Google may be blocking the searches), so the existing list was left alone.")
    if not args.dry_run:
        write(url, places)


def write(url: str, places: dict[str, dict]) -> None:
    import psycopg

    today = datetime.now(timezone.utc).date()
    with psycopg.connect(url) as pg, pg.cursor() as cur:
        cur.execute("""DELETE FROM "Place" WHERE "id" LIKE 'g:%'""")
        with cur.copy(
            'COPY "Place" ("id", "name", "address", "city", "state", "phone", "website", "categories", "kinds", "refreshedAt") FROM STDIN'
        ) as copy:
            for id, p in places.items():
                copy.write_row((id, p["name"], p["address"], p["city"], p["state"], p["phone"], p["website"], p["categories"], p["kinds"], today))
        # psycopg commits on leaving the `with` block, or rolls back on an error.
    print(f"Wrote {len(places)} Google places.")


if __name__ == "__main__":
    main()
