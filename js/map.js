/* Kindi Browser map.js — Leaflet setup, bases incl. GIBS, draw, footprints, presets, compare, timelapse */
let MAP, baseLayers = {}, overlayHL = null, footprintLayer = null, aoiLayer = null, measureLayer = null;
let AOI_WKT = "", AOI_BOUNDS = null;
let GIBS_DATE = new Date().toISOString().slice(0, 10);
let overlayA = null, overlayB = null, timelapseTimer = null, timelapseIdx = 0, timelapseOn = false;
let currentBaseKey = "esri", currentPreset = "true";

const GIBS_TMPL = {
  trueColor: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible_Level{z}/{z}/{y}/{x}.jpg",
  viirs: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible_Level{z}/{z}/{y}/{x}.jpg",
  ndvi: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/{Time}/GoogleMapsCompatible_Level{z}/{z}/{y}/{x}.png",
  falseColor: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_Bands721/default/{Time}/GoogleMapsCompatible_Level{z}/{z}/{y}/{x}.jpg"
};
function gibsURL(kind, date) {
  return (GIBS_TMPL[kind] || GIBS_TMPL.trueColor).replaceAll("{Time}", date || GIBS_DATE);
}
function gibsLayer(kind, date, opacity = 1) {
  return L.tileLayer(gibsURL(kind, date), {
    tileSize: 256, minZoom: 1, maxZoom: 19, maxNativeZoom: 9, opacity,
    attribution: 'Imagery: NASA EOSDIS GIBS',
    crossOrigin: true
  });
}
function applyTileFilter(layer, filter) {
  // Visual differentiator for approx. presets (SAR/DEM/NDWI reuse optical tiles)
  if (!layer) return;
  const set = () => { try { const c = layer.getContainer(); if (c) c.style.filter = filter || ""; } catch (e) {} };
  set(); setTimeout(set, 400);
}

const PRESETS = {
  true:  { kind: "trueColor", legend: ["#0a1628", "#7fb2ff", "#ffffff"], label: "pTrue", filter: "" },
  false: { kind: "falseColor", legend: ["#101010", "#ff5470", "#ffb020"], label: "pFalse", filter: "saturate(1.4) hue-rotate(-25deg)" },
  ndvi:  { kind: "ndvi", legend: ["#5a2b00", "#ffb020", "#00e5a0"], label: "pNDVI", filter: "" },
  ndwi:  { kind: "trueColor", legend: ["#0a1628", "#00c8ff", "#e8f1ff"], label: "pNDWI", filter: "saturate(1.7) hue-rotate(18deg)" },
  swir:  { kind: "falseColor", legend: ["#060d1a", "#ff9c41", "#ffe08a"], label: "pSWIR", filter: "saturate(1.5) sepia(.25)" },
  vv:    { kind: "viirs", legend: ["#060d1a", "#8ca0b8", "#ff5470"], label: "pVV", filter: "grayscale(1) contrast(1.35) brightness(1.05)" },
  vh:    { kind: "viirs", legend: ["#060d1a", "#8ca0b8", "#00c8ff"], label: "pVH", filter: "grayscale(1) contrast(1.2) brightness(1.12)" },
  dem:   { kind: "ndvi", legend: ["#060d1a", "#3a5a40", "#ffffff"], label: "pDEM", filter: "sepia(.55) hue-rotate(-15deg) contrast(1.25)" }
};

function initMap() {
  MAP = L.map("map", { center: [28.0, 2.5], zoom: 5, zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: "bottomright" }).addTo(MAP);

  baseLayers = {
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }),
    esri: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery: Esri, Maxar, Earthstar Geographics" }),
    dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, attribution: "&copy; OpenStreetMap &copy; CARTO" }),
    gibsT: gibsLayer("trueColor"),
    gibsV: gibsLayer("viirs"),
    gibsN: gibsLayer("ndvi")
  };
  baseLayers.esri.addTo(MAP);
  overlayHL = gibsLayer("trueColor", GIBS_DATE, 0.55);
  overlayHL.addTo(MAP);

  footprintLayer = L.geoJSON(null, {
    style: { color: "#00C8FF", weight: 1.5, fillOpacity: 0.06 },
    onEachFeature: (f, l) => { if (f.properties && f.properties.name) l.bindTooltip(f.properties.name, { sticky: true }); }
  }).addTo(MAP);
  aoiLayer = L.layerGroup().addTo(MAP);
  measureLayer = L.layerGroup().addTo(MAP);

  initDraw();
  MAP.on("moveend zoomend", refreshStatus);
  MAP.on("mousemove", e => {
    const el = document.getElementById("stCoords");
    if (el) el.textContent = `${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}`;
  });
  applyCompare();
}

function setBase(key) {
  Object.values(baseLayers).forEach(l => { if (MAP.hasLayer(l)) MAP.removeLayer(l); });
  currentBaseKey = key;
  baseLayers[key].addTo(MAP);
  if (overlayHL && !MAP.hasLayer(overlayHL)) overlayHL.addTo(MAP);
  // keep footprints on top
  if (footprintLayer) footprintLayer.bringToFront();
  document.querySelectorAll(".basebtn").forEach(b => b.classList.toggle("on", b.dataset.base === key));
}

