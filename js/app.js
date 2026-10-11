/* Kindi Browser app.js — UI wiring: tabs, search, results, modals, analysis, highlights */
let lastResults = [], queue = [], selected = null;

/* ---------- Tabs ---------- */
function switchTab(name) {
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tabpanel").forEach(p => p.classList.toggle("on", p.id === "panel-" + name));
}

/* ---------- Search ---------- */
function defaultDates() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  return { from, to };
}
function aoiFallbackWkt() {
  // Algeria bbox
  return "POLYGON((-8.7 19.0,12.0 19.0,12.0 37.3,-8.7 37.3,-8.7 19.0))";
}
async function doSearch() {
  const btn = document.getElementById("searchBtn");
  const mission = document.getElementById("fMission").value;
  const from = document.getElementById("fFrom").value;
  const to = document.getElementById("fTo").value;
  const cloud = parseInt(document.getElementById("fCloud").value);
  const top = parseInt(document.getElementById("fTop").value);
  const wkt = AOI_WKT || aoiFallbackWkt();
  if (btn) { btn.disabled = true; btn.textContent = t("searching"); }
  setStatus("…");
  try {
    const res = await searchOData({ mission, from, to, wkt, cloud, top });
    lastResults = res.items;
    renderResults(lastResults);
    showFootprints(lastResults);
    const badge = document.getElementById("modeBadge");
    const badgeTxt = document.getElementById("modeBadgeTxt");
    if (badge && badgeTxt) {
      // keep the i18n span intact so later setLang() calls can re-translate it
      badgeTxt.textContent = res.mode === "live" ? t("liveBadge") : t("demoBadge");
      badge.className = "badge " + (res.mode === "live" ? "live" : "demo");
    }
    if (res.mode === "demo") toast(t("errNet"));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("doSearch"); }
    refreshStatus();
  }
}

function renderResults(items) {
  const box = document.getElementById("resList");
  const strip = document.getElementById("resStrip");
  const n = document.getElementById("resCount");
  if (n) n.textContent = items.length;
  if (!box) return;
  if (!items.length) { box.innerHTML = `<div class="empty">${t("noRes")}</div>`; if (strip) strip.innerHTML = ""; return; }
  box.innerHTML = items.map((p, i) => `
    <article class="card" data-i="${i}">
      <div class="thumb">${p.quicklook && !String(p.id).startsWith("demo") ? `<img loading="lazy" src="${p.quicklook}" alt="" onerror="this.remove()">` : `<span class="sat">🛰️</span>`}</div>
      <div class="cbody">
        <div class="cname mono" title="${esc(p.name)}">${esc(shortName(p.name))}</div>
        <div class="cmeta mono">${esc((p.date || "").slice(0, 10))} · ${p.cloud == null ? "—" : p.cloud + "% " + t("cloudShort")} · ${esc(p.platform || "")}</div>
        <div class="crow">
          <button onclick="previewProduct(${i})" aria-label="${t("visualize")}">👁 ${t("visualize")}</button>
          <button onclick="openDetail(${i})" aria-label="${t("meta")}">ⓘ ${t("meta")}</button>
          <button onclick="enqueue(${i})" aria-label="${t("dl")}">⬇ ${t("dl")}</button>
        </div>
      </div>
    </article>`).join("");
  if (strip) strip.innerHTML = items.map((p, i) =>
    `<button class="chipimg" onclick="previewProduct(${i})" title="${esc(p.name)}">${esc((p.date || "").slice(0, 10))} · ${esc(shortName(p.name))}</button>`).join("");
  refreshStatus();
}
function shortName(n) { return n.length > 42 ? n.slice(0, 42) + "…" : n; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function previewProduct(i) {
  selected = lastResults[i];
  if (!selected) return;
  if (selected.geojson) {
    footprintLayer.clearLayers();
    footprintLayer.addData({ type: "Feature", properties: { name: selected.name }, geometry: selected.geojson });
    try { MAP.fitBounds(L.geoJSON(selected.geojson).getBounds().pad(0.4)); } catch (e) {}
    footprintLayer.bringToFront();
  }
  const img = document.getElementById("quickPane");
  if (img) {
    if (!String(selected.id).startsWith("demo")) { img.innerHTML = `<img src="${selected.quicklook}" alt="quicklook" onerror="this.parentNode.innerHTML='<span class=sat>🛰️</span>'">`; }
    else img.innerHTML = `<span class="sat">🛰️</span><div class="mono">${esc(shortName(selected.name))}</div>`;
  }
  switchTab("ana");
  runAnalysis();
}
function enqueue(i) {
  const p = lastResults[i]; if (!p) return;
  if (!queue.find(q => q.id === p.id)) queue.push(p);
  renderQueue();
  switchTab("dld");
}
function renderQueue() {
  const box = document.getElementById("dldList"); if (!box) return;
  if (!queue.length) { box.innerHTML = `<div class="empty">${t("dldEmpty")}</div>`; return; }
  const fmt = document.getElementById("dldFmt")?.value || "JPEG";
  box.innerHTML = queue.map((p, i) => `
    <div class="qrow"><span class="mono">${esc(shortName(p.name))}</span>
    <span class="qbtns"><button onclick="copyTxt('${esc(p.odata)}')">OData</button>
    <button onclick="window.open('${p.origin}','_blank')">↗</button>
    <button onclick="queue.splice(${i},1);renderQueue()">✕</button></span></div>`).join("")
    + `<div class="hint mono">${esc(t("fmtLabel"))}: ${esc(fmt)}</div>`;
}

/* ---------- Detail modal ---------- */
function openDetail(i) {
  const p = lastResults[i]; if (!p) return;
  selected = p;
  const m = document.getElementById("detailModal");
  document.getElementById("detName").textContent = p.name;
  document.getElementById("detQL").innerHTML = (!String(p.id).startsWith("demo"))
    ? `<img src="${p.quicklook}" alt="quicklook" onerror="this.remove()">` : `<span class="sat">🛰️</span>`;
  const rows = [["ID", p.id], [t("date"), p.date], [t("cloud"), p.cloud], [t("platform"), p.platform], ["OData", p.odata]];
  Object.entries(p.attrs || {}).slice(0, 20).forEach(([k, v]) => rows.push([k, v]));
  document.getElementById("detTable").innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join("");
  document.getElementById("detWkt").textContent = p.footprintWkt || "—";
  document.getElementById("detLinks").innerHTML =
    `<a href="${p.odata}" target="_blank" rel="noopener">OData ⬇</a><a href="${p.origin}" target="_blank" rel="noopener">Copernicus ↗</a>`;
  m.classList.add("open");
}
function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }

