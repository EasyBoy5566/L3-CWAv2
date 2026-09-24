"""Build the boundary files the globe draws: python -m scripts.build_geo

Source: taiwan-atlas (MIT), simplified TopoJSON of the Ministry of the
Interior's boundary datasets on data.gov.tw, published under the Open
Government Data License v1.0:

- counties-10t.json  直轄市、縣市界線(TWD97經緯度), dataset 7442
- towns-10t.json     鄉鎮市區界線(TWD97經緯度), dataset 7441

Counties are decoded to GeoJSON. Townships stay TopoJSON, which shares each
border between its two neighbours and is several times smaller; the browser
decodes it. Every name is checked against CWA's so the map and the data agree.

Each county also gets a label point, where its value standee stands (see
label_point). `python -m scripts.build_geo labels` recomputes just those in
the existing file, without downloading anything.
"""

import heapq
import json
import math
import sys

import requests

from app import config
from etl.counties import COUNTIES

ATLAS = "https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20"
GEO = config.ROOT_DIR / "public" / "static" / "geo"
DECIMALS = 4  # about 11 m, far below what the globe can show at county scale
# The township names CWA uses, from a heat-index sample that lists all 368.
CWA_TOWNS = config.ROOT_DIR / "tests" / "samples" / "M-A0085-001.json"


def decode_arcs(topology: dict) -> list[list[list[float]]]:
    scale = topology["transform"]["scale"]
    translate = topology["transform"]["translate"]
    arcs = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append([round(x * scale[0] + translate[0], DECIMALS),
                           round(y * scale[1] + translate[1], DECIMALS)])
        arcs.append(points)
    return arcs


def ring(indices: list[int], arcs: list) -> list:
    points = []
    for index in indices:
        arc = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
        points.extend(arc if not points else arc[1:])
    return points


# ---------- label points ----------
# Where a county's standee stands: its area centroid when that lies well inside
# it, which follows long counties (Pingtung's southern tail, Taitung) better
# than their widest part does; otherwise the pole of inaccessibility (Mapbox's
# polylabel), the point furthest from any border, for counties the centroid
# falls near the edge of or outside (New Taipei around Taipei, Chiayi County
# around Chiayi City, Penghu's islands). Only the largest polygon counts, and
# holes do. Worked in a plane where longitude is scaled by cos(latitude).

def _area(ring: list) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def _distance(x: float, y: float, rings: list) -> float:
    """Distance to the nearest border; negative outside (holes count as outside)."""
    inside = False
    best = math.inf
    for ring in rings:
        for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
            dx, dy = bx - ax, by - ay
            t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
            best = min(best, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2)
    return (1 if inside else -1) * math.sqrt(best)


def _pole(rings: list, precision: float = 0.002) -> tuple[float, float, float]:
    """(clearance, x, y) of the pole of inaccessibility: a best-first search over cells."""
    xs = [p[0] for p in rings[0]]
    ys = [p[1] for p in rings[0]]
    size = min(max(xs) - min(xs), max(ys) - min(ys))
    cells = []

    def push(x: float, y: float, half: float) -> None:
        d = _distance(x, y, rings)
        heapq.heappush(cells, (-(d + half * math.sqrt(2)), d, x, y, half))

    x = min(xs)
    while x < max(xs):
        y = min(ys)
        while y < max(ys):
            push(x + size / 2, y + size / 2, size / 2)
            y += size
        x += size
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    best = (_distance(cx, cy, rings), cx, cy)
    while cells:
        _, d, x, y, half = heapq.heappop(cells)
        if d > best[0]:
            best = (d, x, y)
        if d + half * math.sqrt(2) - best[0] > precision:
            for dx in (-half / 2, half / 2):
                for dy in (-half / 2, half / 2):
                    push(x + dx, y + dy, half / 2)
    return best


