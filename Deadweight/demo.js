"use strict";

const panel = document.querySelector("#panel");
const ctx = panel.getContext("2d");
ctx.scale(2, 2);
const controls = document.querySelector("#controls");
const presets = document.querySelector("#presets");
const W = 1141, H = 446;
const accent = "#54d2c8";
const themes = ["light", "dark"].map(theme => {
  const image = new Image();
  image.src = "assets/" + theme + ".png";
  return image;
});
const notes = "1/64T 1/64 1/32T 3/128 1/32 1/16T 3/64 1/16 1/8T 3/32 1/8 1/4T 3/16 1/4 1/2T 3/8 1/2 1/1T 3/4 1/1 3/2".split(" ");
const beats = [1/24,1/16,1/12,3/32,1/8,1/6,3/16,1/4,1/3,3/8,1/2,2/3,3/4,1,4/3,1.5,2,8/3,3,4,6];
const knobs = [
  {name:"Hold", x:135, free:0, division:1, synced:false, max:250, last:10},
  {name:"Release", x:346, free:125, division:7, synced:true, max:1000, last:20}
];
let dark = false, audio = false, listening = false, bars = 4;
let threshold = -36, reduction = -6, lookahead = 0, preset = 0, edited = false;
let points = [], initialBend = 0;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const ms = knob => knob.synced ? beats[knob.division] * 500 : knob.free;
const timingText = knob => knob.synced ? notes[knob.division] : knob.free.toFixed(1) + " ms";

