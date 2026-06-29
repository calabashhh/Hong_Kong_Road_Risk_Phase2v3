// =======================================================
// YAS Road Risk Intelligence Map — Phase 2
// Data variables expected from JS data files:
//   var modeled_risk = {...}
//   var unmodeled_risk = {...}
// =======================================================

// ------------------------------
// 1. Map + basemap
// ------------------------------

const map = L.map("map", {
  center: [22.32, 114.17],
  zoom: 11,
  minZoom: 10,
  maxZoom: 19,
  preferCanvas: true
});

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>, &copy; CARTO'
  }
).addTo(map);

// Use one shared interactive pane/renderer for both road layers.
// Separate panes looked visually reasonable, but the upper modeled canvas could
// intercept mouse events before they reached the lower unmodeled canvas.
map.createPane("roadPane");
map.getPane("roadPane").style.zIndex = 420;
map.getPane("roadPane").style.pointerEvents = "auto";

// Shared renderer with generous hit tolerance so thin roads are easier to hover.
const roadRenderer = L.canvas({
  pane: "roadPane",
  padding: 0.6,
  tolerance: 14
});

if (typeof modeled_risk === "undefined") {
  console.error("modeled_risk is not loaded. Check the modeled risk JS data file.");
}

if (typeof unmodeled_risk === "undefined") {
  console.error("unmodeled_risk is not loaded. Check the unmodeled risk JS data file.");
}

console.log("Modeled features:", modeled_risk?.features?.length);
console.log("Unmodeled features:", unmodeled_risk?.features?.length);

let currentRiskMode = "combined";
let modeledLayer = null;
let unmodeledLayer = null;

const hoverCard = document.getElementById("hover-card");

// ------------------------------
// 2. Helpers
// ------------------------------

function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmt(value, decimals = 1) {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) return "N/A";
  return Number(value).toFixed(decimals);
}

function fmtInt(value) {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) return "N/A";
  return Math.round(Number(value)).toLocaleString();
}

function fmtPct(value, decimals = 1) {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) return "N/A";
  return `${(Number(value) * 100).toFixed(decimals)}%`;
}

function getBandFromPercentile(value) {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
    return "No model output";
  }
  const v = Number(value);
  if (v >= 0.95) return "Very High / Top 5%";
  if (v >= 0.90) return "High / Top 10%";
  if (v >= 0.80) return "Watchlist / Top 20%";
  if (v >= 0.50) return "Medium";
  return "Low";
}

function getModeLabel(mode = currentRiskMode) {
  switch (mode) {
    case "crash":
      return "Predicted Crash Risk";
    case "severity":
      return "Predicted Severity Risk";
    default:
      return "Combined Priority";
  }
}

function getModeMetricLabel(mode = currentRiskMode) {
  switch (mode) {
    case "crash":
      return "Crash percentile";
    case "severity":
      return "Severity percentile";
    default:
      return "Combined percentile";
  }
}

function getRiskBand(properties, mode = currentRiskMode) {
  if (!properties) return "No model output";

  if (mode === "crash") {
    return getBandFromPercentile(properties.risk_pred_crash_percentile);
  }

  if (mode === "severity") {
    return getBandFromPercentile(properties.risk_pred_sev_percentile);
  }

  return properties.risk_combined_priority_band || "No model output";
}

function getRiskMetric(properties, mode = currentRiskMode) {
  if (!properties) return null;

  if (mode === "crash") {
    return properties.risk_pred_crash_percentile;
  }

  if (mode === "severity") {
    return properties.risk_pred_sev_percentile;
  }

  return properties.risk_combined_priority_percentile;
}

function getBandColor(band) {
  switch (band) {
    case "Very High / Top 5%":
      return "#8f1d2c"; // deep burgundy
    case "High / Top 10%":
      return "#d95f0e"; // muted orange
    case "Watchlist / Top 20%":
      return "#f2b447"; // warm amber
    case "Medium":
      return "#5f9ea0"; // muted teal
    case "Low":
      return "#9ecae1"; // pale blue
    default:
      return "#f1f5f9"; // very light gray for unmodeled
  }
}

function getBandWeight(band) {
  switch (band) {
    case "Very High / Top 5%":
      return 3.15;
    case "High / Top 10%":
      return 2.65;
    case "Watchlist / Top 20%":
      return 2.25;
    case "Medium":
      return 1.85;
    case "Low":
      return 1.55;
    default:
      return 1.45;
  }
}

