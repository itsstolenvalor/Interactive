"use strict";

// Deadweight browser preview. The existing PNGs supply the native artwork;
// graphs and changing control states are drawn over it. No audio is processed.
const $ = (id) => document.getElementById(id);
const canvas = $("panel");
const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
const instrument = $("instrument");
const controls = $("controls");
const nativePresets = $("presets");
const W = 1141, H = 446;
context.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
const colorDefault = "#54d2c8";
const notes = "1/64T 1/64 1/32T 3/128 1/32 1/16T 3/64 1/16 1/8T 3/32 1/8 1/4T 3/16 1/4 1/2T 3/8 1/2 1/1T 3/4 1/1 3/2".split(" ");
const beats = [1/24, 1/16, 1/12, 3/32, 1/8, 1/6, 3/16, 1/4, 1/3, 3/8, 1/2, 2/3, 3/4, 1, 4/3, 1.5, 2, 8/3, 3, 4, 6];
const defaults = {
  holdFree: 0, holdDivision: 1, holdSynced: false,
  releaseFree: 125, releaseDivision: 7, releaseSynced: true,
  audio: false, listening: false, bars: 4,
  threshold: -36, reduction: -6, lookahead: 0,
  points: [], initialBend: 0,
};
const timing = {
  hold: { x: 135, max: 250, last: 10, original: 40 },
  release: { x: 346, max: 1000, last: 20, original: 160 },
};
const ranges = { lookahead: [0, 10, .1, .09], threshold: [-72, 0, .5, .57], reduction: [-60, 0, .5, .46] };
const dialLabels = { hold: "Hold", release: "Release", lookahead: "Lookahead", threshold: "Threshold", reduction: "Reduction" };
const bounds = {
  shape: [47, 112, 388, 122],
  presets: [137, 80, 215, 22], previous: [352, 80, 18, 10], next: [352, 90, 18, 11],
  open: [378, 80, 27, 22], save: [406, 80, 27, 22],
  "dial-hold": [92, 299, 86, 85], "value-hold": [104, 386, 62, 16], "hold-sync": [178, 282, 27, 29],
  "dial-release": [303, 299, 86, 85], "value-release": [315, 386, 62, 16], "release-sync": [389, 282, 27, 29],
  midi: [571, 81, 52, 23], audio: [623, 81, 52, 23], listen: [687, 79, 26, 27],
  "dial-lookahead": [828, 80, 78, 24], "dial-threshold": [1018, 80, 78, 24], "dial-reduction": [1018, 232, 78, 24],
  "bar-1": [667, 381, 52, 22], "bar-2": [737, 381, 52, 22], "bar-3": [807, 381, 52, 22], "bar-4": [877, 381, 52, 22],
  theme: [402, 365, 36, 35],
  triggerArtwork: [570, 80, 106, 25],
};
const tips = {
  hold: "Delays recovery after the trigger ends.", release: "Sets the duration of the recovery shape.",
  lookahead: "Moves ducking earlier relative to sidechain audio.", threshold: "Sets the level at which sidechain audio triggers ducking.",
  reduction: "Sets the amount of gain reduction.",
};
const themeFiles = { light: "assets/light.png", dark: "assets/dark.png" };
const sprites = {}, buttons = {}, dials = {}, readouts = {};
let state = { ...defaults, points: [] };
let dark = false, accent = colorDefault, presetIndex = 0, edited = false;
let popupAnchor, renderPending = false, themeRequest = 0;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const round = (value, places = 0) => Number(value.toFixed(places));
const isTiming = (id) => Object.hasOwn(timing, id);
const synced = (id) => state[id + "Synced"];
const keyOf = (id) => isTiming(id) ? id + (synced(id) ? "Division" : "Free") : id;
const ms = (id) => synced(id) ? beats[state[id + "Division"]] * 500 : state[id + "Free"];
const rangeOf = (id) => isTiming(id) ? (synced(id) ? [0, timing[id].last, 1, .13] : [0, timing[id].max, .1, timing[id].max / 155]) : ranges[id];
function format(id, value = state[keyOf(id)]) {
  if (isTiming(id)) return synced(id) ? notes[value] : value.toFixed(1) + " ms";
  if (id === "reduction" && value === -60) return "−inf dB";
  return value.toFixed(1) + (id === "lookahead" ? " ms" : " dB");
}