function fill(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function label(value, x, y, color = "#f4f4f4", size = 12) {
  ctx.fillStyle = color;
  ctx.font = size + "px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function trace(path, color, width = 1, close = false) {
  ctx.beginPath();
  path.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  if (close) {
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function grid(x,y,w,h,cols,rows,color) {
  for (let i = 0; i <= cols; i++) trace([[x+w*i/cols,y],[x+w*i/cols,y+h]],color);
  for (let i = 0; i <= rows; i++) trace([[x,y+h*i/rows],[x+w,y+h*i/rows]],color);
}

function curve(t) {
  const nodes = [[0,0,initialBend], ...points, [1,1,0]];
  const right = nodes.findIndex(([x], i) => i && x >= t);
  const [x,y,bend] = nodes[right-1];
  const [nextX,nextY] = nodes[right];
  const u = (t-x)/(nextX-x);
  const v = u+bend*u*(1-u);
  return y+(nextY-y)*v*v*(3-2*v);
}

const shapeBox = [47,112,388,122];
function holdFraction() {
  return ms(knobs[0]) / (ms(knobs[0]) + ms(knobs[1]) || 1);
}

function drawShape() {
  const [x,y,w,h] = shapeBox;
  const bg = ctx.createLinearGradient(0,y,0,y+h);
  bg.addColorStop(0,dark ? "#2a2b2c" : "#f0eded");
  bg.addColorStop(1,dark ? "#1c1d1e" : "#eeebeb");
  fill(x-4,y-4,w+8,h+8,bg);
  grid(x,y,w,h,8,4,dark ? "#ffffff14" : "#00000012");
  const hold = holdFraction(), start = x+w*hold, span = w*(1-hold);
  const path = [[x,y+h],...Array.from({length:129},(_,i) => [start+span*i/128,y+h*(1-curve(i/128))]),[x+w,y]];
  trace([...path,[x+w,y+h]],"#54d2c823",1,true);
  trace(path,accent,1.5);
  for (const [px,py] of [[0,0],...points,[1,1]]) {
    ctx.beginPath();
    ctx.arc(start+span*px,y+h*(1-py),3.4,0,Math.PI*2);
    ctx.fillStyle = dark ? "#262728" : "#f2efef";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
}

// Fixed visual test pattern. The page never opens an audio device.
const hits = [[.07,.075,.88],[.23,.042,.72],[.34,.10,.94],[.53,.053,.78],[.65,.085,.84],[.83,.043,.70],[.91,.065,.92]];
function drawHistory() {
  const x=501, w=593, top=106, lower=258, h=122;
  const shade = ctx.createLinearGradient(0,top,0,lower+h);
  shade.addColorStop(0,"#2e2f30");
  shade.addColorStop(1,"#1a1b1c");
  fill(x-18,top,w+19,h+2,shade);
  fill(x-18,lower-2,w+19,h+4,shade);
  grid(x,top,w,h,bars*2,0,"#ffffff14");
  grid(x,lower,w,h,bars*2,5,"#ffffff14");
  const depth = reduction === -60 ? -96 : reduction;
  const scale = [4,8,12,24,48,96].find(limit => -depth<=limit-Math.min(3,limit*.2)) ?? 96;
  const guide = lower+h*Math.min(.98,-depth*.85/scale);
  for (let i=0;i<=5;i++) label(i===5 ? "-inf" : String(-Math.round(i*scale/5)),493,lower+i*h/5,"#eee",9);
  ctx.setLineDash([3,3]);
  trace([[x,guide],[x+w,guide]],"#ffffff70");
  const thresholdY = top+h*(-threshold/72);
  if (audio) trace([[x,thresholdY],[x+w,thresholdY]],"#ffffff70");
  ctx.setLineDash([]);
  const history = [], gain = [];
  const duration = bars*2000;
  for (let i=0;i<=593;i++) {
    const pos = i/593*bars/4;
    let age = Infinity, peak = 0, end = 0;
    for (const [start,len,level] of hits) {
      if (pos>=start) {
        age = (pos-start)*8000;
        end = len*8000*(audio ? clamp((threshold+72)/72,.12,.95) : 1);
        peak = level*Math.exp(-age/(len*2900))*(.78+.15*Math.sin(i*1.9)+.06*Math.sin(i*.37));
      }
    }
    const recovery = clamp((age-end-ms(knobs[0])+ (audio ? lookahead : 0))/Math.max(1,ms(knobs[1])),0,1);
    const measured = Number.isFinite(age) && age<duration ? curve(recovery) : 1;
    gain.push([x+i,lower+(guide-lower)*(1-measured)]);
    history.push([x+i,top+h*(1-clamp((72+20*Math.log10(Math.max(.00025,peak)))/72,0,1))]);
  }
  if (audio) {
    trace([[x,top+h],...history,[x+w,top+h]],listening ? "#54d2c8" : "#96999a",1,true);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x,top,w,thresholdY-top);
    ctx.clip();
    trace([[x,top+h],...history,[x+w,top+h]],accent,1,true);
    ctx.restore();
  } else {
    for (const [start,len] of hits) {
      const left = start*4/bars, end = Math.min(1,(start+len)*4/bars);
      if (left>=1) continue;
      for (const offset of [0,18,35].slice(0,1+Math.round(start*8)%3)) {
        fill(x+left*w,top+88-offset,(end-left)*w,4,accent);
      }
    }
  }
  trace(gain,accent,1.5);
}

function draw() {
  const image = themes[Number(dark)];
  if (!image.complete || !image.naturalWidth) return;
  panel.hidden = false;
  ctx.drawImage(image,0,0,W,H);
  const text = dark ? "#f4f4f4" : "#161719";
  drawShape();
  drawHistory();
  for (const [index,knob] of knobs.entries()) {
    const x = knob.x, y = 343;
    const scale = value => Math.log1p(value/10)/Math.log1p(knob.max/10);
    const angle = knob.synced ? knob.division/knob.last : scale(knob.free);
    const original = index ? scale(160) : scale(40);
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate((angle-original)*Math.PI*1.52);
    ctx.beginPath();
    ctx.arc(0,0,35,0,Math.PI*2);
    ctx.clip();
    ctx.drawImage(image,-x,-y,W,H);
    ctx.restore();
    fill(x-31,386,62,16,dark ? "#222324" : "#eae7e7");
    label(timingText(knob),x,394,text);
    const syncX = index ? 401 : 191;
    fill(syncX-9,288,18,19,dark ? "#2c2d2e" : "#eeebeb");
    label("♫",syncX,297,knob.synced ? accent : "#78827e",16);
    knob.control.setAttribute("aria-valuenow",String(knob.synced ? knob.division : knob.free));
    knob.control.setAttribute("aria-valuemax",String(knob.synced ? knob.last : knob.max));
    knob.control.setAttribute("aria-valuetext",timingText(knob));
    knob.sync.setAttribute("aria-pressed",String(knob.synced));
  }
  fill(153,82,191,16,"#28292a");
  label(factory[preset].name+(edited ? " *" : ""),246,90,accent);
  for (const [i,value] of ["MIDI","AUDIO"].entries()) {
    const selected = Boolean(i) === audio;
    fill(573+i*51,83,49,19,selected ? accent : "#28292a");
    label(value,597+i*51,92,selected ? "#131415" : "#fff");
    modeControls[i].setAttribute("aria-pressed",String(selected));
  }
  if (listening) label("♪",700,93,accent,15);
  for (const [title,value,x,y,control] of [
    ["Lookahead",lookahead.toFixed(1)+" ms",866,92,lookControl],
    ["Threshold",threshold.toFixed(1)+" dB",1057,92,thresholdControl],
    ["Reduction",reduction===-60?"−inf dB":reduction.toFixed(1)+" dB",1057,243,reductionControl]
  ]) {
    fill(x-33,y-7,66,14,"#292a2b");
    label(value,x,y,audio || title==="Reduction" ? "#fff" : "#a4a6a6");
    control.setAttribute("aria-valuetext",value);
  }
  listen.setAttribute("aria-pressed",String(listening));
  lookControl.disabled = thresholdControl.disabled = !audio;
  for (let i=1;i<=4;i++) {
    const x=692+(i-1)*70;
    fill(x-29,383,58,16,"#1a1b1c");
    label(i===1?"1 BAR":i+" BARS",x,391,bars===i?accent:"#fff",10);
    barControls[i-1].setAttribute("aria-pressed",String(bars===i));
  }
}

function hotspot(name, bounds, title, action) {
  const target = document.createElement("button");
  const [x,y,w,h] = bounds;
  target.type = "button";
  target.className = "hotspot";
  target.setAttribute("aria-label",name);
  target.title = title;
  Object.assign(target.style,{left:x/W*100+"%",top:y/H*100+"%",width:w/W*100+"%",height:h/H*100+"%"});
  if (action) target.addEventListener("click",action);
  controls.append(target);
  return target;
}

function slider(name,bounds,tip,read,write,min,max,step,sensitivity) {
  const target = hotspot(name,bounds,tip);
  target.setAttribute("role","slider");
  function update(value) {
    const limit = typeof max==="function" ? max() : max;
    write(clamp(Math.round(value/step())*step(),min,limit));
    target.setAttribute("aria-valuenow",String(read()));
    draw();
  }
  target.setAttribute("aria-valuemin",String(min));
  target.setAttribute("aria-valuemax",String(typeof max==="function"?max():max));
  target.setAttribute("aria-valuenow",String(read()));
  let drag;
  target.addEventListener("pointerdown",event => {
    if (event.button!==0) return;
    drag = [event.clientY,read(),panel.getBoundingClientRect().height/H];
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener("pointermove",event => {
    if (drag && target.hasPointerCapture(event.pointerId))
      update(drag[1]+(drag[0]-event.clientY)*sensitivity()/drag[2]);
  });
  target.addEventListener("lostpointercapture",()=>{ drag=null; });
  target.addEventListener("keydown",event => {
    const direction = {ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[event.key];
    if (!direction) return;
    event.preventDefault();
    update(read()+direction*step());
  });
  return target;
}

for (const knob of knobs) {
  knob.control = slider(knob.name,[knob.x-43,299,86,102],
    knob.name==="Hold" ? "Delays recovery after the trigger ends." : "Sets the duration of the recovery shape.",
    ()=>knob.synced?knob.division:knob.free,
    value=>{ if(knob.synced) knob.division=value; else knob.free=value; },
    0,()=>knob.synced?knob.last:knob.max,()=>knob.synced?1:.1,()=>knob.synced?.13:knob.max/155);
  knob.sync = hotspot(knob.name+" Sync",[knob.x+43,282,27,29],
    "Syncs "+knob.name+" to the host tempo.",()=>{ knob.synced=!knob.synced; draw(); });
}

const modeControls = ["MIDI","Audio"].map((mode,i)=>hotspot(mode,[572+i*51,81,51,23],
  i?"Triggers ducking from the external sidechain.":"Triggers ducking from MIDI notes.",
  ()=>{audio=Boolean(i); listening=false; draw();}));
const listen = hotspot("Listen",[687,79,26,27],"Auditions held MIDI notes or detected sidechain audio in the plug-in.",
  ()=>{listening=!listening; draw();});
const lookControl = slider("Lookahead",[828,80,78,24],"Moves ducking earlier relative to sidechain audio.",
  ()=>lookahead,value=>{lookahead=value;},0,10,()=>.1,()=>.09);
const thresholdControl = slider("Threshold",[1018,80,78,24],"Sets the level at which sidechain audio triggers ducking.",
  ()=>threshold,value=>{threshold=value;},-72,0,()=>.5,()=>.57);
const reductionControl = slider("Reduction",[1018,232,78,24],"Sets the amount of gain reduction.",
  ()=>reduction,value=>{reduction=value;},-60,0,()=>.5,()=>.46);
const barControls = Array.from({length:4},(_,i)=>hotspot((i+1)+" bars",[667+i*70,381,52,22],
  "Sets the display to "+(i+1)+(i===0?" bar.":" bars."),()=>{bars=i+1; draw();}));
hotspot("Appearance",[402,365,36,35],"Switches between light and dark themes.",()=>{dark=!dark; draw();});
hotspot("Stolen Valor website",[735,45,36,19],"Opens Stolen Valor’s website.",
  ()=>window.open("https://itsstolenvalor.com","_blank","noopener"));
hotspot("Load preset",[378,80,27,22],"Loading local files is unavailable in the demo.").disabled=true;
hotspot("Save preset",[406,80,27,22],"Saving files is unavailable in the demo.").disabled=true;

function selectPreset(index) {
  preset=(index+factory.length)%factory.length;
  presets.selectedIndex=preset;
  points=factory[preset].points.map(point=>point.slice());
  initialBend=factory[preset].bend;
  edited=false;
  draw();
}
for(const item of factory) presets.add(new Option(item.name));
presets.title="Loads or reloads a factory shape.";
presets.addEventListener("change",()=>selectPreset(presets.selectedIndex));
hotspot("Previous preset",[352,80,18,10],"Loads the previous preset.",()=>selectPreset(preset-1));
hotspot("Next preset",[352,90,18,11],"Loads the next preset.",()=>selectPreset(preset+1));

const shape = hotspot("Recovery shape",shapeBox,"Defines how the wet signal recovers after Hold.");
shape.classList.add("shape");
function shapePosition(event) {
  const rect=shape.getBoundingClientRect();
  const x=clamp((event.clientX-rect.left)/rect.width,0,1);
  const y=1-clamp((event.clientY-rect.top)/rect.height,0,1);
  return [x,y,clamp((x-holdFraction())/Math.max(.0001,1-holdFraction()),0,1)];
}
function nearestPoint(x,y) {
  const hold=holdFraction();
  return points.findIndex(([px,py])=>Math.hypot((hold+(1-hold)*px-x)*388,(py-y)*122)<10);
}
let shapeDrag;
shape.addEventListener("pointerdown",event=>{
  if(event.button!==0) return;
  const [x,y,t]=shapePosition(event);
  const index=nearestPoint(x,y);
  const segment=points.findIndex(([px])=>px>t);
  const left=points[(segment<0?points.length:segment)-1];
  shapeDrag={index,left,y,bend:left?left[2]:initialBend,hold:Math.hypot((x-holdFraction())*388,y*122)<10};
  shape.setPointerCapture(event.pointerId);
});
shape.addEventListener("pointermove",event=>{
  if(!shapeDrag || !shape.hasPointerCapture(event.pointerId)) return;
  const [x,y,t]=shapePosition(event);
  const {index,left}=shapeDrag;
  if(shapeDrag.hold) {
    const hold=knobs[0], value=clamp(x,0,.95)*ms(knobs[1])/Math.max(.05,1-x);
    if(hold.synced) {
      hold.division=beats.slice(0,hold.last+1).reduce((best,beat,i)=>Math.abs(beat*500-value)<Math.abs(beats[best]*500-value)?i:best,0);
    } else hold.free=clamp(value,0,hold.max);
  } else if(index>=0) {
    points[index][0]=clamp(t,(points[index-1]?.[0]??0)+.005,(points[index+1]?.[0]??1)-.005);
    points[index][1]=y;
    edited=true;
  } else {
    const bend=clamp(shapeDrag.bend+(y-shapeDrag.y)*2,-1,1);
    if(left) left[2]=bend; else initialBend=bend;
    edited=true;
  }
  draw();
});
shape.addEventListener("lostpointercapture",()=>{shapeDrag=null;});
shape.addEventListener("dblclick",event=>{
  const [x,y,t]=shapePosition(event);
  if(points.length>=12 || t<=.005 || t>=.995 || nearestPoint(x,y)>=0 || points.some(([px])=>Math.abs(px-t)<.01)) return;
  points.push([t,y,0]);
  points.sort((a,b)=>a[0]-b[0]);
  edited=true;
  draw();
});
shape.addEventListener("contextmenu",event=>{
  event.preventDefault();
  const [x,y,t]=shapePosition(event);
  const index=nearestPoint(x,y);
  if(index>=0) points.splice(index,1);
  else {
    const next=points.findIndex(([px])=>px>t);
    const left=points[(next<0?points.length:next)-1];
    if(left) left[2]=0; else initialBend=0;
  }
  edited=true;
  draw();
});

for(const image of themes) image.addEventListener("load",draw);
selectPreset(0);
