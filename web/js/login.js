// Sign-in, with authenticator-app (TOTP) MFA for organisers.
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

function codeInput() {
  return h("input", {
    inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}",
    maxlength: "6", required: true, placeholder: "123456",
  });
}

function mfaChallenge(factorId) {
  const code = codeInput();
  const btn = h("button", { type: "submit" }, "Verify");
  show(h("h2", {}, "Enter your 6-digit code"),
    h("p", { class: "muted" }, "Open your authenticator app and type the current code for Healthy Athletes."),
    h("form", {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => { await api.mfaVerify(factorId, code.value.trim()); await route(); });
      },
    }, h("label", {}, "Code", code), btn),
    signOutButton());
  code.focus();
}

async function mfaSetup() {
  const { factorId, qrSvg, secret } = await api.mfaEnrol();
  const code = codeInput();
  const btn = h("button", { type: "submit" }, "Turn on two-step sign-in");
  show(h("h2", {}, "Set up two-step sign-in"),
    h("p", {}, "Organiser accounts need an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password)."),
    h("ol", {},
      h("li", {}, "Scan this QR code with the app."),
      h("li", {}, "Type the 6-digit code it shows.")),
    h("div", { class: "qr" }, h("img", { src: qrSvg, alt: "QR code for your authenticator app" })),
    h("p", { class: "muted" }, "Can't scan? Enter this key instead: ", h("code", { class: "secret" }, secret)),
    h("form", {
      class: "stack",
      onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => { await api.mfaVerify(factorId, code.value.trim()); await route(); });
      },
    }, h("label", {}, "Code", code), btn),
    signOutButton());
  code.focus();
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
  if (staff.role === "organiser") {
    const mfa = await api.mfaStatus();
    if (mfa.level === "aal2") return location.assign("organiser/events.html");
    if (mfa.factorId) return mfaChallenge(mfa.factorId);
    return mfaSetup();
  }
  // Reception, station and display screens arrive in later build steps.
  show(h("h2", {}, `Signed in as ${staff.name}`),
    h("p", {}, `Role: ${ROLE_LABEL[staff.role] ?? staff.role}.`),
    h("p", { class: "muted" }, "Your screen is not built yet."),
    signOutButton());
}

if (!api.configured) {
  show(h("h2", {}, "Not connected"),
    h("p", {}, "Set SUPABASE_URL and SUPABASE_ANON_KEY in web/config.js."));
} else {
  route().catch((e) => { say(e.message, "error"); signInForm(); });
}