function setPreset(key, opacity) {
  currentPreset = key;
  const p = PRESETS[key] || PRESETS.true;
  const op = (opacity == null ? (parseInt(document.getElementById("visOp")?.value ?? 85) / 100) : opacity);
  if (overlayHL) MAP.removeLayer(overlayHL);
  overlayHL = gibsLayer(p.kind, GIBS_DATE, op);
  overlayHL.addTo(MAP);
  applyTileFilter(overlayHL, p.filter);
  if (footprintLayer) footprintLayer.bringToFront();
  renderLegend(p);
  // compare A follows preset
  setCompareLayer("A", p.kind);
}

function renderLegend(p) {
  const el = document.getElementById("legendBar");
  if (!el) return;
  el.style.background = `linear-gradient(90deg, ${p.legend.join(",")})`;
  const lab = document.getElementById("legendLab");
  if (lab) lab.textContent = t(p.label);
}

/* ---- Draw / measure ---- */
let drawCtl = null, measureMode = null, measurePts = [];
function initDraw() {
  try {
    if (!L.Draw) return;
    drawCtl = new L.Control.Draw({
      position: "topright", draw: { polyline: false, circle: false, marker: false, circlemarker: false, polygon: true, rectangle: true },
      edit: { featureGroup: aoiLayer }
    });
  } catch (e) { drawCtl = null; }
  MAP.on(L.Draw ? L.Draw.Event.CREATED : "draw:created", e => {
    const layer = e.layer || e;
    setAOILayer(layer);
    document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
  });
  MAP.on("click", e => {
    if (!measureMode) return;
    measurePts.push(e.latlng);
    L.circleMarker(e.latlng, { radius: 4, color: "#FFB020" }).addTo(measureLayer);
    if (measureMode === "d" && measurePts.length === 2) {
      const d = MAP.distance(measurePts[0], measurePts[1]) / 1000;
      L.polyline(measurePts, { color: "#FFB020" }).addTo(measureLayer);
      toast(`${d.toFixed(2)} ${t("km")}`);
      measurePts = []; measureMode = null;
      document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
    }
    if (measureMode === "a" && measurePts.length === 3) {
      const poly = L.polygon(measurePts, { color: "#FFB020" }).addTo(measureLayer);
      const area = approxAreaHa(measurePts);
      toast(`${area.toFixed(1)} ${t("ha")}`);
      measurePts = []; measureMode = null; void poly;
      document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
    }
  });
}
function approxAreaHa(pts) {
  // rough planar approx
  const R = 6371000, m = pts.map(p => [p.lng * Math.cos(p.lat * Math.PI / 180) * R * Math.PI / 180, p.lat * R * Math.PI / 180]);
  let a = 0;
  for (let i = 0; i < m.length; i++) { const [x1, y1] = m[i], [x2, y2] = m[(i + 1) % m.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2) / 10000;
}
function setAOILayer(layer) {
  aoiLayer.clearLayers();
  layer.setStyle ? layer.setStyle({ color: "#00E5A0", weight: 2, fillOpacity: 0.08 }) : null;
  aoiLayer.addLayer(layer);
  try {
    if (layer.getBounds) {
      AOI_BOUNDS = layer.getBounds();
      AOI_WKT = boundsToWktPolygon(AOI_BOUNDS);
    } else if (layer.getLatLngs) {
      AOI_WKT = polygonToWkt(layer.getLatLngs());
      AOI_BOUNDS = layer.getBounds();
    }
  } catch (e) { AOI_WKT = ""; }
  const ind = document.getElementById("aoiState");
  if (ind) { ind.textContent = AOI_WKT ? t("aoiSet") : t("aoiNone"); ind.classList.toggle("ok", !!AOI_WKT); }
}
function armTool(btn, mode) {
  document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
  if (btn) btn.classList.add("armed");
  measureMode = mode; measurePts = [];
}
function startRect(btn) {
  document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
  if (btn) btn.classList.add("armed");
  if (L.Draw && drawCtl) new L.Draw.Rectangle(MAP).enable();
  else toast("Draw N/A");
}
function startPoly(btn) {
  document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
  if (btn) btn.classList.add("armed");
  if (L.Draw && drawCtl) new L.Draw.Polygon(MAP).enable();
  else toast("Draw N/A");
}
function clearAll() {
  aoiLayer.clearLayers(); measureLayer.clearLayers(); footprintLayer.clearLayers();
  AOI_WKT = ""; AOI_BOUNDS = null; measureMode = null; measurePts = [];
  document.querySelectorAll("#rightBar button").forEach(b => b.classList.remove("armed"));
  const ind = document.getElementById("aoiState");
  if (ind) { ind.textContent = t("aoiNone"); ind.classList.remove("ok"); }
  toast(t("clearOk"));
}

/* ---- Footprints ---- */
function showFootprints(items) {
  footprintLayer.clearLayers();
  const feats = items.filter(i => i.geojson).map(i => ({
    type: "Feature", properties: { name: i.name, id: i.id },
    geometry: i.geojson
  }));
  if (feats.length) {
    footprintLayer.addData({ type: "FeatureCollection", features: feats });
    try { MAP.fitBounds(footprintLayer.getBounds().pad(0.2)); } catch (e) {}
  }
  footprintLayer.bringToFront();
}

/* ---- Compare (clip-path split) ---- */
function setCompareLayer(slot, kind) {
  const op = parseInt(document.getElementById("cmpOp")?.value ?? 100) / 100;
  if (slot === "A") {
    if (overlayA) MAP.removeLayer(overlayA);
    overlayA = gibsLayer(kind, GIBS_DATE, 1); overlayA.addTo(MAP);
  } else {
    if (overlayB) MAP.removeLayer(overlayB);
    overlayB = gibsLayer(kind, document.getElementById("cmpDateB")?.value || GIBS_DATE, op);
    overlayB.addTo(MAP);
  }
  applyCompare();
}
function applyCompare() {
  const pos = parseInt(document.getElementById("cmpPos")?.value ?? 50);
  const split = document.getElementById("splitMode");
  const on = !split || split.checked;
  // Single-source overlays: split ON hides the visualize layer + footprints
  // so the A/B divider is crisp (no bleed-through); everything is restored on OFF.
  if (MAP) {
    if (on) {
      if (overlayHL && MAP.hasLayer(overlayHL)) MAP.removeLayer(overlayHL);
      if (footprintLayer && MAP.hasLayer(footprintLayer)) MAP.removeLayer(footprintLayer);
      if (!overlayA) overlayA = gibsLayer("trueColor", GIBS_DATE, 1);
      if (!overlayB) overlayB = gibsLayer("viirs", GIBS_DATE, 1);
      if (!MAP.hasLayer(overlayA)) overlayA.addTo(MAP);
      if (!MAP.hasLayer(overlayB)) overlayB.addTo(MAP);
    } else {
      if (overlayA && MAP.hasLayer(overlayA)) MAP.removeLayer(overlayA);
      if (overlayB && MAP.hasLayer(overlayB)) MAP.removeLayer(overlayB);
      if (overlayHL && !MAP.hasLayer(overlayHL)) overlayHL.addTo(MAP);
      if (footprintLayer && !MAP.hasLayer(footprintLayer)) { footprintLayer.addTo(MAP); footprintLayer.bringToFront(); }
    }
  }
  const rtl = document.documentElement.dir === "rtl";
  [overlayA, overlayB].forEach((l, i) => {
    if (!l || !l.getContainer) return;
    const c = l.getContainer(); if (!c) return;
    if (!on) { c.style.clipPath = "none"; return; }
    // A = start side, B = end side
    if (i === 0) c.style.clipPath = rtl ? `inset(0 0 0 ${100 - pos}%)` : `inset(0 ${100 - pos}% 0 0)`;
    else c.style.clipPath = rtl ? `inset(0 ${pos}% 0 0)` : `inset(0 0 0 ${pos}%)`;
  });
  const div = document.getElementById("cmpDiv");
  if (div) { div.style.insetInlineStart = `calc(${pos}% - 1px)`; div.style.display = on ? "block" : "none"; }
  const lab = document.getElementById("cmpPosV"); if (lab) lab.textContent = pos + "%";
}

/* ---- Timelapse over GIBS date ---- */
function tlDates() {
  const a = document.getElementById("tlFrom")?.value, b = document.getElementById("tlTo")?.value;
  const out = [];
  if (!a || !b) return out;
  let d = new Date(a), end = new Date(b);
  while (d <= end && out.length <= 60) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}
function tlStep() {
  const dates = tlDates(); if (!dates.length) return stopTL();
  GIBS_DATE = dates[timelapseIdx % dates.length];
  timelapseIdx++;
  const speed = parseInt(document.getElementById("tlSpeed")?.value ?? 3);
  const lab = document.getElementById("tlDate"); if (lab) lab.textContent = GIBS_DATE;
  if (overlayHL) overlayHL.setUrl(gibsURL(PRESETS[currentPreset]?.kind || "trueColor", GIBS_DATE));
  if (overlayA) overlayA.setUrl(gibsURL(document.getElementById("cmpA")?.value || "trueColor", GIBS_DATE));
  timelapseTimer = setTimeout(tlStep, Math.max(300, 2200 - speed * 300));
}
function playTL() {
  if (timelapseOn) return stopTL();
  timelapseOn = true; timelapseIdx = 0;
  const b = document.getElementById("tlPlayBtn"); if (b) b.textContent = "⏸ " + t("tlPause");
  tlStep();
}
function stopTL() {
  timelapseOn = false; clearTimeout(timelapseTimer);
  const b = document.getElementById("tlPlayBtn"); if (b) b.textContent = "▶ " + t("tlPlay");
}
