/* Kindi Browser api.js — OData + STAC + Nominatim + WKT parser + demo fallback */
const ODATA_BASE = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products";
const STAC_BASE = "https://stac.dataspace.copernicus.eu/v1/search";
const QL = id => `${ODATA_BASE}(${id})/Quicklook`;
const ODATA_ONE = id => `${ODATA_BASE}(${id})?$expand=Attributes`;

let API_MODE = "live"; // live | demo

const MISSIONS = { S2: "SENTINEL-2", S1: "SENTINEL-1", S3: "SENTINEL-3", S5P: "SENTINEL-5P" };

/* Small WKT POLYGON/MULTIPOLYGON parser -> GeoJSON coords */
function wktToGeoJSON(wkt) {
  try {
    if (!wkt) return null;
    const inner = wkt.replace(/^geography'SRID=4326;/i, "").replace(/^'/, "").replace(/'$/, "").trim();
    const grabRings = s => {
      const rings = [];
      const re = /\(\s*([^()]+?)\s*\)/g; let m;
      while ((m = re.exec(s))) {
        const pts = m[1].split(",").map(p => {
          const n = p.trim().split(/\s+/).map(Number);
          return [n[0], n[1]];
        }).filter(p => p.length === 2 && isFinite(p[0]));
        if (pts.length >= 4) rings.push(pts);
      }
      return rings;
    };
    if (/MULTIPOLYGON/i.test(inner)) {
      const polys = [];
      const re = /\(\(\([^()]+?\)\)\)|\(\([^()]+?\)\)/g; let m;
      // simpler: split top-level by ')),(('
      const body = inner.replace(/^\s*MULTIPOLYGON\s*\(\s*/i, "").replace(/\s*\)\s*$/, "");
      const parts = body.split(/\)\)\s*,\s*\(\(/);
      parts.forEach(pt => { const rings = grabRings(pt); if (rings.length) polys.push(rings); });
      if (polys.length) return { type: "MultiPolygon", coordinates: polys };
    }
    const rings = grabRings(inner);
    if (rings.length) return { type: "Polygon", coordinates: rings };
    return null;
  } catch (e) { return null; }
}

function boundsToWktPolygon(bounds) {
  // bounds: L.latLngBounds -> WKT polygon lon lat order
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  const w = sw.lng, s = sw.lat, e = ne.lng, n = ne.lat;
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

function polygonToWkt(latlngs) {
  const ring = latlngs[0].map(p => `${p.lng} ${p.lat}`).join(",");
  return `POLYGON((${ring}))`;
}

function buildODataURL({ mission = "S2", from, to, wkt, cloud = 100, top = 20 }) {
  const col = MISSIONS[mission] || MISSIONS.S2;
  const f = [`Collection/Name eq '${col}'`];
  if (from) f.push(`ContentDate/Start gt ${from}T00:00:00.000Z`);
  if (to) f.push(`ContentDate/Start lt ${to}T23:59:59.000Z`);
  if (wkt) f.push(`OData.CSC.Intersects(area=geography'SRID=4326;${wkt}')`);
  if (cloud < 100 && col === "SENTINEL-2")
    f.push(`Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt ${cloud})`);
  const q = `$filter=${f.join(" and ")}&$top=${top}&$expand=Attributes&$orderby=ContentDate/Start desc&$format=json`;
  return `${ODATA_BASE}?${q}`;
}

function normProduct(p) {
  const attrs = {};
  (p.Attributes || []).forEach(a => { attrs[a.Name] = a.Value; });
  const gj = p.Footprint ? wktToGeoJSON(p.Footprint) : null;
  return {
    id: p.Id, name: p.Name || p.Id,
    date: (p.ContentDate && p.ContentDate.Start) || p.ContentDate || "",
    cloud: attrs.cloudCover ?? attrs.CloudCover ?? null,
    platform: attrs.platformShortName || attrs.platform || (p.Name || "").slice(0, 3),
    size: p.ContentLength || 0, footprintWkt: p.Footprint || "",
    geojson: gj, quicklook: QL(p.Id),
    odata: ODATA_ONE(p.Id),
    stac: `${STAC_BASE}`,
    origin: `https://browser.dataspace.copernicus.eu/`,
    raw: p, attrs
  };
}

/* 6 realistic demo products over Algeria */
function demoProducts() {
  const mk = (id, name, date, cloud, wkt) => ({
    id, name, date, cloud, platform: name.slice(0, 3),
    size: 0, footprintWkt: "geography'SRID=4326;" + wkt,
    geojson: wktToGeoJSON("geography'SRID=4326;" + wkt),
    quicklook: QL(id), odata: ODATA_ONE(id), stac: STAC_BASE,
    origin: "https://browser.dataspace.copernicus.eu/", raw: { Id: id, Name: name }, attrs: {}
  });
  return [
    mk("demo-s2a-01", "S2A_MSIL2A_20240118T103321_N0510_R108_T31SFB_20240118T131138", "2024-01-18T10:33:00Z", 4.2, "POLYGON((2.0 35.5,4.2 35.5,4.2 36.6,2.0 36.6,2.0 35.5))"),
    mk("demo-s2b-02", "S2B_MSIL2A_20240202T102959_N0510_R065_T31SDA_20240202T140455", "2024-02-02T10:29:00Z", 12.7, "POLYGON((5.5 33.0,7.8 33.0,7.8 34.1,5.5 34.1,5.5 33.0))"),
    mk("demo-s1a-03", "S1A_IW_GRDH_1SDV_20240125T175432_20240125T175457_041234", "2024-01-25T17:54:00Z", null, "POLYGON((-1.5 31.0,1.5 31.0,1.5 32.6,-1.5 32.6,-1.5 31.0))"),
    mk("demo-s2a-04", "S2A_MSIL2A_20240310T104031_N0510_R008_T30SYH_20240310T155212", "2024-03-10T10:40:00Z", 1.1, "POLYGON((-8.0 27.5,-5.0 27.5,-5.0 29.0,-8.0 29.0,-8.0 27.5))"),
    mk("demo-s2b-05", "S2B_MSIL1C_20240220T103639_N0510_R108_T31TFN_20240220T122411", "2024-02-20T10:36:00Z", 28.9, "POLYGON((7.0 36.5,9.5 36.5,9.5 37.8,7.0 37.8,7.0 36.5))"),
    mk("demo-s3a-06", "S3A_OL_1_EFR____20240211T093812_20240211T094112_20240212T143511", "2024-02-11T09:38:00Z", null, "POLYGON((0.0 22.0,6.0 22.0,6.0 26.0,0.0 26.0,0.0 22.0))")
  ];
}

async function searchOData(opts) {
  const url = buildODataURL(opts);
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 18000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    clearTimeout(to);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const vals = j.value || j.d?.results || [];
    API_MODE = "live";
    return { mode: "live", url, items: vals.map(normProduct) };
  } catch (e) {
    clearTimeout(to);
    // STAC fallback attempt
    try {
      const stac = await searchStac(opts);
      if (stac.items.length) { API_MODE = "live"; return stac; }
    } catch (_) { /* ignore */ }
    API_MODE = "demo";
    return { mode: "demo", url, items: demoProducts(), error: String(e && e.message || e) };
  }
}

async function searchStac({ wkt, from, to, top = 20 }) {
  // Minimal STAC POST; dataspace STAC uses GeoJSON intersects
  let geom = null;
  const gj = wkt ? wktToGeoJSON("geography'SRID=4326;" + wkt) : null;
  if (gj) geom = gj.type === "Polygon" ? gj : null;
  const body = { limit: top, intersects: geom, datetime: `${from || "2024-01-01"}T00:00:00Z/${to || "2024-03-01"}T23:59:59Z` };
  const r = await fetch(STAC_BASE, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("STAC " + r.status);
  const j = await r.json();
  const feats = j.features || [];
  const items = feats.slice(0, top).map((f, i) => ({
    id: f.id || ("stac-" + i), name: f.id || ("STAC_" + i),
    date: (f.properties && f.properties.datetime) || "",
    cloud: f.properties ? (f.properties["eo:cloud_cover"] ?? null) : null,
    platform: (f.properties && (f.properties.platform || f.properties["eo:platform"])) || "S2",
    size: 0, footprintWkt: "", geojson: f.geometry || null,
    quicklook: (f.assets && f.assets.thumbnail && f.assets.thumbnail.href) || "",
    odata: ODATA_BASE, stac: STAC_BASE, origin: "https://browser.dataspace.copernicus.eu/",
    raw: f, attrs: f.properties || {}
  }));
  return { mode: "live", url: STAC_BASE, items };
}

/* Nominatim location search (debounced by caller) */
async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("geocode " + r.status);
  return r.json();
}
