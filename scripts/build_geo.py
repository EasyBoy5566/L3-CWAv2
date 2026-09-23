"""Build the boundary files the globe draws: python -m scripts.build_geo

Source: taiwan-atlas (MIT), simplified TopoJSON of the Ministry of the
Interior's boundary datasets on data.gov.tw, published under the Open
Government Data License v1.0:

- counties-10t.json  直轄市、縣市界線(TWD97經緯度), dataset 7442
- towns-10t.json     鄉鎮市區界線(TWD97經緯度), dataset 7441

Counties are decoded to GeoJSON. Townships stay TopoJSON, which shares each
border between its two neighbours and is several times smaller; the browser
decodes it. Every name is checked against CWA's so the map and the data agree.
"""

import json

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
            "properties": {"name": name},
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
    GEO.mkdir(parents=True, exist_ok=True)
    counties()
    towns()


if __name__ == "__main__":
    main()
