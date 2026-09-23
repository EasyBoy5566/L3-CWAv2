"""Windy Map Forecast embed. The Windy SDK requires its key in the browser."""

import json


def build_windy_html(*, api_key: str, overlay: str, place: str, center: tuple[float, float], zoom: int) -> str:
    """Embed Windy's documented browser SDK and return a picker on map clicks."""
    payload = json.dumps({"key": api_key, "overlay": overlay, "place": place}, ensure_ascii=True)
    payload = payload.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    lat, lon = center
    return f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="preconnect" href="https://api.windy.com">
<script src="https://unpkg.com/leaflet@1.4.0/dist/leaflet.js"></script>
<script src="https://api.windy.com/assets/map-forecast/libBoot.js"></script>
<style>
*{{box-sizing:border-box}}html,body,#windy{{width:100%;height:100%;min-height:680px;margin:0;overflow:hidden}}
body{{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}}
#windy #bottom,#windy #mobile-ovr-select,#windy #embed-zoom{{display:none!important}}
#windy #logo-wrapper{{bottom:16px!important;left:12px!important}}
#boot-error{{display:none;position:fixed;left:20px;bottom:18px;padding:11px 14px;border-radius:10px;background:rgba(255,255,255,.95);color:#48544f;font-size:12px;box-shadow:0 3px 16px #0001;z-index:900}}
</style></head><body><div id="windy"></div><div id="boot-error">Windy 天氣圖暫時無法載入，請檢查 Map Forecast API key 與授權網域。</div>
<script>
const cfg={payload};
const view={{lat:{lat},lon:{lon},zoom:{zoom}}};
window.addEventListener('error',()=>{{document.getElementById('boot-error').style.display='block'}});
if(typeof windyInit==='function'){{
  windyInit({{key:cfg.key,lat:view.lat,lon:view.lon,zoom:view.zoom,overlay:cfg.overlay,verbose:true}},api=>{{
    const{{map,picker}}=api;
    map.on('click',event=>{{try{{picker.open({{lat:event.latlng.lat,lon:event.latlng.lng}})}}catch(_){{}}}});
  }});
}}else{{document.getElementById('boot-error').style.display='block'}}
</script></body></html>"""