// Add the same style of custom popup as StepDelay without requiring HTML/CSS edits.
const popup = document.createElement("div");
popup.id = "dw-popup";
popup.hidden = true;
popup.setAttribute("role", "group");
popup.setAttribute("aria-label", "Control options");
document.body.append(popup);
const status = document.createElement("p");
status.id = "dw-status";
status.hidden = true;
status.setAttribute("role", "status");
document.body.append(status);
nativePresets.hidden = true;
nativePresets.disabled = true;
const style = document.createElement("style");
style.textContent = `
  /* Match the existing StepDelay popup and control styling. */
  #dw-popup {
    position: fixed;
    z-index: 900;
    box-sizing: border-box;
    min-width: 132px;
    max-width: calc(100% - 16px);
    max-height: min(360px, calc(100dvh - 16px));
    overflow-y: auto;
    padding: 4px;
    border: 1px solid #626466;
    border-radius: 7px;
    background: #202123;
    color: #f2f3f3;
    font: 100%/1.4 "Segoe UI", Arial, sans-serif;
    box-shadow: 0 8px 22px #0008;
  }
  #dw-popup[hidden], #dw-status[hidden] { display: none !important; }
  #dw-popup button, #dw-popup input {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 34px;
    padding: 5px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  #dw-popup button { cursor: pointer; }
  #dw-popup input { background: #151617; border: 1px solid #555; }
  #dw-popup button:hover, #dw-popup button:focus-visible { background: #393c3f; }
  #dw-popup button[aria-pressed="true"] { color: #a7eee8; }
  #dw-popup form { min-width: 148px; padding: 4px; }
  #dw-popup form label { display: block; margin-bottom: 6px; }
  #dw-popup :focus-visible { outline: 2px solid #54d2c8; outline-offset: 2px; }
  #dw-status { position: fixed; bottom: 4px; left: 8px; right: 8px; margin: 0; color: #f2f3f3; background: #202123; padding: 5px; font: .875rem/1.4 "Segoe UI", Arial, sans-serif; }
  .hotspot { border-radius: 5px; touch-action: manipulation; }
  .hotspot[role="slider"], .hotspot.shape { touch-action: none; }
  .hotspot.round { border-radius: 50%; }
  .hotspot:disabled { pointer-events: none; }
  .hotspot:not(:disabled):hover { background: rgb(255 255 255 / .06); }
  .hotspot:active { background: rgb(0 0 0 / .12); }
`;
document.head.append(style);

function fill(x, y, w, h, color) {
  context.fillStyle = color;
  context.fillRect(x, y, w, h);
}

function label(value, x, y, color = "#f4f4f4", size = 12) {
  context.fillStyle = color;
  context.font = size + "px 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(value, x, y);
}

function trace(path, color, width = 1, close = false) {
  context.beginPath();
  path.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
  if (close) {
    context.closePath();
    context.fillStyle = color;
    context.fill();
  } else {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
  }
}

function grid(x, y, w, h, cols, rows, color) {
  for (let i = 0; i <= cols; i++)
    trace([[x + w * i / cols, y], [x + w * i / cols, y + h]], color);
  for (let i = 0; i <= rows; i++)
    trace([[x, y + h * i / rows], [x + w, y + h * i / rows]], color);
}

let curveNodes = null;
function curve(t) {
  t = clamp(t, 0, 1);
  const nodes = curveNodes || [[0, 0, state.initialBend], ...state.points, [1, 1, 0]];
  let right = 1;
  while (right < nodes.length - 1 && nodes[right][0] < t) right++;
  const [x, y, bend] = nodes[right - 1];
  const [nextX, nextY] = nodes[right];
  const u = (t - x) / (nextX - x);
  const v = u + bend * u * (1 - u);
  return y + (nextY - y) * v * v * (3 - 2 * v);
}

function holdFraction() {
  return ms("hold") / (ms("hold") + ms("release") || 1);
}

