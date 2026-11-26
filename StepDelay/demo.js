"use strict";

const { bounds, frames, atlasCount, factory } = nativeData;
const $ = (id) => document.getElementById(id);
const canvas = $("panel");
const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
const instrument = $("instrument");
const controls = $("controls");
const popup = $("popup");
const colorDefault = "#54d2c8";
const modeLabels = ["Straight", "Triplet", "Dotted", "Unsynced"];
const notes = [
  ["1/64", "1/32", "1/16", "1/8", "1/4", "1/2", "1/1"],
  ["1/64T", "1/32T", "1/16T", "1/8T", "1/4T", "1/2T", "1/1T"],
  ["3/128", "3/64", "3/32", "3/16", "3/8", "3/4", "3/2"],
];
const timeStops = [1, 10, 100, 500, 1000, 2000, 5000];
const defaults = {
  startMode: 0, startNote: 3, startMs: 500, intervalMode: 0, intervalNote: 3, intervalMs: 500,
  cycles: 1, sustain: 50, filter: 0, lowCut: 20, highCut: 20000, refresh: 0, ducking: 0,
  threshold: -40, width: 100, order: 0, mix: 100, firstEchoFollowsTime: 1,
  single: 0, cycleMutes: 0, alternate: 0, widthSpread: 0, widthMinimum: 0,
};
const alias = {
  startMode: "firstEchoMode", startNote: "firstEchoNote", startMs: "firstEchoMs", cycles: "pairs",
  sustain: "length", lowCut: "highPass", highCut: "lowPass", ducking: "duck",
  width: "girth", order: "rightFirst",
};
const ranges = {
  sustain: [0, 100, 1], width: [0, 100, 1], lowCut: [20, 2000, .35], highCut: [2000, 20000, .5],
  ducking: [0, 100, 1], mix: [0, 100, 1], threshold: [-80, 0, 1],
};
const dialLabels = {
  start: "Start", interval: "Interval", sustain: "Sustain", width: "Width",
  lowCut: "Low Cut", highCut: "High Cut", ducking: "Ducking", mix: "Dry/Wet",
  threshold: "Refresh threshold",
};
const sprites = {};
const buttons = {};
const dials = {};
const readouts = {};
let state = { ...defaults };
let dark = false;
let accent = colorDefault;
let kill = false;
let presetIndex = 0;
let presetName = factory[0].name;
let edited = false;
let popupAnchor;
let renderPending = false;

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const round = (value, places = 0) => Number(value.toFixed(places));
const sideOf = (side) => side === "start" && state.firstEchoFollowsTime ? "interval" : side;
const modeOf = (side) => state[sideOf(side) + "Mode"];
const isTiming = (id) => id === "start" || id === "interval";
const spreadOn = () => !state.single && state.widthSpread > 0;
const mutableCycles = (count) => ((1 << (count - 1)) - 1) & ~1;

function timeFromUnit(unit) {
  const slot = unit * 6;
  const i = Math.min(5, Math.floor(slot));
  return timeStops[i] + (slot - i) * (timeStops[i + 1] - timeStops[i]);
}

function timeToUnit(value) {
  const i = timeStops.findIndex((stop, index) => index > 0 && stop >= value) - 1;
  const slot = Math.max(0, i);
  return (slot + (value - timeStops[slot]) / (timeStops[slot + 1] - timeStops[slot])) / 6;
}

function keyOf(id) {
  return isTiming(id) ? sideOf(id) + (modeOf(id) === 3 ? "Ms" : "Note") : id;
}

function valueToUnit(id, value) {
  if (isTiming(id)) return modeOf(id) === 3 ? timeToUnit(value) : value / 6;
  const [low, high, skew] = ranges[id];
  return Math.pow(clamp((value - low) / (high - low), 0, 1), skew);
}

function unitToValue(id, value) {
  if (isTiming(id)) return modeOf(id) === 3 ? round(timeFromUnit(value), 1) : Math.round(value * 6);
  const [low, high, skew] = ranges[id];
  return round(low + (high - low) * Math.pow(value, 1 / skew), id === "threshold" ? 1 : 0);
}

