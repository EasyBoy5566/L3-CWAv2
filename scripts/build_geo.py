"""Build public/static/geo/taiwan-counties.json: python -m scripts.build_geo

Source: taiwan-atlas counties-10t.json (MIT), a simplified TopoJSON of the
Ministry of the Interior's 直轄市、縣市界線(TWD97經緯度), data.gov.tw dataset
7442, published under the Open Government Data License v1.0. This decodes the
TopoJSON to GeoJSON, keeps each county's name, and checks every name against
the 22 CWA county names so the globe and the database agree.
"""

import json

import requests

from app import config
from etl.counties import COUNTIES

SOURCE = "https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/counties-10t.json"
TARGET = config.ROOT_DIR / "public" / "static" / "geo" / "taiwan-counties.json"
DECIMALS = 4  # about 11 m, far below what the globe can show at county scale


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


def main() -> None:
    topology = requests.get(SOURCE, timeout=30).json()
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
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"{len(features)} counties, {TARGET.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