function drawShape() {
  const [x, y, w, h] = bounds.shape;
  const bg = context.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, dark ? "#2a2b2c" : "#f0eded");
  bg.addColorStop(1, dark ? "#1c1d1e" : "#eeebeb");
  fill(x - 4, y - 4, w + 8, h + 8, bg);
  grid(x, y, w, h, 8, 4, dark ? "#ffffff14" : "#00000012");
  const hold = holdFraction(), start = x + w * hold, span = w * (1 - hold);
  const path = [[x, y + h], ...Array.from({ length: 129 }, (_, i) => [start + span * i / 128, y + h * (1 - curve(i / 128))]), [x + w, y]];
  trace([...path, [x + w, y + h]], "#54d2c823", 1, true);
  trace(path, colorDefault, 1.5);
  for (const [px, py] of [[0, 0], ...state.points, [1, 1]]) {
    context.beginPath();
    context.arc(start + span * px, y + h * (1 - py), 3.4, 0, Math.PI * 2);
    context.fillStyle = dark ? "#262728" : "#f2efef";
    context.fill();
    context.strokeStyle = colorDefault;
    context.stroke();
  }
}
// Fixed visual test pattern. The page never opens an audio device.
const hits = [[.07, .075, .88], [.23, .042, .72], [.34, .10, .94], [.53, .053, .78], [.65, .085, .84], [.83, .043, .70], [.91, .065, .92]];
function drawHistory() {
  const x = 501, w = 593, top = 106, lower = 258, h = 122;
  const shade = context.createLinearGradient(0, top, 0, lower + h);
  shade.addColorStop(0, "#2e2f30");
  shade.addColorStop(1, "#1a1b1c");
  fill(x - 18, top, w + 19, h + 2, shade);
  fill(x - 18, lower - 2, w + 19, h + 4, shade);
  grid(x, top, w, h, state.bars * 2, 0, "#ffffff14");
  grid(x, lower, w, h, state.bars * 2, 5, "#ffffff14");
  const depth = state.reduction === -60 ? -96 : state.reduction;
  const scale = [4, 8, 12, 24, 48, 96].find(limit => -depth <= limit - Math.min(3, limit * .2)) ?? 96;
  const guide = lower + h * Math.min(.98, -depth * .85 / scale);
  for (let i = 0; i <= 5; i++)
    label(i === 5 ? "-inf" : String(-Math.round(i * scale / 5)), 493, lower + i * h / 5, "#eee", 9);
  context.setLineDash([3, 3]);
  trace([[x, guide], [x + w, guide]], "#ffffff70");
  const thresholdY = top + h * (-state.threshold / 72);
  if (state.audio)
    trace([[x, thresholdY], [x + w, thresholdY]], "#ffffff70");
  context.setLineDash([]);
  const history = [], gain = [];
  const duration = state.bars * 2000;
  const holdMs = ms("hold"), releaseMs = Math.max(1, ms("release"));
  for (let i = 0; i <= 593; i++) {
    const pos = i / 593 * state.bars / 4;
    let age = Infinity, peak = 0, end = 0;
    for (const [start, len, level] of hits) {
      if (pos >= start) {
        age = (pos - start) * 8000;
        end = len * 8000 * (state.audio ? clamp((state.threshold + 72) / 72, .12, .95) : 1);
        peak = level * Math.exp(-age / (len * 2900)) * (.78 + .15 * Math.sin(i * 1.9) + .06 * Math.sin(i * .37));
      }
    }
    const recovery = clamp((age - end - holdMs + (state.audio ? state.lookahead : 0)) / releaseMs, 0, 1);
    const measured = Number.isFinite(age) && age < duration ? curve(recovery) : 1;
    gain.push([x + i, lower + (guide - lower) * (1 - measured)]);
    history.push([x + i, top + h * (1 - clamp((72 + 20 * Math.log10(Math.max(.00025, peak))) / 72, 0, 1))]);
  }
  if (state.audio) {
    trace([[x, top + h], ...history, [x + w, top + h]], state.listening ? "#54d2c8" : "#96999a", 1, true);
    context.save();
    context.beginPath();
    context.rect(x, top, w, thresholdY - top);
    context.clip();
    trace([[x, top + h], ...history, [x + w, top + h]], colorDefault, 1, true);
    context.restore();
  } else {
    for (const [start, len] of hits) {
      const left = start * 4 / state.bars, end = Math.min(1, (start + len) * 4 / state.bars);
      if (left >= 1)
        continue;
      for (const offset of [0, 18, 35].slice(0, 1 + Math.round(start * 8) % 3)) {
        fill(x + left * w, top + 88 - offset, (end - left) * w, 4, colorDefault);
      }
    }
  }
  trace(gain, colorDefault, 1.5);
}