function format(id, value) {
  if (id === "threshold") return state.refresh ? round(value, 1) + " dB" : "OFF";
  if (id === "lowCut" || id === "highCut") {
    if (!state.filter) return "OFF";
    return value >= 1000 ? round(value / 1000, 1) + " kHz" : Math.round(value) + " Hz";
  }
  if (id === "width" && spreadOn()) {
    return Math.round(Math.min(value, state.widthMinimum)) + "-" + Math.round(value) + "%";
  }
  if (isTiming(id)) {
    const mode = modeOf(id);
    if (mode !== 3) return notes[mode][value];
    return value >= 1000 ? (value / 1000).toFixed(2) + " s" : value.toFixed(1) + " ms";
  }
  return Math.round(value) + "%";
}

function patch(set, name) {
  const [page, sx, sy] = frames[name];
  const [x, y, w, h] = bounds[name];
  context.drawImage(set.atlases[page], sx, sy, w, h, x, y, w, h);
}

function paintValue(rect, value, color, align = "center") {
  const [x, y, w, h] = rect;
  // Extend a clean strip of the native paint through its original readout.
  context.drawImage(canvas, x + 3, y, 1, h, x + 4, y, w - 8, h);
  context.font = "16px Arial, sans-serif";
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(value, align === "right" ? x + w - 8 : x + w / 2, y + h / 2 + 1, w - 20);
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
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const chroma = Math.min(g, b) - r;
    if (chroma < 4 || Math.abs(g - b) > Math.max(20, chroma * .42)) continue;
    const amount = chroma / 116;
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] += amount * (target[channel] - source[channel]);
    }
  }
  context.putImageData(frame, 0, 0);
}

function render() {
  renderPending = false;
  const set = sprites[dark ? "dark" : "light"]?.loaded;
  if (!set) return;
  context.drawImage(set.base, 0, 0);
  let timingChanged = false;
  for (const side of ["start", "interval"]) {
    const mode = modeOf(side);
    const value = state[keyOf(side)];
    if (mode === 0 && value === 3) continue;
    timingChanged = true;
    const step = mode === 3 ? Math.round(timeToUnit(value) * 24) : value;
    patch(set, side + mode + "_" + step);
    if (mode === 3) paintValue(bounds["value-" + side], format(side, value), "#f7f7f7");
  }
  // The order button sits on the seam between the two timing crops.
  if (timingChanged || state.single || state.order || state.alternate) {
    patch(set, state.single ? "orderDisabled" : "order" + (state.order + 2 * state.alternate));
  }
  if (timingChanged || !state.firstEchoFollowsTime) patch(set, "link" + state.firstEchoFollowsTime);
  for (let i = 2; i <= state.cycles; i++) {
    if (!(state.cycleMutes & (1 << (i - 1)))) patch(set, "cycle" + i);
  }
  if (kill) patch(set, "killOn");
  if (state.single) patch(set, "single");
  if (state.single || state.widthSpread) {
    patch(set, (state.single ? "spreadDisabled" : "spread") + state.widthSpread);
  }
  if (state.filter) patch(set, "filterOn");
  for (const id of Object.keys(ranges)) {
    if (id === "threshold" && !state.refresh) continue;
    if ((id === "lowCut" || id === "highCut") && !state.filter) continue;
    if (["sustain", "width", "ducking", "mix"].includes(id) &&
        state[id] === defaults[id] && !(id === "width" && spreadOn())) continue;
    const step = Math.round(valueToUnit(id, state[id]) * 24);
    patch(set, id + step);
    if (format(id, state[id]) !== format(id, unitToValue(id, step / 24)) ||
        (id === "width" && spreadOn())) {
      paintValue(bounds["value-" + id], format(id, state[id]), dark ? "#f7f7f7" : "#101010");
    }
  }
  if (presetName !== factory[0].name || edited) {
    paintValue([408, 64, 303, 24], presetName, colorDefault);
    if (edited) {
      context.fillStyle = colorDefault;
      context.fillText("*", 705, 77);
    }
  }
  customAccent();
}

