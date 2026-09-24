"""Copy the browser libraries into public/: python -m scripts.vendor_libs

The globe cannot start without Cesium.js (1.6 MB compressed), and public
CDNs are not reliable enough to hang the first view on: from here jsDelivr
at times failed to connect for minutes. Served from public/, the libraries
come from Vercel's edge over the connection that already delivered the page.

Each library lands in a versioned folder, so vercel.json can mark it
immutable. Only what the page loads is kept: Cesium's ESM bundles (9 MB)
are left out. Sources are the npm registry's release tarballs.
"""

import io
import shutil
import tarfile

import requests

from app import config

VENDOR = config.ROOT_DIR / "public" / "static" / "vendor"
CACHE = config.ROOT_DIR / ".runtime" / "npm"
CESIUM = "1.145.0"
ECHARTS = "5.6.0"

# (package, version, [(path in the tarball, path under the vendor folder)])
LIBRARIES = [
    ("cesium", CESIUM, [
        ("package/Build/Cesium/Cesium.js", "Cesium.js"),
        ("package/Build/Cesium/Assets/", "Assets/"),
        ("package/Build/Cesium/ThirdParty/", "ThirdParty/"),
        ("package/Build/Cesium/Widgets/", "Widgets/"),
        ("package/Build/Cesium/Workers/", "Workers/"),
        ("package/LICENSE.md", "LICENSE.md"),
    ]),
    ("echarts", ECHARTS, [
        ("package/dist/echarts.min.js", "echarts.min.js"),
        ("package/LICENSE", "LICENSE"),
    ]),
]


def tarball(package: str, version: str) -> bytes:
    """The release tarball, kept in .runtime/ so a rerun needs no network."""
    cached = CACHE / f"{package}-{version}.tgz"
    if cached.exists():
        return cached.read_bytes()
    url = f"https://registry.npmjs.org/{package}/-/{package}-{version}.tgz"
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=300)
            response.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 2:
                raise
    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(response.content)
    return response.content


def vendor(package: str, version: str, picks: list[tuple[str, str]]) -> None:
    content = tarball(package, version)
    target = VENDOR / f"{package}-{version}"
    if target.exists():
        shutil.rmtree(target)
    count = 0
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            for source, destination in picks:
                if member.name == source or (source.endswith("/") and member.name.startswith(source)):
                    path = target / (destination + member.name[len(source):] if source.endswith("/") else destination)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(archive.extractfile(member).read())
                    count += 1
                    break
    size = sum(p.stat().st_size for p in target.rglob("*") if p.is_file())
    print(f"{package} {version}: {count} files, {size / 1e6:.1f} MB -> {target.relative_to(config.ROOT_DIR)}")


def main() -> None:
    for package, version, picks in LIBRARIES:
        vendor(package, version, picks)


if __name__ == "__main__":
    main()