function getRiskStyle(feature) {
  const p = feature.properties || {};
  const band = getRiskBand(p, currentRiskMode);

  return {
    pane: "roadPane",
    renderer: roadRenderer,
    color: getBandColor(band),
    weight: getBandWeight(band),
    opacity: band === "Low" ? 0.62 : 0.92,
    lineCap: "round",
    lineJoin: "round"
  };
}

function getUnmodeledStyle() {
  return {
    pane: "roadPane",
    renderer: roadRenderer,
    color: "#b8bec8",
    weight: 1.15,
    opacity: 0.72,
    lineCap: "round",
    lineJoin: "round"
  };
}

// ------------------------------
// 3. Hover card logic
// ------------------------------

function moveHoverCard(e) {
  if (!hoverCard || !e || !e.originalEvent) return;

  const mapRect = map.getContainer().getBoundingClientRect();
  const cardRect = hoverCard.getBoundingClientRect();

  let x = e.originalEvent.clientX - mapRect.left + 14;
  let y = e.originalEvent.clientY - mapRect.top + 14;

  const rightLimit = mapRect.width - cardRect.width - 12;
  const bottomLimit = mapRect.height - cardRect.height - 12;

  if (x > rightLimit) x = e.originalEvent.clientX - mapRect.left - cardRect.width - 14;
  if (y > bottomLimit) y = e.originalEvent.clientY - mapRect.top - cardRect.height - 14;

  hoverCard.style.left = `${Math.max(8, x)}px`;
  hoverCard.style.top = `${Math.max(8, y)}px`;
}

function showHoverCard(html, e) {
  if (!hoverCard) return;
  hoverCard.innerHTML = html;
  hoverCard.style.display = "block";
  moveHoverCard(e);
}

function hideHoverCard() {
  if (!hoverCard) return;
  hoverCard.style.display = "none";
  hoverCard.innerHTML = "";
}

// ------------------------------
// 4. Hover / popup content
// ------------------------------

function buildModeSummary(p) {
  const modeLabel = getModeLabel();
  const band = getRiskBand(p);
  const metric = getRiskMetric(p);
  const color = getBandColor(band);

  return `
    <div class="hover-section-title">${esc(modeLabel)}</div>
    <span class="hover-badge" style="background:${color};">${esc(band)}</span><br>
    <b>${esc(getModeMetricLabel())}:</b> ${fmtPct(metric)}<br>
  `;
}

function buildModeledCard(p) {
  const streetEn = p.STREET_ENAME || "Unnamed road";
  const streetZh = p.STREET_CNAME || "";
  const activeBand = getRiskBand(p);
  const activeColor = getBandColor(activeBand);

  return `
    <div class="hover-card-inner" style="border-left-color:${activeColor};">
      <div class="hover-title">🚕 ${esc(streetEn)}</div>
      <div class="hover-subtitle">${esc(streetZh)}</div>

      <b>Segment ID:</b> ${esc(p.seg_ID)}<br>
      <b>Segment length:</b> ${fmt(p.seg_len_m, 1)} m<br>
      <b>Decision year:</b> ${esc(p.risk_year)}<br>
      <b>Prediction year:</b> ${esc(p.risk_target_year)}<br>

      <hr>

      ${buildModeSummary(p)}

      <div class="hover-section-title">Model signals</div>
      <b>Combined priority:</b> ${esc(p.risk_combined_priority_band)}<br>
      <b>Combined percentile:</b> ${fmtPct(p.risk_combined_priority_percentile)}<br>
      <b>Combined score:</b> ${fmt(p.risk_combined_priority_score, 3)}<br>
      <b>Crash risk:</b> ${esc(p.risk_predicted_crash_risk)} (${fmtPct(p.risk_pred_crash_percentile)})<br>
      <b>Severity risk:</b> ${esc(p.risk_predicted_severity_risk)} (${fmtPct(p.risk_pred_sev_percentile)})<br>

      <hr>

      <div class="hover-section-title">Context signals</div>
      <b>Schools within 250m:</b> ${fmtInt(p.schools_within_250m)}<br>
      <b>Signals within 50m:</b> ${fmtInt(p.signal_ct_50m)}<br>
      <b>Crossing length within 50m:</b> ${fmt(p.crossing_len_50m, 1)} m<br>
      <b>Bus stops within 50m:</b> ${fmtInt(p.busstop_ct_50m)}<br>
      <b>Curvature index:</b> ${fmt(p.curv_index_log, 3)}<br>
      <b>Median slope:</b> ${fmt(p.slp_median, 1)}°<br>

      <hr>
      <span class="hover-muted">
        Scores are relative model-ranking indicators, not exact crash probabilities.
      </span>
    </div>
  `;
}