function refresh() {
  for (const id of Object.keys(dials)) {
    const value = state[keyOf(id)];
    const range = isTiming(id) ? (modeOf(id) === 3 ? [1, 5000] : [0, 6]) : ranges[id];
    const active = !((id === "lowCut" || id === "highCut") && !state.filter);
    const dial = dials[id];
    dial.disabled = !active;
    dial.setAttribute("aria-valuemin", range[0]);
    dial.setAttribute("aria-valuemax", range[1]);
    dial.setAttribute("aria-valuenow", value);
    dial.setAttribute("aria-valuetext", format(id, value));
    readouts[id].disabled = !active || (id === "threshold" && !state.refresh);
    readouts[id].hidden = isTiming(id) && modeOf(id) !== 3;
    readouts[id].setAttribute("aria-label", "Edit " + dialLabels[id] + " value, " + format(id, value));
  }
  for (const id of ["start", "interval"]) {
    buttons[id + "-mode"].setAttribute("aria-label", dialLabels[id] + " mode, " + modeLabels[modeOf(id)]);
  }
  for (let i = 1; i <= 8; i++) {
    const muted = (state.cycleMutes & (1 << (i - 1))) !== 0;
    buttons["cycle-" + i].setAttribute("aria-pressed", String(i <= state.cycles && !muted));
    buttons["cycle-" + i].setAttribute("aria-label", "Cycle " + i + (muted ? ", muted" : ""));
  }
  const orderIndex = state.order + 2 * state.alternate;
  buttons["echo-order"].setAttribute("aria-label", "Echo order, " +
    ["left first", "right first", "alternate left first", "alternate right first"][orderIndex]);
  buttons["width-spread"].setAttribute("aria-label", "Stereo width, " + ["fixed", "widen", "narrow"][state.widthSpread]);
  buttons["echo-order"].disabled = buttons["width-spread"].disabled = Boolean(state.single);
  buttons.presets.setAttribute("aria-label", "Browse presets, " + presetName + (edited ? ", modified" : ""));
  const flags = { filter: state.filter, link: state.firstEchoFollowsTime, "single-mode": state.single, "dual-mode": !state.single, kill };
  for (const [id, value] of Object.entries(flags)) buttons[id].setAttribute("aria-pressed", String(Boolean(value)));
  if (!renderPending) {
    renderPending = true;
    requestAnimationFrame(render);
  }
}

function commit(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  if (key !== "mix" && key !== "threshold") edited = true;
  refresh();
}

function setDial(id, value, fromGesture = false) {
  if (id === "width" && spreadOn() && fromGesture) {
    value = Math.max(value, Math.min(state.width, state.widthMinimum));
  }
  commit(keyOf(id), value);
}

function hotspot(id, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = id;
  button.className = "hotspot";
  button.setAttribute("aria-label", label);
  button.title = label;
  controls.append(button);
  return button;
}

function position(element, rect) {
  const [x, y, w, h] = rect;
  Object.assign(element.style, {
    left: (x / 16) + "%", top: (y / 6) + "%",
    width: (w / 16) + "%", height: (h / 6) + "%",
  });
}

function button(id, label, action, rect = bounds[id]) {
  const target = hotspot(id, label);
  position(target, rect);
  target.addEventListener("click", action);
  buttons[id] = target;
  return target;
}

function announce(message) {
  $("status").textContent = message;
  $("status").hidden = !message;
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
  const value = state[keyOf(id)];
  const { form, input } = field(dialLabels[id], format(id, value), (text) => {
    if (id === "width" && spreadOn()) {
      const span = text.match(/^(\d+(?:\.\d+)?)\s*%?\s*[-–]\s*(\d+(?:\.\d+)?)\s*%?$/);
      if (span) {
        const max = clamp(Number(span[2]), 0, 100);
        commit("widthMinimum", Math.round(clamp(Number(span[1]), 0, max)));
        setDial(id, max);
        return true;
      }
    }
    const number = text.match(/^(-?\d+(?:\.\d+)?)\s*(kHz|Hz|k|ms|s|dB|%)?$/i);
    if (!number) return false;
    const unit = (number[2] ?? "").toLowerCase();
    const allowed = isTiming(id) ? ["ms", "s"] : id === "threshold" ? ["db"] :
      id.endsWith("Cut") ? ["hz", "khz", "k"] : ["%"];
    if (unit && !allowed.includes(unit)) return false;
    const typed = Number(number[1]) * (["s", "k", "khz"].includes(unit) ? 1000 : 1);
    if (id === "width" && spreadOn()) {
      commit("widthMinimum", Math.round(clamp(typed, 0, state.width)));
    } else {
      const [min, max] = isTiming(id) ? [1, 5000] : ranges[id];
      setDial(id, clamp(typed, min, max));
    }
    return true;
  });
  openPopup(anchor, [form], input);
  input.select();
}

