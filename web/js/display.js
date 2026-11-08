// Hall TV display: who is called to which station, and each station's queue.
//
// Live updates: the page asks the database for the whole board every few
// seconds (one small request). Neon's realtime feed would need a server of
// our own, and for a single TV polling is simpler and just as quick to the eye.
//
// Privacy: athletes appear by full name + athlete code, never club or anything
// else (Sam's decision 2026-11-08, see HANDOFF §2).
// All text goes in via textContent, never innerHTML.
//
// URL options:
//   ?event=<id>  show this event instead of the live one
//   ?demo        made-up data, no sign-in (to check the layout on a TV)

import * as api from "./api.js";
import { h } from "./ui.js";
import { icon } from "./icons.js";
import { demoBoard } from "./display-demo.js";

const POLL_MS = 3000;
const RETRY_MS = 5000;
const STALE_MS = 12000; // show "reconnecting" if nothing fresh for this long

const params = new URLSearchParams(location.search);
const demo = params.has("demo");
const eventId = params.get("event");

const $ = (id) => document.getElementById(id);
const els = { event: $("event-name"), clock: $("clock"), calls: $("calls"), stations: $("stations"), banner: $("banner"), chime: $("chime") };

let clockOffset = 0;          // server time minus local time, ms
let lastOk = 0;
let seenCalls = null;         // keys of calls already shown (null until first load)

// ---- Clock ---------------------------------------------------------------
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Malta" });
function tick() {
  const now = new Date(Date.now() + clockOffset);
  els.clock.textContent = timeFmt.format(now);
  els.clock.dateTime = now.toISOString();
  if (!demo && lastOk && Date.now() - lastOk > STALE_MS) banner("Reconnecting… the screen will update when the connection is back.");
}
setInterval(tick, 1000);
tick();

function banner(text) {
  els.banner.textContent = text ?? "";
  els.banner.hidden = !text;
}

// ---- Chime ---------------------------------------------------------------
// Browsers only allow sound after someone clicks the page once. In kiosk mode
// Chrome can be started with --autoplay-policy=no-user-gesture-required.
let audio = null;
function initAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
  } catch { audio = null; }
  updateChimeButton();
}
function updateChimeButton() {
  els.chime.hidden = Boolean(audio && audio.state === "running");
}
els.chime.addEventListener("click", () => { initAudio(); setTimeout(updateChimeButton, 300); chime(); });
initAudio();
setTimeout(updateChimeButton, 500);

function chime() {
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime;
  for (const [i, freq] of [659.25, 880].entries()) {      // two soft rising notes
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t + i * 0.28;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 1);
  }
}

// ---- Hide the mouse pointer when it isn't moving --------------------------
let idleTimer;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 3000);
});

// ---- Drawing ---------------------------------------------------------------
function dot(st) {
  const d = h("span", { class: "dot" }, icon(st?.icon));
  d.style.setProperty("--c", st?.colour ?? "#1f6feb");
  return d;
}

function fullName(person) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

function render(board) {
  const stations = board.stations ?? [];
  const byId = new Map(stations.map((s) => [s.id, s]));

  els.event.textContent = board.event ? board.event.name : "Healthy Athletes";
  document.title = board.event ? `${board.event.name} · Call-up display` : "Call-up display";

  // Calling now
  const calls = board.calls ?? [];
  const keys = calls.map((c) => `${c.athlete_code}|${c.station_id}|${c.called_at}`);
  const fresh = seenCalls ? keys.filter((k) => !seenCalls.has(k)) : [];
  els.calls.replaceChildren(...(calls.length
    ? calls.map((c, i) => {
        const st = byId.get(c.station_id);
        return h("li", { class: `call${i === 0 ? " first" : ""}${fresh.includes(keys[i]) ? " new" : ""}` },
          dot(st),
          h("div", { class: "who" },
            h("div", { class: "name" }, fullName(c)),
            h("div", { class: "where" }, h("span", { class: "code" }, c.athlete_code), st ? ` · Go to ${st.name}` : "")));
      })
    : [h("li", { class: "empty" }, board.event ? "Nobody is being called right now." : "")]));
  if (fresh.length) chime();
  seenCalls = new Set(keys);

  // Stations
  els.stations.classList.toggle("dense", stations.length > 8);
  els.stations.replaceChildren(...(stations.length
    ? stations.map((s) => h("li", { class: "station" },
        dot(s),
        h("div", { class: "title" },
          h("div", { class: "sname" }, s.name),
          s.subtitle ? h("div", { class: "sub" }, s.subtitle) : null),
        h("div", { class: "stat next" },
          h("div", { class: "label" }, "Next"),
          h("div", { class: "value" }, s.next ? fullName(s.next) : h("span", { class: "none" }, "—")),
          s.next ? h("div", { class: "code" }, s.next.athlete_code) : null),
        h("div", { class: "stat queue" },
          h("div", { class: "label" }, "In queue"),
          h("div", { class: "value" }, String(s.queued))),
        h("div", { class: "stat wait" },
          h("div", { class: "label" }, "Wait"),
          h("div", { class: "value" }, s.wait_minutes == null ? h("span", { class: "none" }, "—") : `~${s.wait_minutes} min`))))
    : [h("li", { class: "empty" }, board.event
        ? "This event has no active stations yet."
        : "No event is live. An organiser can set an event to Live on the Events page.")]));
}

// ---- Polling ---------------------------------------------------------------
async function load() {
  try {
    const board = demo ? demoBoard() : await api.displayBoard(eventId);
    if (board.now) clockOffset = new Date(board.now).getTime() - Date.now();
    lastOk = Date.now();
    banner("");
    render(board);
    setTimeout(load, POLL_MS);
  } catch (e) {
    // Signed out, account switched off or session revoked: back to sign-in.
    let signedOut = false;
    try { signedOut = (await api.currentStaff()) === null; } catch { /* network down: keep retrying */ }
    if (signedOut) {
      location.replace("../index.html");
      return;
    }
    banner("Reconnecting… the screen will update when the connection is back.");
    setTimeout(load, RETRY_MS);
  }
}

if (!demo && !api.configured) {
  banner("Not connected to a database (see web/config.js).");
} else {
  load();
}
