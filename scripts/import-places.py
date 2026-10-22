"""Loads the business list every pipeline searches (the Place table) from
Foursquare's open places data (Apache 2.0, https://opensource.foursquare.com/os-places/).

Only the cities the pipelines rotate through are loaded (src/lib/us-cities.ts
and src/lib/agent-cities.ts), and only places Foursquare hasn't marked closed
and has confirmed since MIN_REFRESHED. Each place is tagged with the searches
it belongs to (the `kinds` column):

  hauler     Garbage AI         waste management services and named haulers
  remodeler  Room Designer 3D   bathroom contractors, kitchen remodelers, and
                                contractors named for baths or remodeling
  agent      dataleadsell       real estate agencies and named agents
  business   Cold Outreach      up to BUSINESS_PER_CITY other local businesses
                                with a website, most recently confirmed first

The whole table is replaced in one transaction, so a failed import leaves the
previous month's list in place.

Usage (GitHub Actions runs this monthly, see .github/workflows/import-places.yml):
  pip install duckdb==1.5.6 "psycopg[binary]==3.2.12"
  PIPELINES_DIRECT_URL=postgresql://... HF_TOKEN=hf_... python3 scripts/import-places.py

HF_TOKEN reads the newest monthly release from Hugging Face (free account;
accept the dataset's terms at https://huggingface.co/datasets/foursquare/fsq-os-places
first). Without it, the public Source Cooperative mirror is used, which stopped
at the 2025-02-06 release. --dry-run prints the counts without writing.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
MIN_REFRESHED = "2020-01-01"
BUSINESS_PER_CITY = 300
HF_DATASET = "foursquare/fsq-os-places"
MIRROR = "https://data.source.coop/fused/fsq-os-places"
MIRROR_RELEASE = "2025-02-06"

# What each kind matches. `label` is the full category path joined with " | "
# ("Business and Professional Services > Waste Management Service | ...").
HAULER = r"""(label ILIKE '%Waste Management Service%'
  OR regexp_matches(lower(name), '\b(dumpster|junk|disposal|sanitation|hauling|trash|garbage|roll[- ]?off|waste)\b'))
  AND NOT regexp_matches(lower(name), '\b(landfill|transfer station|recycling center|convenience center|drop[- ]?off|junk cars?)\b')
  AND label NOT ILIKE '%Automotive%'"""
REMODELER = r"""label ILIKE '%Bathroom Contractor%' OR label ILIKE '%Kitchen Remodeler%'
  OR ((label ILIKE '%General Contractor%' OR label ILIKE '%Home Improvement Service%' OR label ILIKE '%Carpenter%')
      AND regexp_matches(lower(name), '\b(bath|baths|bathroom|bathrooms|remodel|remodeling|remodelers?|kitchen|kitchens|renovations?)\b'))"""
AGENT = r"""label ILIKE '%Real Estate Agency%'
  OR (label ILIKE '%Real Estate Service%' AND regexp_matches(lower(name), '\b(realtor|realty|real estate|homes)\b'))"""
BUSINESS = r"""website IS NOT NULL AND (label ILIKE 'Business and Professional Services%' OR label ILIKE 'Retail%'
  OR label ILIKE 'Dining and Drinking%' OR label ILIKE 'Health and Medicine%' OR label ILIKE 'Sports and Recreation%')
  AND label NOT ILIKE '%Government%'"""


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "pipelines-import-places/1"})
    with urllib.request.urlopen(request, timeout=30) as r:
        return r.read()


def pool_cities() -> list[tuple[str, str]]:
    """Every (city, state) a pipeline rotates through, as the TypeScript lists spell them."""
    cities: set[tuple[str, str]] = set()
    for file in ("src/lib/us-cities.ts", "src/lib/agent-cities.ts"):
        text = (ROOT / file).read_text()
        for m in re.finditer(r'city:\s*"([^"]+)"[^}]*?state:\s*"([A-Z]{2})"', text):
            cities.add((m.group(1), m.group(2)))
    if len(cities) < 200:
        sys.exit(f"Only {len(cities)} cities parsed from the city lists — has their format changed?")
    return sorted(cities)


def source_files(con: duckdb.DuckDBPyConnection) -> tuple[str, list[str]]:
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
        listing = json.loads(fetch(f"https://huggingface.co/api/datasets/{HF_DATASET}/tree/main/release"))
        releases = sorted(d["path"] for d in listing if d["path"].startswith("release/dt="))
        release = releases[-1]
        con.execute("CREATE SECRET hf (TYPE huggingface, TOKEN ?)", [token])
        return release.removeprefix("release/dt="), [f"hf://datasets/{HF_DATASET}/{release}/places/parquet/*.parquet"]
    listing = fetch(f"{MIRROR}/").decode()
    keys = re.findall(rf"<Key>(fsq-os-places/{MIRROR_RELEASE}/places/[^<]+\.parquet)</Key>", listing)
    if not keys:
        sys.exit("The Source Cooperative mirror listed no files — set HF_TOKEN to read from Hugging Face instead.")
    return MIRROR_RELEASE, [f"https://data.source.coop/fused/{k}" for k in keys]


def load(con: duckdb.DuckDBPyConnection, files: list[str], cities: list[tuple[str, str]]) -> None:
    con.execute("CREATE TABLE pool (city VARCHAR, state VARCHAR)")
    con.executemany("INSERT INTO pool VALUES (?, ?)", cities)
    con.execute(
        f"""
        CREATE TABLE raw AS
        SELECT p.fsq_place_id AS id, trim(p.name) AS name, p.address, pool.city, pool.state, p.postcode,
               p.tel AS phone, p.website, p.fsq_category_labels AS labels,
               coalesce(array_to_string(p.fsq_category_labels, ' | '), '') AS label,
               TRY_CAST(p.date_refreshed AS DATE) AS refreshed
        FROM read_parquet(?) p
        JOIN pool ON lower(trim(p.locality)) = lower(pool.city) AND p.region = pool.state
        WHERE p.country = 'US' AND p.date_closed IS NULL AND p.name IS NOT NULL
          AND TRY_CAST(p.date_refreshed AS DATE) >= DATE '{MIN_REFRESHED}'
        """,
        [files],
    )
    con.execute(
        f"""
        CREATE TABLE tagged AS
        SELECT *, list_filter([
            CASE WHEN {HAULER} THEN 'hauler' END,
            CASE WHEN {REMODELER} THEN 'remodeler' END,
            CASE WHEN {AGENT} THEN 'agent' END
          ], k -> k IS NOT NULL) AS kinds
        FROM raw
        """
    )
    con.execute(
        f"""
        CREATE TABLE business AS
        SELECT id FROM tagged WHERE {BUSINESS}
        QUALIFY row_number() OVER (PARTITION BY city, state ORDER BY refreshed DESC, id) <= {BUSINESS_PER_CITY}
        """
    )
    con.execute(
        """
        CREATE TABLE place AS
        SELECT t.id, t.name,
               nullif(concat_ws(', ', nullif(trim(t.address), ''), t.city, trim(t.state || ' ' || coalesce(t.postcode, ''))), '') AS address,
               t.city, t.state, t.phone, t.website,
               list_transform(coalesce(t.labels, []), l -> trim(string_split(l, '>')[-1])) AS categories,
               CASE WHEN b.id IS NULL THEN t.kinds ELSE list_append(t.kinds, 'business') END AS kinds,
               t.refreshed
        FROM tagged t LEFT JOIN business b USING (id)
        WHERE len(t.kinds) > 0 OR b.id IS NOT NULL
        """
    )


def write(con: duckdb.DuckDBPyConnection, url: str) -> None:
    import psycopg

    rows = con.execute("SELECT id, name, address, city, state, phone, website, categories, kinds, refreshed FROM place").fetchall()
    with psycopg.connect(url) as pg, pg.cursor() as cur:
        cur.execute('DELETE FROM "Place"')
        with cur.copy(
            'COPY "Place" ("id", "name", "address", "city", "state", "phone", "website", "categories", "kinds", "refreshedAt") FROM STDIN'
        ) as copy:
            for row in rows:
                copy.write_row(row)
        # psycopg commits on leaving the `with` block, or rolls back on an error.
    print(f"Wrote {len(rows)} places.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="print the counts, write nothing")
    args = parser.parse_args()
    url = os.environ.get("PIPELINES_DIRECT_URL", "").strip()
    if not url and not args.dry_run:
        sys.exit("Set PIPELINES_DIRECT_URL to the database to load (or pass --dry-run).")

    started = time.time()
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET allow_asterisks_in_http_paths = true;")
    cities = pool_cities()
    release, files = source_files(con)
    print(f"Foursquare release {release}: {len(files)} file pattern(s), {len(cities)} cities.")
    load(con, files, cities)

    for kind in ("hauler", "remodeler", "agent", "business"):
        n = con.execute("SELECT count(*) FROM place WHERE list_contains(kinds, ?)", [kind]).fetchone()[0]
        print(f"  {kind:<10} {n:>7}")
    total, covered = con.execute("SELECT count(*), count(DISTINCT city || state) FROM place").fetchone()
    print(f"  {total} places in {covered} of {len(cities)} cities ({time.time() - started:.0f} s).")
    if total == 0:
        sys.exit("Nothing matched, so the existing list was left alone.")
    if not args.dry_run:
        write(con, url)


if __name__ == "__main__":
    main()