function buildUnmodeledCard(p) {
  const streetEn = p.STREET_ENAME || "Unnamed road";
  const streetZh = p.STREET_CNAME || "";

  return `
    <div class="hover-card-inner unmodeled">
      <div class="hover-title">Context-only road segment</div>
      <div class="hover-subtitle">${esc(streetEn)} ${streetZh ? " / " + esc(streetZh) : ""}</div>

      <b>Segment ID:</b> ${esc(p.seg_ID || "N/A")}<br>
      <b>Model status:</b> No Phase 2 model output<br>

      <hr>

      <span class="hover-muted">
        This segment is included in the full road-network context layer but was not part of the
        2024 → 2025 modeled prediction output. It should not be interpreted as zero risk.
      </span>
    </div>
  `;
}

// ------------------------------
// 5. Layer creation
// ------------------------------

function onEachModeledFeature(feature, layer) {
  const p = feature.properties || {};

  layer.on({
    mouseover: function (e) {
      layer.setStyle({
        weight: Math.max(getBandWeight(getRiskBand(p)) + 1.2, 2.8),
        opacity: 1
      });
      if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
      }
      showHoverCard(buildModeledCard(p), e);
    },
    mousemove: function (e) {
      moveHoverCard(e);
    },
    mouseout: function () {
      modeledLayer.resetStyle(layer);
      hideHoverCard();
    },
    click: function () {
      layer.bindPopup(buildModeledCard(p), {
        closeButton: true,
        autoPan: true,
        maxWidth: 330
      }).openPopup();
    }
  });
}

function onEachUnmodeledFeature(feature, layer) {
  const p = feature.properties || {};

  layer.on({
    mouseover: function (e) {
      layer.setStyle({
        color: "#ffffff",
        weight: 2.6,
        opacity: 1
      });
      showHoverCard(buildUnmodeledCard(p), e);
    },
    mousemove: function (e) {
      moveHoverCard(e);
    },
    mouseout: function () {
      unmodeledLayer.resetStyle(layer);
      hideHoverCard();
    },
    click: function () {
      layer.bindPopup(buildUnmodeledCard(p), {
        closeButton: true,
        autoPan: true,
        maxWidth: 330
      }).openPopup();
    }
  });
}

unmodeledLayer = L.geoJSON(unmodeled_risk, {
  pane: "roadPane",
  renderer: roadRenderer,
  style: getUnmodeledStyle,
  onEachFeature: onEachUnmodeledFeature,
  interactive: true
}).addTo(map);

modeledLayer = L.geoJSON(modeled_risk, {
  pane: "roadPane",
  renderer: roadRenderer,
  style: getRiskStyle,
  onEachFeature: onEachModeledFeature,
  interactive: true
}).addTo(map);

// Fit map to data extent once layers are loaded.
try {
  const bounds = modeledLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
} catch (err) {
  console.warn("Could not fit map bounds:", err);
}

// ------------------------------
// 6. Controls
// ------------------------------

const titleControl = L.control({ position: "topleft" });

titleControl.onAdd = function () {
  const div = L.DomUtil.create("div", "map-title-control");
  div.innerHTML = `
    <div class="map-title-main">YAS Road Risk Intelligence Map</div>
    <div class="map-title-sub">
      Phase 2 segment-level priority map using 2024 data to rank 2025 road-segment risk.
    </div>
    <div class="map-title-note">
      Colored lines = modeled segments. Gray lines = road-context segments without Phase 2 model output.
    </div>
  `;
  L.DomEvent.disableClickPropagation(div);
  return div;
};

titleControl.addTo(map);

const viewControl = L.control({ position: "topright" });

viewControl.onAdd = function () {
  const div = L.DomUtil.create("div", "view-control");

  div.innerHTML = `
    <div class="view-control-title">Risk view</div>
    <button id="btn-combined" class="active" data-mode="combined">Combined Priority</button>
    <button id="btn-crash" data-mode="crash">Predicted Crash Risk</button>
    <button id="btn-severity" data-mode="severity">Predicted Severity Risk</button>
  `;

  L.DomEvent.disableClickPropagation(div);

  setTimeout(() => {
    div.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", function () {
        setRiskMode(this.dataset.mode);
      });
    });
  }, 0);

  return div;
};