function bindDial(id) {
  const target = hotspot("dial-" + id, dialLabels[id]);
  position(target, bounds["hit-" + id]);
  target.classList.add("round");
  target.setAttribute("role", "slider");
  target.setAttribute("aria-orientation", "vertical");
  if (id === "threshold") target.title = "Click to toggle Refresh. Drag to set the threshold.";
  let drag;
  const adjust = (delta) => {
    const unit = valueToUnit(id, state[keyOf(id)]) + delta;
    setDial(id, unitToValue(id, clamp(unit, 0, 1)), true);
  };
  target.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, y: event.clientY, x: event.clientX,
      start: valueToUnit(id, state[keyOf(id)]), moved: false };
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = drag.y - event.clientY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (!drag.moved || (id === "threshold" && !state.refresh)) return;
    const distance = Math.max(56, instrument.clientWidth * .105) * (event.shiftKey ? 5 : 1);
    setDial(id, unitToValue(id, clamp(drag.start + dy / distance, 0, 1)), true);
  });
  target.addEventListener("pointerup", (event) => {
    if (drag?.id === event.pointerId && !drag.moved && id === "threshold") commit("refresh", 1 - state.refresh);
    drag = undefined;
  });
  target.addEventListener("pointercancel", () => { drag = undefined; });
  target.addEventListener("lostpointercapture", () => { drag = undefined; });
  target.addEventListener("click", (event) => {
    if (event.detail === 0 && id === "threshold") commit("refresh", 1 - state.refresh);
  });
  target.addEventListener("dblclick", () => {
    if (id !== "threshold") setDial(id, defaults[keyOf(id)], true);
  });
  target.addEventListener("keydown", (event) => {
    const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[event.key];
    if (delta === undefined && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (id === "threshold" && !state.refresh) return;
    if (event.key === "Home" || event.key === "End") {
      setDial(id, unitToValue(id, event.key === "Home" ? 0 : 1), true);
    } else adjust(delta / (isTiming(id) && modeOf(id) !== 3 ? 6 : 50));
  });
  target.addEventListener("wheel", (event) => {
    if (document.activeElement !== target || (id === "threshold" && !state.refresh)) return;
    event.preventDefault();
    adjust(Math.sign(-event.deltaY) / (isTiming(id) && modeOf(id) !== 3 ? 6 : 50));
  }, { passive: false });
  dials[id] = target;
  readouts[id] = button("value-" + id, "Edit " + dialLabels[id],
    (event) => editValue(id, event.currentTarget));
}

function loadPreset(index) {
  presetIndex = (index + factory.length) % factory.length;
  const preset = factory[presetIndex];
  state = { ...defaults, ...preset.values, mix: state.mix, threshold: state.threshold };
  presetName = preset.name;
  edited = false;
  announce("");
  refresh();
}

