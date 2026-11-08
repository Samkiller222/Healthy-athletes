import * as api from "../api.js";
import { parseCsv, validate, COLUMNS } from "../csv.js";
import { h, say, busy, confirmTyped, organiserPage } from "../ui.js";

const app = document.getElementById("app");
const PAGE = 50;
let search = "";
let offset = 0;

const BAND = { under_18: "Under 18", "18_plus": "18+" };

function importPanel() {
  const file = h("input", { type: "file", accept: ".csv,text/csv" });
  const preview = h("div");
  file.addEventListener("change", async () => {
    preview.replaceChildren();
    const f = file.files[0];
    if (!f) return;
    if (f.size > 1_000_000) return say("That file is too large for an athlete list (over 1 MB).", "error");
    let result;
    try {
      result = validate(parseCsv(await f.text()));
    } catch (e) {
      return say(e.message, "error");
    }
    file.value = ""; // the file itself is never kept or uploaded
    if (result.fileError) return say(result.fileError, "error");
    say("");
    const go = h("button", {
      disabled: result.errors.length > 0 || result.rows.length === 0,
      onclick: () => busy(go, async () => {
        const r = await api.importAthletes(result.rows.map((x) => x.data));
        preview.replaceChildren();
        say(`Imported ${r.inserted} athlete(s).` + (r.skipped ? ` Skipped ${r.skipped} already on the list.` : ""), "ok");
        offset = 0;
        await renderList();
      }),
    }, `Import ${result.rows.length} athlete(s)`);
    preview.replaceChildren(
      result.errors.length
        ? h("div", { class: "status error" },
            `${result.errors.length} row(s) need fixing in the spreadsheet before anything can be imported:`,
            h("ul", { class: "errors" }, result.errors.slice(0, 50).map((e) => h("li", {}, `Line ${e.line}: ${e.message}`))))
        : h("p", {}, `${result.rows.length} athlete(s) ready. First rows:`),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Line", "First name", "Last name", "Club", "Age band", "Code"].map((t) => h("th", {}, t)))),
        h("tbody", {}, result.rows.slice(0, 10).map(({ line, data }) => h("tr", {},
          h("td", {}, line), h("td", {}, data.first_name), h("td", {}, data.last_name), h("td", {}, data.club ?? ""),
          h("td", {}, BAND[data.age_band] ?? ""), h("td", {}, data.code || "(new)")))))),
      h("p", { class: "row" }, go, h("button", { class: "secondary", onclick: () => preview.replaceChildren() }, "Cancel")));
  });

  const sample = "first_name,last_name,club,age_band,code\nAlex,Example,Example Club,18_plus,\n";
  const template = h("a", {
    href: "data:text/csv;charset=utf-8," + encodeURIComponent(sample),
    download: "athletes-template.csv",
  }, "Download a blank template");

  return h("section", { class: "panel" },
    h("h2", {}, "Import athletes from a CSV file"),
    h("p", { class: "notice" }, "Do not enter health information in this system. Files with any other columns are refused."),
    h("p", { class: "muted" }, `Allowed columns: ${COLUMNS.join(", ")}. Only first_name and last_name are required. `,
      "Leave code empty and one is created (HA-0001, HA-0002, …). age_band is under_18, 18_plus or empty. ", template, "."),
    h("label", {}, "CSV file", file),
    preview);
}

const listBox = h("section", { class: "panel" });

async function renderList() {
  const { rows, total } = await api.listAthletes({ search, offset, limit: PAGE });
  const q = h("input", { type: "search", value: search, placeholder: "Search name or code", "aria-label": "Search athletes" });
  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { search = q.value; offset = 0; renderList().then(() => listBox.querySelector("input")?.focus()); }, 300);
  });
  const body = rows.map((a) => {
    const del = h("button", {
      class: "danger",
      onclick: () => {
        if (!confirm(`Remove ${a.first_name} ${a.last_name} (${a.code}) and their queue history?`)) return;
        busy(del, async () => { await api.deleteAthlete(a.id); await renderList(); });
      },
    }, "Remove");
    return h("tr", {},
      h("td", { class: "nowrap" }, a.code), h("td", {}, a.first_name), h("td", {}, a.last_name),
      h("td", { class: "hide-sm" }, a.clubs?.name ?? ""), h("td", { class: "hide-sm" }, BAND[a.age_band] ?? ""),
      h("td", { class: "actions" }, del));
  });
  const prev = h("button", { class: "secondary", disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - PAGE); renderList(); } }, "Previous");
  const next = h("button", { class: "secondary", disabled: offset + PAGE >= total, onclick: () => { offset += PAGE; renderList(); } }, "Next");
  listBox.replaceChildren(
    h("div", { class: "row" }, h("h2", {}, `Athletes (${total})`), h("span", { class: "spacer" }), q),
    rows.length
      ? h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Code"), h("th", {}, "First name"), h("th", {}, "Last name"), h("th", { class: "hide-sm" }, "Club"), h("th", { class: "hide-sm" }, "Age band"), h("th", {}))),
          h("tbody", {}, body)))
      : h("p", { class: "muted" }, search ? "No athletes match." : "No athletes yet."),
    total > PAGE ? h("p", { class: "row" }, prev, h("span", { class: "muted" }, `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`), next) : "");
}

function deletePanel() {
  const btn = h("button", {
    class: "danger",
    onclick: () => {
      if (!confirmTyped("Delete EVERY athlete, with all their check-ins and queue history? Clubs, events and stations stay. This cannot be undone.", "DELETE ALL")) return;
      busy(btn, async () => { await api.deleteAllAthletes(); offset = 0; search = ""; say("All athletes deleted.", "ok"); await renderList(); });
    },
  }, "Delete all athletes");
  return h("section", { class: "panel" },
    h("h2", {}, "After the event: delete athlete data"),
    h("p", { class: "muted" }, "Names are personal data. Once an event's numbers are no longer needed, delete the athlete list."),
    btn);
}

if (await organiserPage("athletes.html")) {
  app.replaceChildren(h("h1", {}, "Athletes"), importPanel(), listBox, deletePanel());
  renderList().catch((e) => say(e.message, "error"));
}