// Copy a rectangle from the native theme at logical panel coordinates.
function patch(image, source, destination = source) {
  const [x, y, w, h] = source;
  const sx = image.naturalWidth / W, sy = image.naturalHeight / H;
  context.drawImage(image, x * sx, y * sy, w * sx, h * sy, ...destination);
}

// Stretch a clean vertical strip through a readout without painting over its bezel.
function paintValue(image, rect, cleanX, value, color, size = 12) {
  const [x, y, w, h] = rect;
  patch(image, [cleanX, y, 1, h], rect);
  label(value, x + w / 2, y + h / 2, color, size);
}

function drawTrigger(image) {
  // Both supplied PNGs already show Audio selected. Preserve the complete native
  // control in Audio mode. For MIDI, mirror the whole native bezel, then replace
  // only the two labels. The outer outline, shared seam and corner radii stay intact.
  if (state.audio) return;
  const [x, y, w, h] = bounds.triggerArtwork;
  context.save();
  context.translate(2 * x + w, 0);
  context.scale(-1, 1);
  patch(image, bounds.triggerArtwork);
  context.restore();
  paintValue(image, [576, 85, 44, 15], 628, "MIDI", "#131415");
  paintValue(image, [627, 85, 43, 15], 615, "AUDIO", "#f7f7f7");
}

// Recolor the original antialiased note, not a replacement font glyph.
// The native PNG supplies the exact shape and the surrounding panel gradient.
const syncCache = new Map();
function drawSyncIcon(id) {
  if (!synced(id)) return;
  const [x, y, w, h] = id === "hold" ? [181, 287, 22, 21] : [391, 287, 22, 21];
  const sx = canvas.width / W, sy = canvas.height / H;
  const left = Math.round(x * sx), top = Math.round(y * sy);
  const width = Math.round((x + w) * sx) - left;
  const height = Math.round((y + h) * sy) - top;
  const cacheKey = (dark ? "dark" : "light") + ":" + id;
  if (syncCache.has(cacheKey)) {
    const cached = syncCache.get(cacheKey);
    if (cached) context.putImageData(cached, left, top);
    return;
  }
  let region;
  try {
    region = context.getImageData(left, top, width, height);
  } catch (error) {
    // Keep the native artwork unchanged if local-file canvas readback is blocked.
    if (error.name !== "SecurityError") throw error;
    return;
  }
  const pixels = region.data;
  const luminance = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
  const contrast = new Float32Array(width * height);
  const backgrounds = new Float32Array(width * height * 3);
  let peak = 0;
  for (let row = 0; row < height; row++) {
    const first = row * width * 4, last = first + (width - 1) * 4;
    for (let col = 0; col < width; col++) {
      const index = row * width + col, offset = index * 4;
      const fraction = col / Math.max(1, width - 1);
      const bg = backgrounds.subarray(index * 3, index * 3 + 3);
      for (let c = 0; c < 3; c++)
        bg[c] = pixels[first + c] + (pixels[last + c] - pixels[first + c]) * fraction;
      const delta = luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]) - luminance(...bg);
      // Light artwork has a dark note; dark artwork has a light note.
      contrast[index] = Math.max(0, dark ? delta : -delta);
      peak = Math.max(peak, contrast[index]);
    }
  }
  if (peak < 20) { syncCache.set(cacheKey, null); return; }
  const target = [84, 210, 200]; // Default accent; customAccent() handles user colors.
  for (let index = 0; index < contrast.length; index++) {
    if (contrast[index] <= 2) continue;
    const coverage = clamp(contrast[index] / peak, 0, 1);
    for (let c = 0; c < 3; c++) {
      const bg = backgrounds[index * 3 + c];
      pixels[index * 4 + c] = bg + (target[c] - bg) * coverage;
    }
  }
  syncCache.set(cacheKey, region);
  context.putImageData(region, left, top);
}

function drawTiming(image, id) {
  const knob = timing[id];
  const x = knob.x, y = 343;
  const scale = (value) => Math.log1p(value / 10) / Math.log1p(knob.max / 10);
  const angle = synced(id) ? state[id + "Division"] / knob.last : scale(state[id + "Free"]);
  context.save();
  context.translate(x, y);
  context.rotate((angle - scale(knob.original)) * Math.PI * 1.52);
  context.beginPath();
  context.arc(0, 0, 35, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, -x, -y, W, H);
  context.restore();
  const text = dark ? "#f4f4f4" : "#161719";
  paintValue(image, bounds["value-" + id], x - 39, format(id), text);
  drawSyncIcon(id);
}