def label_point(polygons: list) -> list[float]:
    """[lon, lat] of a county's label point (see above)."""
    main = max(polygons, key=lambda polygon: abs(_area(polygon[0])))
    k = math.cos(math.radians(sum(p[1] for p in main[0]) / len(main[0])))
    rings = [[(lon * k, lat) for lon, lat in ring] for ring in main]
    area = x = y = 0.0
    for index, ring in enumerate(rings):
        a = abs(_area(ring)) * (-1 if index else 1)
        n = len(ring)
        cross = [ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n)]
        signed = sum(cross) / 2
        cx = sum((ring[i][0] + ring[(i + 1) % n][0]) * cross[i] for i in range(n)) / (6 * signed)
        cy = sum((ring[i][1] + ring[(i + 1) % n][1]) * cross[i] for i in range(n)) / (6 * signed)
        area += a
        x += cx * a
        y += cy * a
    centroid = (x / area, y / area)
    clearance, px, py = _pole(rings)
    # Well inside: at least 40% of the pole's clearance and 2 km (0.018°) from any border.
    use = centroid if _distance(*centroid, rings) >= max(0.4 * clearance, 0.018) else (px, py)
    return [round(use[0] / k, DECIMALS), round(use[1], DECIMALS)]


def labels() -> None:
    """Recompute the label points in the existing counties file."""
    target = GEO / "taiwan-counties.json"
    collection = json.loads(target.read_text(encoding="utf-8"))
    for feature in collection["features"]:
        feature["properties"]["label"] = label_point(feature["geometry"]["coordinates"])
    target.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"label points for {len(collection['features'])} counties")


def counties() -> None:
    topology = requests.get(f"{ATLAS}/counties-10t.json", timeout=30).json()
    arcs = decode_arcs(topology)
    features = []
    for geometry in topology["objects"]["counties"]["geometries"]:
        name = geometry["properties"]["COUNTYNAME"].replace("台", "臺")
        if geometry["type"] == "Polygon":
            coordinates = [[ring(r, arcs) for r in geometry["arcs"]]]
        elif geometry["type"] == "MultiPolygon":
            coordinates = [[ring(r, arcs) for r in polygon] for polygon in geometry["arcs"]]
        else:
            continue
        features.append({
            "type": "Feature",
            "properties": {"name": name, "label": label_point(coordinates)},
            "geometry": {"type": "MultiPolygon", "coordinates": coordinates},
        })
    names = {feature["properties"]["name"] for feature in features}
    if names != set(COUNTIES):
        raise SystemExit(f"county names differ from CWA: {sorted(names ^ set(COUNTIES))}")
    target = GEO / "taiwan-counties.json"
    target.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"{len(features)} counties, {target.stat().st_size // 1024} KB")


def towns() -> None:
    topology = requests.get(f"{ATLAS}/towns-10t.json", timeout=30).json()
    geometries = []
    for geometry in topology["objects"]["towns"]["geometries"]:
        properties = geometry["properties"]
        geometries.append({
            "type": geometry["type"],
            "arcs": geometry["arcs"],
            "properties": {"county": properties["COUNTYNAME"].replace("台", "臺"), "town": properties["TOWNNAME"]},
        })
    heat = json.loads(CWA_TOWNS.read_text(encoding="utf-8"))["records"]["Locations"]
    cwa = {(c["CountyName"], t["TownName"]) for c in heat for t in c["Location"]}
    ours = {(g["properties"]["county"], g["properties"]["town"]) for g in geometries}
    if ours != cwa:
        raise SystemExit(f"township names differ from CWA: {sorted(ours ^ cwa)[:10]}")
    slim = {
        "type": "Topology",
        "transform": topology["transform"],
        "arcs": topology["arcs"],
        "objects": {"towns": {"type": "GeometryCollection", "geometries": geometries}},
    }
    target = GEO / "taiwan-towns.topo.json"
    target.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(geometries)} townships, {target.stat().st_size // 1024} KB")


def main() -> None:
    if sys.argv[1:] == ["labels"]:
        labels()
        return
    GEO.mkdir(parents=True, exist_ok=True)
    counties()
    towns()


if __name__ == "__main__":
    main()