function decodePreset(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 9) throw new Error("Too short");
  const header = new DataView(buffer);
  const binary = header.getUint32(0, true) === 0x21324356;
  const length = binary ? header.getUint32(4, true) : bytes.length;
  if (binary && (length === 0 || length > bytes.length - 8)) throw new Error("Invalid length");
  const text = new TextDecoder().decode(binary ? bytes.subarray(8, 8 + length) : bytes).replace(/\0+$/, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Invalid preset XML");
  const element = new DOMParser().parseFromString(text, "application/xml").documentElement;
  if (!["StepDelayPreset", "FinestDelay", "StepDelaySession"].includes(element.localName) ||
      (element.localName === "StepDelayPreset" && element.getAttribute("version") !== "1")) {
    throw new Error("Invalid preset");
  }
  const values = { ...defaults };
  const seen = new Set();
  const canonical = new Set();
  let legacyLowCut = 0;
  for (const item of element.children) {
    const stored = item.getAttribute("id");
    const raw = item.getAttribute("value");
    if (item.localName !== "PARAM" || raw === null || !raw.trim() ||
        !Number.isFinite(Number(raw)) || seen.has(stored)) throw new Error("Invalid parameter");
    seen.add(stored);
    const id = Object.keys(defaults).find((key) => key === stored || alias[key] === stored);
    if (!id) {
      if (stored === "slope") continue;
      throw new Error("Unknown parameter");
    }
    if (canonical.has(id)) throw new Error("Duplicate parameter");
    canonical.add(id);
    if (id === "lowCut") legacyLowCut = Number(raw);
    const range = ranges[id] ?? (id.endsWith("Ms") ? [1, 5000] :
      id.endsWith("Note") ? [0, 6] : id.endsWith("Mode") ? [0, 3] :
        ({ cycles: [1, 8], cycleMutes: [0, 255], widthSpread: [0, 2], widthMinimum: [0, 100] }[id] ?? [0, 1]));
    const value = clamp(Number(raw), range[0], range[1]);
    values[id] = ranges[id] || id.endsWith("Ms") ? value : Math.round(value);
  }
  if (!seen.has("filter")) values.filter = Number(legacyLowCut > 0 || values.highCut < 20000);
  values.cycleMutes &= mutableCycles(values.cycles);
  if (!seen.size) throw new Error("Empty preset");
  return values;
}

function savePreset() {
  const params = Object.entries(state).filter(([id]) => id !== "mix" && id !== "threshold");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<StepDelayPreset version="1">\n' +
    params.map(([id, val]) => '  <PARAM id="' + (alias[id] ?? id) + '" value="' + val + '"/>').join("\n") +
    "\n</StepDelayPreset>\n";
  const encoded = new TextEncoder().encode(xml);
  const bytes = new Uint8Array(9 + encoded.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x21324356, true);
  header.setUint32(4, encoded.length, true);
  bytes.set(encoded, 8);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = (presetName.replace(/[^a-z0-9 '()_-]/gi, "_") || "StepDelay") + ".stepdelay";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce("Preset saved.");
}

function muteCycle(i) {
  const bit = 1 << (i - 1);
  if (mutableCycles(state.cycles) & bit) commit("cycleMutes", state.cycleMutes ^ bit);
}

for (let i = 1; i <= 8; i++) {
  let hold;
  let held = false;
  const target = button("cycle-" + i, "Cycle " + i, () => {
    if (held) { held = false; return; }
    commit("cycleMutes", 0);
    commit("cycles", i);
  }, bounds["cycle" + i]);
  target.dataset.cycle = i;
  target.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!held) muteCycle(i);
  });
  target.addEventListener("pointerdown", (event) => {
    held = false;
    if (event.pointerType === "touch") hold = setTimeout(() => { held = true; muteCycle(i); }, 450);
  });
  for (const stop of ["pointerup", "pointercancel", "pointerleave"]) {
    target.addEventListener(stop, () => clearTimeout(hold));
  }
  target.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      muteCycle(i);
    }
  });
}

const killButton = button("kill", "Kill, hold to activate", () => {});
function setKill(active) { kill = active; refresh(); }
killButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  killButton.setPointerCapture(event.pointerId);
  setKill(true);
});
for (const stop of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) {
  killButton.addEventListener(stop, () => setKill(false));
}
for (const eventName of ["keydown", "keyup"]) {
  killButton.addEventListener(eventName, (event) => {
    if (![" ", "Enter"].includes(event.key)) return;
    event.preventDefault();
    setKill(eventName === "keydown");
  });
}