function render() {
  renderPending = false;
  const image = sprites[dark ? "dark" : "light"]?.loaded;
  if (!image) return;
  context.drawImage(image, 0, 0, W, H);
  curveNodes = [[0, 0, state.initialBend], ...state.points, [1, 1, 0]];
  drawShape();
  drawHistory();
  curveNodes = null;
  for (const id of Object.keys(timing)) drawTiming(image, id);
  paintValue(image, [144, 83, 205, 15], 145, factory[presetIndex].name + (edited ? " *" : ""), colorDefault);
  drawTrigger(image);
  if (state.listening) {
    // Highlight the native headphone control, without replacing its icon.
    context.strokeStyle = colorDefault;
    context.lineWidth = 1.4;
    context.beginPath();
    context.roundRect(689.5, 82.5, 20, 19, 5);
    context.stroke();
  }
  for (const [id, x, y] of [["lookahead", 866, 92], ["threshold", 1057, 92], ["reduction", 1057, 243]]) {
    paintValue(image, [x - 32, y - 7, 64, 14], x - 33, format(id), state.audio || id === "reduction" ? "#f7f7f7" : "#a4a6a6");
  }
  for (let i = 1; i <= 4; i++) {
    const x = 692 + (i - 1) * 70;
    paintValue(image, [x - 29, 383, 58, 16], x - 32, i === 1 ? "1 BAR" : i + " BARS", state.bars === i ? colorDefault : "#f7f7f7", 10);
  }
  customAccent();
  canvas.hidden = false;
  document.querySelector(".poster").hidden = true;
}

function refresh() {
  for (const id of Object.keys(dials)) {
    const dial = dials[id];
    const [min, max] = rangeOf(id);
    const active = state.audio || !["lookahead", "threshold"].includes(id);
    dial.disabled = !active;
    dial.setAttribute("aria-valuemin", min);
    dial.setAttribute("aria-valuemax", max);
    dial.setAttribute("aria-valuenow", state[keyOf(id)]);
    dial.setAttribute("aria-valuetext", format(id));
    if (isTiming(id)) {
      buttons[id + "-sync"].setAttribute("aria-pressed", String(synced(id)));
      readouts[id].hidden = synced(id);
      readouts[id].setAttribute("aria-label", "Edit " + dialLabels[id] + " value, " + format(id));
    }
  }
  buttons.midi.setAttribute("aria-pressed", String(!state.audio));
  buttons.audio.setAttribute("aria-pressed", String(state.audio));
  buttons.listen.setAttribute("aria-pressed", String(state.listening));
  for (let i = 1; i <= 4; i++) buttons["bar-" + i].setAttribute("aria-pressed", String(state.bars === i));
  buttons["preset-browser"].setAttribute("aria-label", "Browse presets, " + factory[presetIndex].name + (edited ? ", modified" : ""));
  if (!renderPending) {
    renderPending = true;
    requestAnimationFrame(render);
  }
}

function commit(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  refresh();
}

function announce(message) {
  status.textContent = message;
  status.hidden = !message;
}

function hotspot(id, label, tip, rect) {
  const target = document.createElement("button");
  target.type = "button";
  target.id = id;
  target.className = "hotspot";
  target.setAttribute("aria-label", label);
  target.title = tip || label;
  position(target, rect);
  controls.append(target);
  return target;
}

function position(element, rect) {
  const [x, y, w, h] = rect;
  Object.assign(element.style, {
    left: (x / W * 100) + "%", top: (y / H * 100) + "%",
    width: (w / W * 100) + "%", height: (h / H * 100) + "%",
  });
}

function button(id, label, tip, action, rect = bounds[id]) {
  const target = hotspot(id, label, tip, rect);
  if (action) target.addEventListener("click", action);
  buttons[id] = target;
  return target;
}