viewControl.addTo(map);

const legendControl = L.control({ position: "bottomleft" });

legendControl.onAdd = function () {
  this._div = L.DomUtil.create("div", "legend");
  this.update();
  return this._div;
};

legendControl.update = function () {
  const title = getModeLabel();
  const metric = getModeMetricLabel();

  const rows = [
    ["Very High / Top 5%", getBandColor("Very High / Top 5%"), 4],
    ["High / Top 10%", getBandColor("High / Top 10%"), 3],
    ["Watchlist / Top 20%", getBandColor("Watchlist / Top 20%"), 3],
    ["Medium", getBandColor("Medium"), 2],
    ["Low", getBandColor("Low"), 2],
    ["No model output", getBandColor("No model output"), 2]
  ];

  this._div.innerHTML = `
    <div class="legend-title">${esc(title)}</div>
    <div class="legend-subtitle">${esc(metric)} / relative segment ranking</div>
    ${rows.map(([label, color, width]) => `
      <div class="legend-row">
        <span class="legend-swatch-line" style="border-top-color:${color}; border-top-width:${width}px;"></span>
        <span class="legend-label">${esc(label)}</span>
      </div>
    `).join("")}
  `;
};

legendControl.addTo(map);

const priorityControl = L.control({ position: "bottomright" });

priorityControl.onAdd = function () {
  this._div = L.DomUtil.create("div", "priority-list");
  this.update();
  L.DomEvent.disableClickPropagation(this._div);
  return this._div;
};

priorityControl.update = function () {
  const topFeatures = getTopFeatures(currentRiskMode, 10);

  this._div.innerHTML = `
    <div class="priority-list-title">Top 10 — ${esc(getModeLabel())}</div>
    <div class="priority-list-subtitle">Click a segment to zoom. Ranked within the 2024 → 2025 modeled layer.</div>
    ${topFeatures.map((item, index) => {
      const p = item.feature.properties || {};
      const name = p.STREET_ENAME || "Unnamed road";
      const metric = getRiskMetric(p, currentRiskMode);
      return `
        <div class="priority-item" data-segid="${esc(p.seg_ID)}">
          <div class="priority-rank">${index + 1}</div>
          <div>
            <div class="priority-name">${esc(name)}</div>
            <div class="priority-meta">Seg ${esc(p.seg_ID)} · ${esc(getRiskBand(p, currentRiskMode))}</div>
          </div>
          <div class="priority-score">${fmtPct(metric, 0)}</div>
        </div>
      `;
    }).join("")}
  `;

  setTimeout(() => {
    this._div.querySelectorAll(".priority-item").forEach((item) => {
      item.addEventListener("click", function () {
        zoomToSegment(this.dataset.segid);
      });
    });
  }, 0);
};

priorityControl.addTo(map);

// ------------------------------
// 7. View switching + top list
// ------------------------------

function setRiskMode(mode) {
  currentRiskMode = mode;

  document.querySelectorAll(".view-control button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  modeledLayer.setStyle(getRiskStyle);
  legendControl.update();
  priorityControl.update();
  hideHoverCard();

  // Keep the modeled layer visually above the gray context layer.
  modeledLayer.bringToFront();
}

function getTopFeatures(mode, n = 10) {
  const features = (modeled_risk && modeled_risk.features) ? modeled_risk.features : [];

  return features
    .map((feature) => ({
      feature,
      value: Number(getRiskMetric(feature.properties || {}, mode))
    }))
    .filter((item) => !isNaN(item.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function zoomToSegment(segId) {
  let targetLayer = null;

  modeledLayer.eachLayer((layer) => {
    const p = layer.feature && layer.feature.properties ? layer.feature.properties : {};
    if (String(p.seg_ID) === String(segId)) {
      targetLayer = layer;
    }
  });

  if (!targetLayer) return;

  const bounds = targetLayer.getBounds ? targetLayer.getBounds() : null;
  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds.pad(1.5), { maxZoom: 17 });
  }

  const p = targetLayer.feature.properties || {};
  targetLayer.bindPopup(buildModeledCard(p), {
    closeButton: true,
    autoPan: true,
    maxWidth: 330
  }).openPopup();

  targetLayer.setStyle({
    weight: Math.max(getBandWeight(getRiskBand(p)) + 1.4, 3),
    opacity: 1
  });

  setTimeout(() => {
    modeledLayer.resetStyle(targetLayer);
  }, 1600);
}