button("single-mode", "Single", () => commit("single", 1));
button("dual-mode", "Dual", () => commit("single", 0));
button("link", "Link Start to Interval", () => commit("firstEchoFollowsTime", 1 - state.firstEchoFollowsTime));
button("filter", "Filter", () => commit("filter", 1 - state.filter));
button("width-spread", "Stereo width mode", () => commit("widthSpread", (state.widthSpread + 1) % 3));
button("echo-order", "Echo order", () => {
  if (state.order) commit("alternate", 1 - state.alternate);
  commit("order", 1 - state.order);
});
for (const side of ["start", "interval"]) {
  const target = button(side + "-mode", dialLabels[side] + " mode", (event) => {
    const mode = modeOf(side);
    openPopup(event.currentTarget, modeLabels.map((label, value) =>
      choice(label, () => commit(sideOf(side) + "Mode", value), value === mode)));
  });
  target.setAttribute("aria-haspopup", "true");
}
for (const id of Object.keys(dialLabels)) bindDial(id);

const [presetX, presetY, , presetH] = bounds.presets;
button("presets", "Browse presets", (event) => {
  openPopup(event.currentTarget, factory.map((preset, i) =>
    choice(preset.name, () => loadPreset(i), i === presetIndex)));
}, [presetX, presetY, bounds.previous[0] - presetX, presetH]).setAttribute("aria-haspopup", "true");
button("previous", "Previous preset", () => loadPreset(presetIndex - 1));
button("next", "Next preset", () => loadPreset(presetIndex + 1));
button("open", "Load local preset", () => $("preset-file").click());
button("save", "Save preset", savePreset);
button("website", "Stolen Valor website", () => window.open("https://itsstolenvalor.com", "_blank", "noopener"));
$("preset-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error("File too large");
    const loaded = decodePreset(await file.arrayBuffer());
    state = { ...loaded, mix: state.mix, threshold: state.threshold };
    presetName = file.name.replace(/\.stepdelay$/i, "");
    presetIndex = -1;
    edited = false;
    announce("Preset loaded.");
    refresh();
  } catch {
    announce("Could not open this StepDelay preset.");
  }
});

function image(path) {
  return new Promise((resolve, reject) => {
    const asset = new Image();
    asset.onload = () => resolve(asset);
    asset.onerror = () => reject(new Error(path));
    asset.src = path;
  });
}

function loadTheme(theme) {
  if (sprites[theme]) return sprites[theme].ready;
  const entry = sprites[theme] = {};
  entry.ready = Promise.all([
    image("assets/" + theme + "-base.webp"),
    ...Array.from({ length: atlasCount }, (_, index) => image("assets/" + theme + "-" + index + ".webp")),
  ]).then(([base, ...atlases]) => { entry.loaded = { base, atlases }; }).catch((error) => {
    delete sprites[theme];
    throw error;
  });
  return entry.ready;
}

let themeRequest = 0;
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

button("theme", "Appearance", (event) => {
  const color = field("Accent color", accent, (value) => {
    if (!/^#?[a-f0-9]{6}$/i.test(value)) return false;
    accent = ("#" + value.replace(/^#/, "")).toLowerCase();
    refresh();
    return true;
  });
  openPopup(event.currentTarget, [
    choice(dark ? "Light theme" : "Dark theme", () => changeTheme(!dark)),
    color.form,
    choice("Reset appearance", () => { accent = colorDefault; changeTheme(false); }),
  ]);
}).setAttribute("aria-haspopup", "true");

$("reset").addEventListener("click", () => {
  closePopup();
  state = { ...defaults };
  kill = false;
  accent = colorDefault;
  loadPreset(0);
  changeTheme(false);
});
$("size").addEventListener("click", (event) => {
  const target = event.currentTarget;
  const enlarged = $("viewport").classList.toggle("enlarged");
  target.setAttribute("aria-pressed", String(enlarged));
  target.textContent = enlarged ? "Fit to screen" : "Enlarge controls";
  if (!enlarged) $("viewport").scrollLeft = 0;
});
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
$("viewport").addEventListener("scroll", () => closePopup());
window.addEventListener("blur", () => setKill(false));

loadTheme("light").then(() => {
  refresh();
  canvas.hidden = false;
  $("poster").hidden = true;
  instrument.inert = false;
  instrument.setAttribute("aria-busy", "false");
}).catch(() => {
  instrument.setAttribute("aria-busy", "false");
  announce("The interactive preview could not load.");
});
