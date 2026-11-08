import * as api from "../api.js";
import { h, say, busy, confirmTyped, organiserPage } from "../ui.js";
import { icon, ICON_CHOICES } from "../icons.js";

// Healthy Athletes disciplines, offered as quick-add buttons:
// [name, colour, icon, subtitle shown on the TV display].
const PRESETS = [
  ["Opening Eyes", "#1f6feb", "eye", "Vision"],
  ["Special Smiles", "#d63384", "tooth", "Dental"],
  ["Healthy Hearing", "#6f42c1", "ear", "Hearing"],
  ["Fit Feet", "#198754", "foot", "Feet and footwear"],
  ["FUNfitness", "#fd7e14", "run", "Strength and flexibility"],
  ["MedFest", "#dc3545", "stethoscope", "General check-up"],
  ["Health Promotion", "#20c997", "apple", "Healthy living"],
  ["Strong Minds", "#0b7f99", "mind", "Emotional wellbeing"],
];

function iconSelect(value, label) {
  return h("select", { "aria-label": label },
    ICON_CHOICES.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
}

const app = document.getElementById("app");
const eventId = new URLSearchParams(location.search).get("id");

async function render() {
  const [ev, stations, leads, staff] = await Promise.all([
    api.getEvent(eventId), api.listStations(eventId), api.listLeads(eventId), api.listStaff(),
  ]);
  document.title = `${ev.name} · Healthy Athletes`;
  const leadOf = new Map(leads.map((l) => [l.station_id, l.staff_id]));
  const leadAccounts = staff.filter((s) => s.role === "station_lead" && s.active);

  // Event details
  const name = h("input", { value: ev.name, required: true, maxlength: "120" });
  const date = h("input", { type: "date", value: ev.date, required: true });
  const venue = h("input", { value: ev.venue, required: true, maxlength: "120" });
  const save = h("button", { type: "submit" }, "Save");
  const details = h("form", {
    class: "grid",
    onsubmit: (e) => {
      e.preventDefault();
      busy(save, async () => {
        await api.updateEvent(eventId, { name: name.value.trim(), date: date.value, venue: venue.value.trim() });
        say("Event saved.", "ok");
        await render();
      });
    },
  }, h("label", {}, "Event name", name), h("label", {}, "Date", date), h("label", {}, "Venue", venue), save);

  // Stations
  const nextOrder = stations.reduce((m, s) => Math.max(m, s.display_order), 0) + 1;
  const sName = h("input", { required: true, maxlength: "60", placeholder: "Station name" });
  const sColour = h("input", { type: "color", value: "#1f6feb" });
  const sIcon = iconSelect("star", "Icon");
  const sSub = h("input", { maxlength: "60", placeholder: "e.g. Vision" });
  const sAdd = h("button", { type: "submit" }, "Add station");
  const addForm = h("form", {
    class: "grid",
    onsubmit: (e) => {
      e.preventDefault();
      busy(sAdd, async () => {
        await api.createStation({
          event_id: eventId, name: sName.value.trim(), colour: sColour.value,
          icon: sIcon.value, subtitle: sSub.value.trim() || null, display_order: nextOrder,
        });
        await render();
      });
    },
  }, h("label", {}, "Name", sName), h("label", {}, "Subtitle on TV (optional)", sSub),
     h("label", {}, "Icon", sIcon), h("label", {}, "Colour", sColour), sAdd);

  const existing = new Set(stations.map((s) => s.name.toLowerCase()));
  const missing = PRESETS.filter(([n]) => !existing.has(n.toLowerCase()));
  const presets = missing.length ? h("div", { class: "row" },
    h("span", { class: "muted" }, "Quick add:"),
    missing.map(([n, c, ic, sub], i) => {
      const b = h("button", {
        class: "secondary", type: "button",
        onclick: () => busy(b, async () => {
          await api.createStation({ event_id: eventId, name: n, colour: c, icon: ic, subtitle: sub, display_order: nextOrder + i });
          await render();
        }),
      }, n);
      return b;
    })) : null;

  const rows = stations.map((s, idx) => {
    const sname = h("input", { value: s.name, maxlength: "60", "aria-label": "Station name" });
    const colour = h("input", { type: "color", value: s.colour, "aria-label": `Colour of ${s.name}` });
    const sub = h("input", { value: s.subtitle ?? "", maxlength: "60", placeholder: "Subtitle", "aria-label": `Subtitle of ${s.name}` });
    const ic = iconSelect(s.icon, `Icon of ${s.name}`);
    const preview = h("span", { class: "icon-preview", style: `background:${s.colour}` }, icon(s.icon));
    const repaint = () => {
      preview.replaceChildren(icon(ic.value));
      preview.style.background = colour.value;
    };
    ic.addEventListener("change", repaint);
    colour.addEventListener("input", repaint);
    const mins = h("input", { type: "number", min: "1", max: "120", value: s.minutes_per_athlete, class: "num", "aria-label": `Minutes per athlete at ${s.name}` });
    const active = h("input", { type: "checkbox", checked: s.active, "aria-label": `${s.name} active` });
    const lead = h("select", { "aria-label": `Lead of ${s.name}` },
      h("option", { value: "" }, "— no lead —"),
      leadAccounts.map((a) => h("option", { value: a.id, selected: leadOf.get(s.id) === a.id }, a.name)));
    const saveRow = async (btn) => busy(btn, async () => {
      await api.updateStation(s.id, {
        name: sname.value.trim(), colour: colour.value, active: active.checked,
        icon: ic.value, subtitle: sub.value.trim() || null,
        minutes_per_athlete: Math.min(120, Math.max(1, parseInt(mins.value, 10) || 10)),
      });
      if ((leadOf.get(s.id) ?? "") !== lead.value) await api.setLead(eventId, s.id, lead.value || null);
      say(`${sname.value.trim()} saved.`, "ok");
      await render();
    });
    const saveBtn = h("button", { class: "secondary", onclick: () => saveRow(saveBtn) }, "Save");
    const move = (delta) => async () => {
      const other = stations[idx + delta];
      if (!other) return;
      await busy(null, async () => {
        // Renumber everything so orders are unique, then swap the two.
        const order = stations.map((x) => x.id);
        [order[idx], order[idx + delta]] = [order[idx + delta], order[idx]];
        await Promise.all(order.map((id, i) => api.updateStation(id, { display_order: i + 1 })));
        await render();
      });
    };
    const del = h("button", {
      class: "danger",
      onclick: () => {
        if (!confirmTyped(`Delete station "${s.name}"? Its queue for this event is removed too.`, "DELETE")) return;
        busy(del, async () => { await api.deleteStation(s.id); await render(); });
      },
    }, "Delete");
    return h("tr", {},
      h("td", {}, h("button", { class: "link", title: "Move up", "aria-label": `Move ${s.name} up`, disabled: idx === 0, onclick: move(-1) }, "▲"),
                 h("button", { class: "link", title: "Move down", "aria-label": `Move ${s.name} down`, disabled: idx === stations.length - 1, onclick: move(1) }, "▼")),
      h("td", {}, sname, sub),
      h("td", {}, h("div", { class: "row nowrap" }, preview, ic), colour),
      h("td", {}, mins),
      h("td", {}, active),
      h("td", {}, lead),
      h("td", { class: "actions" }, saveBtn, del));
  });

  const deactivate = h("button", {
    class: "danger",
    onclick: () => {
      const ids = [...new Set(leads.map((l) => l.staff_id))].filter((id) => leadAccounts.some((a) => a.id === id));
      if (!ids.length) return say("No active station leads are assigned to this event.", "info");
      if (!confirm(`Deactivate ${ids.length} station lead account(s) for this event? They will no longer be able to sign in.`)) return;
      busy(deactivate, async () => {
        for (const id of ids) await api.setStaffActive(id, false);
        say(`${ids.length} station lead account(s) deactivated.`, "ok");
        await render();
      });
    },
  }, "Deactivate this event's station leads");

  app.replaceChildren(
    h("p", {}, h("a", { href: "events.html" }, "← All events")),
    h("h1", {}, ev.name),
    h("p", {}, h("a", { href: `../display/index.html?event=${encodeURIComponent(ev.id)}`, target: "_blank", rel: "noopener" }, "Open the TV display for this event ↗"),
      " ", h("span", { class: "muted" }, "(the Display account shows whichever event is Live)")),
    h("section", { class: "panel" }, h("h2", {}, "Details"), details),
    h("section", { class: "panel" },
      h("h2", {}, "Stations"),
      stations.length
        ? h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, h("th", {}, "Order"), h("th", {}, "Name and TV subtitle"), h("th", {}, "Icon and colour"), h("th", { title: "Used for the wait estimate until real timings come in" }, "Min. per athlete"), h("th", {}, "Active"), h("th", {}, "Station lead"), h("th", {}))),
            h("tbody", {}, rows)))
        : h("p", { class: "muted" }, "No stations yet."),
      leadAccounts.length ? null : h("p", { class: "muted" }, "To assign leads, first create Station lead accounts on the ", h("a", { href: "staff.html" }, "Staff"), " page."),
      h("h2", { style: "margin-top:20px" }, "Add a station"), addForm, presets),
    h("section", { class: "panel" },
      h("h2", {}, "After the event"),
      h("p", { class: "muted" }, "Station lead accounts should be switched off once the event is over."),
      deactivate));
}

if (!eventId) location.replace("events.html");
else if (await organiserPage("events.html")) render().catch((e) => say(e.message, "error"));