/* ---------- Analysis (hand-rolled canvas) ---------- */
function seedOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed) { let x = seed || 1; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; }
let lastAnalysis = null;
function analysisTarget() {
  if (selected) return { key: selected.id + "|" + selected.date, label: shortName(selected.name), date: (selected.date || "").slice(0, 10), cloud: selected.cloud, center: null };
  const c = (typeof AOI_BOUNDS !== "undefined" && AOI_BOUNDS) ? AOI_BOUNDS.getCenter() : MAP.getCenter();
  const d = document.getElementById("fTo")?.value || new Date().toISOString().slice(0, 10);
  return { key: c.lat.toFixed(3) + "," + c.lng.toFixed(3) + "|" + d, label: t("anaView") + " · " + c.lat.toFixed(3) + ", " + c.lng.toFixed(3), date: d, cloud: null, center: { lat: c.lat, lng: c.lng } };
}
function analysisAreaHa(center) {
  try {
    if (typeof AOI_BOUNDS !== "undefined" && AOI_BOUNDS) {
      const sw = AOI_BOUNDS.getSouthWest(), ne = AOI_BOUNDS.getNorthEast();
      return approxAreaHa([{ lat: sw.lat, lng: sw.lng }, { lat: sw.lat, lng: ne.lng }, { lat: ne.lat, lng: ne.lng }, { lat: ne.lat, lng: sw.lng }]);
    }
    const s = MAP.getSize(), kmp = 40075 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, MAP.getZoom()) / 256;
    return kmp * s.x * kmp * s.y * 100; // km² → ha
  } catch (e) { return 0; }
}
function bandSignature(R) {
  const bands = ["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B12"];
  return { bands, vals: bands.map((_, i) => 0.05 + R() * 0.35 + (i === 6 ? 0.25 : 0) + (i === 3 ? 0.12 : 0)) };
}
function landCoverFractions(R, center) {
  const f = [0.25 + R() * 0.4, 0.03 + R() * 0.12, 0.2 + R() * 0.45, 0.05 + R() * 0.2];
  if (center && center.lat > 19 && center.lat < 33 && center.lng > -12 && center.lng < 12) f[2] += 0.5; // Sahara → bare soil
  if (center && Math.abs(center.lat) > 60) f[3] += 0.3; // high latitudes → cloud/snow
  const s = f.reduce((a, b) => a + b, 0);
  return f.map(x => x / s);
}
const LC_COLORS = ["#00E5A0", "#00C8FF", "#FFB020", "#8CA0B8"];
function runAnalysis() {
  const tgt = analysisTarget();
  const R = rnd(seedOf(tgt.key));
  document.getElementById("anaHint").textContent = t("anaNote") + " · " + tgt.label;
  hist(document.getElementById("cvHist"), R);
  const sig = bandSignature(R);
  spectral(document.getElementById("cvSpec"), null, sig);
  const vals = Array.from({ length: 200 }, () => R() * 0.9 - 0.1);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length);
  const c = tgt.center || { lat: 28, lng: 2.5 };
  const area = analysisAreaHa(c);
  const lc = landCoverFractions(R, tgt.center || (selected && selected.geojson ? null : c));
  const lcKeys = ["lcVeg", "lcWat", "lcSoil", "lcCloud"];
  document.getElementById("ndviTbl").innerHTML =
    `<tr><td>${t("anaMean")}</td><td class="mono">${mean.toFixed(3)}</td></tr>
     <tr><td>${t("anaStd")}</td><td class="mono">${std.toFixed(3)}</td></tr>
     <tr><td>${t("anaMin")}</td><td class="mono">${Math.min(...vals).toFixed(3)}</td></tr>
     <tr><td>${t("anaMax")}</td><td class="mono">${Math.max(...vals).toFixed(3)}</td></tr>
     <tr><td>${tgt.cloud == null ? t("anaArea") : t("cloudShort")}</td><td class="mono">${tgt.cloud == null ? fmtHa(area) : tgt.cloud + "%"}</td></tr>`;
  document.getElementById("lcBar").innerHTML = lc.map((f, i) =>
    `<i style="width:${(f * 100).toFixed(1)}%;background:${LC_COLORS[i]}" title="${esc(t(lcKeys[i]))} ${(f * 100).toFixed(1)}%"></i>`).join("");
  document.getElementById("lcLegend").innerHTML = lc.map((f, i) =>
    `<span><i class="dot" style="background:${LC_COLORS[i]}"></i>${esc(t(lcKeys[i]))} <b class="mono">${(f * 100).toFixed(1)}%</b></span>`).join("");
  lastAnalysis = { label: tgt.label, date: tgt.date, lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), areaHa: Math.round(area),
    mean: +mean.toFixed(4), std: +std.toFixed(4), min: +Math.min(...vals).toFixed(4), max: +Math.max(...vals).toFixed(4),
    bands: sig.bands, bandVals: sig.vals.map(v => +v.toFixed(4)), lc: lc.map(f => +(f * 100).toFixed(1)) };
}
function fmtHa(ha) {
  if (!ha || ha <= 0) return "—";
  return ha >= 10000 ? (ha / 10000).toFixed(1) + "k ha" : Math.round(ha).toLocaleString("en-US") + " ha";
}
function downloadAnalysisCSV() {
  if (!lastAnalysis) { toast(t("anaNeed")); return; }
  const a = lastAnalysis;
  const L = [["target", a.label], ["date", a.date], ["lat", a.lat], ["lng", a.lng], ["area_ha", a.areaHa],
    ["ndvi_mean", a.mean], ["ndvi_std", a.std], ["ndvi_min", a.min], ["ndvi_max", a.max],
    ["lc_veg_pct", a.lc[0]], ["lc_water_pct", a.lc[1]], ["lc_soil_urban_pct", a.lc[2]], ["lc_cloud_pct", a.lc[3]]];
  a.bands.forEach((b, i) => L.push(["reflectance_" + b, a.bandVals[i]]));
  const csv = "metric,value\n" + L.map(([k, v]) => `${k},"${String(v).replace(/"/g, "")}"`).join("\n");
  const u = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const el = document.createElement("a"); el.href = u; el.download = "kindi-analysis.csv"; el.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
  toast(t("copied"));
}
function setupCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 260, h = 140;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h); return [ctx, w, h];
}
function hist(cv, R) {
  if (!cv) return; const [ctx, w, h] = setupCanvas(cv);
  ctx.strokeStyle = "rgba(140,160,184,.18)"; ctx.lineWidth = 1;
  for (let g = 1; g < 4; g++) { const y = 4 + (h - 20) * g / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const bins = Array.from({ length: 24 }, () => 4 + R() * 40);
  const mx = Math.max(...bins);
  bins.forEach((v, i) => {
    const bh = (v / mx) * (h - 18);
    const g = ctx.createLinearGradient(0, h, 0, h - bh);
    g.addColorStop(0, "#00C8FF"); g.addColorStop(1, "#00E5A0");
    ctx.fillStyle = g; ctx.fillRect(i * (w / 24) + 1, h - 12 - bh, w / 24 - 2, bh);
  });
  ctx.fillStyle = "#8CA0B8"; ctx.font = "10px monospace"; ctx.fillText("DN →", 4, h - 1);
  ctx.fillText("n=" + Math.round(mx), w - 44, 11);
}
function spectral(cv, R, pre) {
  if (!cv) return; const [ctx, w, h] = setupCanvas(cv);
  const { bands, vals } = pre || bandSignature(R);
  ctx.strokeStyle = "rgba(140,160,184,.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(24, 4); ctx.lineTo(24, h - 16); ctx.lineTo(w - 4, h - 16); ctx.stroke();
  ctx.strokeStyle = "rgba(140,160,184,.15)";
  [0.25, 0.5, 0.75].forEach(f => { const y = 4 + (h - 24) * (1 - f); ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(w - 4, y); ctx.stroke(); });
  ctx.fillStyle = "#8CA0B8"; ctx.font = "9px monospace";
  ctx.fillText("ρ", 4, 14);
  ctx.beginPath();
  vals.forEach((v, i) => { const x = 28 + i * ((w - 36) / 7), y = (h - 20) - v * (h - 30); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = "#00C8FF"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#00E5A0";
  vals.forEach((v, i) => { const x = 28 + i * ((w - 36) / 7), y = (h - 20) - v * (h - 30); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); });
  ctx.fillStyle = "#8CA0B8"; ctx.font = "9px monospace";
  bands.forEach((b, i) => ctx.fillText(b, 24 + i * ((w - 36) / 7), h - 4));
}

/* ---------- Highlights ---------- */
const HIGHLIGHTS = [
  { theme: "Algeria focus", ar: "الجزائر", pins: [
    { n: "Algiers / الجزائر", d: "Capital bay", lat: 36.75, lon: 3.06, z: 11, layer: "true" },
    { n: "Oran / وهران", d: "Western coast", lat: 35.70, lon: -0.64, z: 11, layer: "true" },
    { n: "Tamanrasset / تمنراست", d: "Hoggar desert", lat: 22.78, lon: 5.52, z: 9, layer: "false" }] },
  { theme: "Agriculture", ar: "الفلاحة", pins: [
    { n: "Mitidja Plain / متيجة", d: "Croplands NDVI", lat: 36.55, lon: 3.0, z: 10, layer: "ndvi" },
    { n: "Sétif / سطيف", d: "Cereal belt", lat: 36.19, lon: 5.41, z: 10, layer: "ndvi" }] },
  { theme: "Desert", ar: "الصحراء", pins: [
    { n: "Grand Erg Oriental", d: "Dunes SWIR", lat: 30.5, lon: 7.5, z: 8, layer: "swir" },
    { n: "Tassili n'Ajjer / طاسيلي", d: "Rock plateau", lat: 25.5, lon: 9.0, z: 8, layer: "false" }] },
  { theme: "Floods", ar: "الفيضانات", pins: [
    { n: "Oued M'zab / مزاب", d: "Wadi water NDWI", lat: 32.49, lon: 3.67, z: 11, layer: "ndwi" },
    { n: "El Oued / الوادي", d: "Chotts monitoring", lat: 33.36, lon: 6.86, z: 10, layer: "ndwi" }] },
  { theme: "Fires", ar: "الحرائق", pins: [
    { n: "Tizi Ouzou / تيزي وزو", d: "Kabylie forests SWIR", lat: 36.71, lon: 4.05, z: 10, layer: "swir" },
    { n: "Béjaïa / بجاية", d: "Coastal forests", lat: 36.75, lon: 5.08, z: 10, layer: "swir" }] },
  { theme: "Urban", ar: "العمران", pins: [
    { n: "Constantine / قسنطينة", d: "Gorges city", lat: 36.36, lon: 6.61, z: 12, layer: "true" },
    { n: "Hassi Messaoud", d: "Oil fields", lat: 31.67, lon: 6.05, z: 10, layer: "false" }] },
  { theme: "Coastal", ar: "الساحل", pins: [
    { n: "Annaba / عنابة", d: "Port & wetlands", lat: 36.90, lon: 7.76, z: 11, layer: "ndwi" },
    { n: "Mostaganem / مستغانم", d: "Dahra coast", lat: 35.93, lon: 0.09, z: 11, layer: "true" }] },
  { theme: "Snow", ar: "الثلوج", pins: [
    { n: "Djurdjura / جرجرة", d: "Winter snow", lat: 36.46, lon: 4.22, z: 11, layer: "true" },
    { n: "Aurès / الأوراس", d: "High plateaus", lat: 35.32, lon: 6.63, z: 10, layer: "true" }] },
  { theme: "Air quality", ar: "جودة الهواء", pins: [
    { n: "Algiers / الجزائر", d: "S5P NO₂ basin", lat: 36.75, lon: 3.06, z: 9, layer: "true" },
    { n: "Arzew / أرزيو", d: "Industrial zone", lat: 35.85, lon: -0.32, z: 11, layer: "true" }] }
];
function renderHighlights() {
  const box = document.getElementById("hiList"); if (!box) return;
  box.innerHTML = HIGHLIGHTS.map((g, gi) => `
    <details class="hgroup" ${gi === 0 ? "open" : ""}><summary>★ ${esc(LANG === "ar" ? g.ar : g.theme)}</summary>
    ${g.pins.map(p => `<div class="hpin"><div><b>${esc(p.n)}</b><br><span class="mut">${esc(p.d)}</span></div>
      <button onclick="flyTo(${p.lat},${p.lon},${p.z},'${p.layer}')">✈ ${t("hiGo")}</button></div>`).join("")}
    </details>`).join("");
}
function flyTo(lat, lon, z, layer) {
  // GIBS tiles cap at native zoom 9 — use Esri for city-level pins
  if ((z || 10) > 9 && typeof currentBaseKey !== "undefined" && String(currentBaseKey).startsWith("gibs")) setBase("esri");
  MAP.flyTo([lat, lon], z || 10, { duration: 1.4 });
  if (layer) { setPreset(layer); const s = document.getElementById("visPreset"); if (s) s.value = layer; }
}

/* mobile bottom-sheet collapse */
function toggleSheet() {
  document.getElementById("leftPanel")?.classList.toggle("collapsed");
}

/* ---------- WMS / misc ---------- */
function openWms() { document.getElementById("wmsModal").classList.add("open"); }
function addWms() {
  const url = document.getElementById("wmsUrl").value.trim();
  const layers = document.getElementById("wmsLayers").value.trim();
  if (!url || !layers) return;
  L.tileLayer.wms(url, { layers, format: "image/png", transparent: true, attribution: "Custom WMS" }).addTo(MAP);
  closeModal("wmsModal");
}
async function locate() {
  if (!navigator.geolocation) return toast("GPS N/A");
  navigator.geolocation.getCurrentPosition(p => MAP.flyTo([p.coords.latitude, p.coords.longitude], 12, { duration: 1.2 }), () => toast("GPS N/A"));
}

/* location search */
let geoT = null;
function bindGeo() {
  const inp = document.getElementById("geoQ");
  const box = document.getElementById("geoRes");
  if (!inp) return;
  inp.addEventListener("input", () => {
    clearTimeout(geoT);
    geoT = setTimeout(async () => {
      const q = inp.value.trim(); if (q.length < 3) { box.innerHTML = ""; return; }
      try {
        const r = await geocode(q);
        box.innerHTML = r.map(g => `<button onclick="MAP.flyTo([${g.lat},${g.lon}],11,{duration:1.2});document.getElementById('geoRes').innerHTML=''">${esc(g.display_name.slice(0, 70))}</button>`).join("");
      } catch (e) { box.innerHTML = ""; }
    }, 450);
  });
}

/* ---------- Status / clock ---------- */
function refreshStatus() {
  const z = document.getElementById("stZoom"); if (z && MAP) z.textContent = MAP.getZoom();
  const c = document.getElementById("stCount"); if (c) c.textContent = lastResults.length;
  const a = document.getElementById("stApi"); if (a) a.textContent = API_MODE === "live" ? t("apiOk") : t("apiDemo");
}
function setStatus(s) { const a = document.getElementById("stApi"); if (a) a.textContent = s; }
function toast(msg) {
  const el = document.getElementById("toast"); if (!el) return;
  el.textContent = msg; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
}
function copyTxt(s) {
  navigator.clipboard?.writeText(s).then(() => toast(t("copied"))).catch(() => toast(s.slice(0, 60)));
}
function tickClock() {
  const el = document.getElementById("utcClock");
  if (el) el.textContent = new Date().toISOString().slice(11, 19) + " UTC";
}

/* ---------- Boot ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const d = defaultDates();
  document.getElementById("fFrom").value = "2024-01-01";
  document.getElementById("fTo").value = "2024-03-01";
  document.getElementById("tlFrom").value = d.from;
  document.getElementById("tlTo").value = d.to;
  initMap();
  setLang(LANG);
  bindGeo();
  setInterval(tickClock, 1000); tickClock();
  setPreset("true");
  setBase("esri");
  switchTab("search");
  refreshStatus();
  document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach(m => m.classList.remove("open")); });
  window.addEventListener("resize", () => { if (lastAnalysis) runAnalysis(); });
});