function customAccent() {
  if (accent === colorDefault) return;
  let frame;
  try { frame = context.getImageData(0, 0, canvas.width, canvas.height); }
  catch (error) {
    if (error.name !== "SecurityError") throw error;
    accent = colorDefault;
    announce("Custom accent colors require an HTTP preview.");
    return;
  }
  const target = accent.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
  const source = [84, 210, 200];
  const pixels = frame.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const chroma = Math.min(g, b) - r;
    if (chroma < 4 || Math.abs(g - b) > Math.max(20, chroma * .42)) continue;
    const amount = chroma / 116;
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] += amount * (target[channel] - source[channel]);
    }
  }
  context.putImageData(frame, 0, 0);
}

function closePopup(restore = false) {
  popup.hidden = true;
  popupAnchor?.setAttribute("aria-expanded", "false");
  if (restore) popupAnchor?.focus({ preventScroll: true });
  popupAnchor = undefined;
}

function openPopup(anchor, children, focus) {
  if (popupAnchor === anchor) { closePopup(true); return; }
  closePopup();
  popup.replaceChildren(...children);
  popupAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  popup.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const x = clamp(rect.left, 8, Math.max(8, innerWidth - popup.offsetWidth - 8));
  const above = rect.bottom + popup.offsetHeight + 8 > innerHeight && rect.top > innerHeight - rect.bottom;
  const y = above ? rect.top - popup.offsetHeight - 4 : rect.bottom + 4;
  popup.style.left = x + "px";
  popup.style.top = clamp(y, 8, Math.max(8, innerHeight - popup.offsetHeight - 8)) + "px";
  (focus ?? popup.querySelector("button, input"))?.focus({ preventScroll: true });
}

function choice(label, select, checked) {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = label;
  if (checked !== undefined) item.setAttribute("aria-pressed", checked);
  item.addEventListener("click", () => { closePopup(true); select(); });
  return item;
}

function field(label, value, submit) {
  const form = document.createElement("form");
  const caption = document.createElement("label");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = value;
  caption.append(input);
  const apply = document.createElement("button");
  apply.textContent = "Apply";
  form.append(caption, apply);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    input.setCustomValidity("");
    if (submit(input.value.trim())) closePopup(true);
    else {
      input.setCustomValidity("Enter a valid value.");
      input.reportValidity();
    }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  return { form, input };
}

function editValue(id, anchor) {
  const { form, input } = field(dialLabels[id], format(id), (text) => {
    const number = text.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s)?$/i);
    if (!number) return false;
    const value = Number(number[1]) * (number[2]?.toLowerCase() === "s" ? 1000 : 1);
    commit(keyOf(id), round(clamp(value, 0, timing[id].max), 1));
    return true;
  });
  openPopup(anchor, [form], input);
  input.select();
}

function bindDial(id) {
  const target = hotspot("dial-" + id, dialLabels[id], tips[id], bounds["dial-" + id]);
  target.setAttribute("role", "slider");
  if (isTiming(id)) target.classList.add("round");
  target.setAttribute("aria-orientation", "vertical");
  let drag;
  const setValue = (value) => {
    const [min, max, step] = rangeOf(id);
    commit(keyOf(id), round(clamp(Math.round(value / step) * step, min, max), 1));
  };
  target.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || target.disabled) return;
    drag = { id: event.pointerId, y: event.clientY, start: state[keyOf(id)], scale: Math.max(.01, instrument.clientWidth / W) };
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId || target.disabled) return;
    setValue(drag.start + (drag.y - event.clientY) * rangeOf(id)[3] / drag.scale / (event.shiftKey ? 5 : 1));
  });
  for (const stop of ["pointerup", "pointercancel", "lostpointercapture"]) target.addEventListener(stop, () => { drag = undefined; });
  target.addEventListener("dblclick", () => setValue(defaults[keyOf(id)]));
  target.addEventListener("keydown", (event) => {
    const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[event.key];
    if (delta === undefined && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const [min, max, step] = rangeOf(id);
    setValue(event.key === "Home" ? min : event.key === "End" ? max : state[keyOf(id)] + delta * step);
  });
  target.addEventListener("wheel", (event) => {
    if (document.activeElement !== target || target.disabled) return;
    event.preventDefault();
    setValue(state[keyOf(id)] + Math.sign(-event.deltaY) * rangeOf(id)[2]);
  }, { passive: false });
  dials[id] = target;
  if (isTiming(id)) {
    readouts[id] = button("value-" + id, "Edit " + dialLabels[id], "Enter a value in milliseconds.", (event) => editValue(id, event.currentTarget));
    readouts[id].setAttribute("aria-haspopup", "true");
    button(id + "-sync", dialLabels[id] + " Sync", "Syncs " + dialLabels[id] + " to the host tempo.", () => commit(id + "Synced", !synced(id)));
  }
}
for (const id of Object.keys(dialLabels)) bindDial(id);

