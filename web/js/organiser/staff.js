import * as api from "../api.js";
import { h, say, busy, ROLE_LABEL, organiserPage } from "../ui.js";

const app = document.getElementById("app");
let me;

/** A long random password, for the shared Display account and first logins. */
function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function showPassword(who, pw) {
  say(`Password for ${who}: ${pw}  (copy it now, it will not be shown again)`, "info");
}

async function render() {
  const staff = await api.listStaff();

  const name = h("input", { required: true, maxlength: "80", placeholder: "Full name, or e.g. Hall display" });
  const email = h("input", { type: "email", required: true, maxlength: "254", autocomplete: "off" });
  const role = h("select", {}, Object.entries(ROLE_LABEL).map(([v, l]) => h("option", { value: v, selected: v === "station_lead" }, l)));
  const add = h("button", { type: "submit" }, "Create account");
  const form = h("form", {
    class: "grid",
    onsubmit: (e) => {
      e.preventDefault();
      busy(add, async () => {
        const pw = randomPassword();
        const s = await api.createStaff({ name: name.value.trim(), email: email.value.trim(), role: role.value, password: pw });
        await render();
        showPassword(`${s.name} (${s.email})`, pw);
      });
    },
  }, h("label", {}, "Name", name), h("label", {}, "Login email", email), h("label", {}, "Role", role), add);

  const rows = staff.map((s) => {
    const toggle = h("button", {
      class: s.active ? "danger" : "secondary",
      disabled: s.id === me.id,
      onclick: () => {
        if (s.active && !confirm(`Deactivate ${s.name}? They are signed out of the data straight away and cannot sign in again.`)) return;
        busy(toggle, async () => { await api.setStaffActive(s.id, !s.active); await render(); });
      },
    }, s.active ? (s.role === "display" ? "Revoke" : "Deactivate") : "Reactivate");
    const reset = s.role === "organiser" ? null : h("button", {
      class: "secondary",
      onclick: () => {
        if (!confirm(`Give ${s.name} a new password? The old one stops working.`)) return;
        busy(reset, async () => {
          const pw = randomPassword();
          await api.setStaffPassword(s.id, pw);
          showPassword(s.name, pw);
        });
      },
    }, "New password");
    return h("tr", {},
      h("td", {}, s.name),
      h("td", { class: "hide-sm" }, s.email),
      h("td", {}, ROLE_LABEL[s.role] ?? s.role),
      h("td", {}, h("span", { class: s.active ? "badge" : "badge off" }, s.active ? "Active" : "Off")),
      h("td", { class: "actions" }, reset, toggle));
  });

  app.replaceChildren(
    h("h1", {}, "Staff accounts"),
    h("section", { class: "panel" },
      h("h2", {}, "New account"),
      h("p", { class: "muted" }, "Everyone gets a personal login, except the one shared Display account for the hall TV. A random password is generated; give it to the person directly. Organisers set up an authenticator app the first time they sign in."),
      form),
    h("section", { class: "panel" },
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", { class: "hide-sm" }, "Login email"), h("th", {}, "Role"), h("th", {}, "Status"), h("th", {}))),
        h("tbody", {}, rows)))));
}

me = await organiserPage("staff.html");
if (me) render().catch((e) => say(e.message, "error"));
