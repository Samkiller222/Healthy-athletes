import * as api from "../api.js";
import { h, say, busy, confirmTyped, fmtDate, organiserPage } from "../ui.js";

const STATUS = { planned: "Planned", live: "Live", closed: "Closed" };
const app = document.getElementById("app");

async function render() {
  const events = await api.listEvents();

  const name = h("input", { required: true, maxlength: "120", placeholder: "Healthy Athletes Spring 2027" });
  const date = h("input", { type: "date", required: true });
  const venue = h("input", { required: true, maxlength: "120", placeholder: "Cottonera Sports Complex" });
  const add = h("button", { type: "submit" }, "Create event");
  const form = h("form", {
    class: "grid",
    onsubmit: (e) => {
      e.preventDefault();
      busy(add, async () => {
        const ev = await api.createEvent({ name: name.value.trim(), date: date.value, venue: venue.value.trim() });
        location.assign(`event.html?id=${encodeURIComponent(ev.id)}`);
      });
    },
  }, h("label", {}, "Event name", name), h("label", {}, "Date", date), h("label", {}, "Venue", venue), add);

  const rows = events.map((ev) => {
    const status = h("select", {
      "aria-label": `Status of ${ev.name}`,
      onchange: () => busy(status, async () => {
        await api.updateEvent(ev.id, { status: status.value });
        say(`${ev.name} is now ${STATUS[status.value].toLowerCase()}.`, "ok");
      }),
    }, Object.entries(STATUS).map(([v, l]) => h("option", { value: v, selected: v === ev.status }, l)));
    const del = h("button", {
      class: "danger",
      onclick: () => {
        if (!confirmTyped(`Delete "${ev.name}"? This removes its stations, check-ins and queues. Athletes stay on the athlete list.`, "DELETE")) return;
        busy(del, async () => { await api.deleteEvent(ev.id); say("Event deleted.", "ok"); await render(); });
      },
    }, "Delete");
    return h("tr", {},
      h("td", {}, h("a", { href: `event.html?id=${encodeURIComponent(ev.id)}` }, ev.name)),
      h("td", {}, fmtDate(ev.date)),
      h("td", { class: "hide-sm" }, ev.venue),
      h("td", {}, status),
      h("td", { class: "actions" }, del));
  });

  app.replaceChildren(
    h("h1", {}, "Events"),
    h("section", { class: "panel" }, h("h2", {}, "New event"), form),
    h("section", { class: "panel" },
      events.length
        ? h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, h("th", {}, "Event"), h("th", {}, "Date"), h("th", { class: "hide-sm" }, "Venue"), h("th", {}, "Status"), h("th", {}))),
            h("tbody", {}, rows)))
        : h("p", { class: "muted" }, "No events yet. Create one above.")));
}

if (await organiserPage("events.html")) render().catch((e) => say(e.message, "error"));
