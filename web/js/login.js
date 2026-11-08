// Sign-in. (Two-step sign-in for organisers waits on Neon Auth supporting it.)
import * as api from "./api.js";
import { h, say, busy, ROLE_LABEL } from "./ui.js";

const view = document.getElementById("view");
const show = (...nodes) => view.replaceChildren(...nodes);

function signInForm() {
  const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true });
  const pw = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { type: "submit" }, "Sign in");
  show(h("h2", {}, "Sign in"), h("form", {
    class: "stack",
    onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        await api.signIn(email.value.trim(), pw.value);
        await route();
      });
    },
  }, h("label", {}, "Email", email), h("label", {}, "Password", pw), btn));
  email.focus();
}

function signOutButton() {
  return h("p", {}, h("button", { class: "link", onclick: async () => { await api.signOut(); signInForm(); } }, "Sign out"));
}

async function route() {
  say("");
  const staff = await api.currentStaff();
  if (!staff) {
    // Signed in but not an active staff member (or not signed in at all).
    await api.signOut();
    signInForm();
    return;
  }
  if (staff.role === "organiser") return location.assign("organiser/events.html");
  // Reception, station and display screens arrive in later build steps.
  show(h("h2", {}, `Signed in as ${staff.name}`),
    h("p", {}, `Role: ${ROLE_LABEL[staff.role] ?? staff.role}.`),
    h("p", { class: "muted" }, "Your screen is not built yet."),
    signOutButton());
}

if (!api.configured) {
  show(h("h2", {}, "Not connected"),
    h("p", {}, "Set NEON_AUTH_URL and NEON_DATA_API_URL in web/config.js."));
} else {
  route().catch((e) => { say(e.message, "error"); signInForm(); });
}