function setMode(audio) {
  state.audio = audio;
  state.listening = false;
  refresh();
}
button("midi", "MIDI", "Triggers ducking from MIDI notes.", () => setMode(false));
button("audio", "Audio", "Triggers ducking from the external sidechain.", () => setMode(true));
button("listen", "Listen", "Auditions held MIDI notes or detected sidechain audio in the plug-in. The browser preview is visual only.", () => commit("listening", !state.listening));
for (let i = 1; i <= 4; i++) {
  button("bar-" + i, i + (i === 1 ? " bar" : " bars"), "Sets the display to " + i + (i === 1 ? " bar." : " bars."), () => commit("bars", i));
}

function loadPreset(index) {
  shapeDrag = undefined;
  presetIndex = (index + factory.length) % factory.length;
  state.points = factory[presetIndex].points.map((point) => point.slice());
  state.initialBend = factory[presetIndex].bend;
  edited = false;
  announce("");
  refresh();
}
button("preset-browser", "Browse presets", "Loads or reloads a factory shape.", (event) => {
  openPopup(event.currentTarget, factory.map((preset, i) => choice(preset.name, () => loadPreset(i), i === presetIndex)));
}, bounds.presets).setAttribute("aria-haspopup", "true");
button("previous", "Previous preset", "Loads the previous preset.", () => loadPreset(presetIndex - 1));
button("next", "Next preset", "Loads the next preset.", () => loadPreset(presetIndex + 1));
button("open", "Load local preset (unavailable in demo)", "Loading local files is unavailable in the demo.", null).disabled = true;
button("save", "Save preset (unavailable in demo)", "Saving files is unavailable in the demo.", null).disabled = true;

const shape = hotspot("recovery-shape", "Recovery shape", "Defines how the signal recovers after Hold. Double-click to add a point; right-click to remove a point or reset curvature.", bounds.shape);
shape.classList.add("shape");
function shapePosition(event) {
  const rect = shape.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
  return [x, y, clamp((x - holdFraction()) / Math.max(.0001, 1 - holdFraction()), 0, 1)];
}

function nearestPoint(x, y) {
  const hold = holdFraction();
  return state.points.findIndex(([px, py]) => Math.hypot((hold + (1 - hold) * px - x) * 388, (py - y) * 122) < 10);
}
let shapeDrag;
shape.addEventListener("pointerdown", event => {
  if (event.button !== 0)
    return;
  const [x, y, t] = shapePosition(event);
  const index = nearestPoint(x, y);
  const segment = state.points.findIndex(([px]) => px > t);
  const left = state.points[(segment < 0 ? state.points.length : segment) - 1];
  shapeDrag = { index, left, y, bend: left ? left[2] : state.initialBend, hold: Math.hypot((x - holdFraction()) * 388, y * 122) < 10 };
  shape.setPointerCapture(event.pointerId);
});
shape.addEventListener("pointermove", event => {
  if (!shapeDrag || !shape.hasPointerCapture(event.pointerId))
    return;
  const [x, y, t] = shapePosition(event);
  const { index, left } = shapeDrag;
  if (shapeDrag.hold) {
    const value = clamp(x, 0, .95) * ms("release") / Math.max(.05, 1 - x);
    if (synced("hold")) {
      state.holdDivision = beats.slice(0, timing.hold.last + 1).reduce((best, beat, i) => Math.abs(beat * 500 - value) < Math.abs(beats[best] * 500 - value) ? i : best, 0);
    }
    else
      state.holdFree = round(clamp(value, 0, timing.hold.max), 1);
  }
  else if (index >= 0) {
    state.points[index][0] = clamp(t, (state.points[index - 1]?.[0] ?? 0) + .005, (state.points[index + 1]?.[0] ?? 1) - .005);
    state.points[index][1] = y;
    edited = true;
  } else {
    const bend = clamp(shapeDrag.bend + (y - shapeDrag.y) * 2, -1, 1);
    if (left)
      left[2] = bend;
    else
      state.initialBend = bend;
    edited = true;
  }
  refresh();
});
shape.addEventListener("lostpointercapture", () => { shapeDrag = null; });
shape.addEventListener("dblclick", event => {
  const [x, y, t] = shapePosition(event);
  if (state.points.length >= 12 || t <= .005 || t >= .995 || nearestPoint(x, y) >= 0 || state.points.some(([px]) => Math.abs(px - t) < .01))
    return;
  state.points.push([t, y, 0]);
  state.points.sort((a, b) => a[0] - b[0]);
  edited = true;
  refresh();
});
shape.addEventListener("contextmenu", event => {
  event.preventDefault();
  const [x, y, t] = shapePosition(event);
  const index = nearestPoint(x, y);
  if (index >= 0)
    state.points.splice(index, 1);
  else {
    const next = state.points.findIndex(([px]) => px > t);
    const left = state.points[(next < 0 ? state.points.length : next) - 1];
    if (left)
      left[2] = 0;
    else
      state.initialBend = 0;
  }
  edited = true;
  refresh();
});

function image(path) {
  const poster = document.querySelector("#poster, .poster");
  const resolved = new URL(path, document.baseURI).href;
  if (poster && (poster.dataset.svAsset === path ||
      (poster.src === resolved && (poster.crossOrigin === "anonymous" ||
       new URL(resolved).origin === location.origin)))) {
    return poster.decode().then(() => poster);
  }
  return new Promise((resolve, reject) => {
    const asset = new Image();
    if (location.protocol !== "file:") asset.crossOrigin = "anonymous";
    asset.onload = () => resolve(asset);
    asset.onerror = () => reject(new Error(path));
    asset.src = resolved;
  });
}

function loadTheme(theme) {
  if (sprites[theme]) return sprites[theme].ready;
  const entry = sprites[theme] = {};
  entry.ready = image(themeFiles[theme]).then((asset) => {
    entry.loaded = asset;
  }).catch((error) => {
    delete sprites[theme];
    throw error;
  });
  return entry.ready;
}

async function changeTheme(next) {
  const request = ++themeRequest;
  try {
    await loadTheme(next ? "dark" : "light");
    if (request !== themeRequest) return false;
    dark = next;
    refresh();
    return true;
  } catch {
    if (request === themeRequest) announce("This theme could not be loaded.");
    return false;
  }
}

button("theme", "Appearance", "Changes the theme or accent color.", (event) => {
  const color = field("Accent color", accent, (value) => {
    if (!/^#?[a-f0-9]{6}$/i.test(value)) return false;
    accent = ("#" + value.replace(/^#/, "")).toLowerCase();
    refresh();
    return true;
  });
  openPopup(event.currentTarget, [
    choice(dark ? "Light theme" : "Dark theme", () => changeTheme(!dark)),
    color.form,
    choice("Reset appearance", () => { accent = colorDefault; changeTheme(false); refresh(); }),
  ]);
}).setAttribute("aria-haspopup", "true");

document.addEventListener("pointerdown", (event) => {
  if (popupAnchor && !popup.contains(event.target) && !popupAnchor.contains(event.target)) closePopup();
});
document.addEventListener("focusin", (event) => {
  if (popupAnchor && event.target !== popupAnchor && !popup.contains(event.target)) closePopup();
});
document.addEventListener("keydown", (event) => {
  if (!popupAnchor) return;
  if (event.key === "Escape") { event.preventDefault(); closePopup(true); return; }
  if (event.target.tagName === "INPUT" || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const items = [...popup.querySelectorAll("button, input")];
  const current = items.indexOf(document.activeElement);
  event.preventDefault();
  items[(current + items.length + (event.key === "ArrowDown" ? 1 : -1)) % items.length]?.focus();
});
window.addEventListener("resize", () => closePopup());
document.addEventListener("scroll", (event) => {
  if (!popup.contains(event.target)) closePopup();
}, true);
window.addEventListener("blur", () => closePopup());

instrument.inert = true;
instrument.setAttribute("aria-busy", "true");
loadPreset(0);
loadTheme("light").then(() => {
  refresh();
  instrument.inert = false;
  instrument.setAttribute("aria-busy", "false");
}).catch(() => {
  instrument.setAttribute("aria-busy", "false");
  announce("The interactive preview could not load.");
});
