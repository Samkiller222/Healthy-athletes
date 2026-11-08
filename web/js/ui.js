// Small DOM helpers shared by every screen. All text goes in via textContent,
// never innerHTML, so names from the database cannot inject markup.

import * as api from "./api.js";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Show a message in the page's #status area. kind: "ok" | "error" | "info". */
export function say(text, kind = "info") {
  const box = document.getElementById("status");
  if (!box) return alert(text);
  box.textContent = text;
  box.className = `status ${kind}`;
  box.hidden = !text;
  if (kind === "ok") setTimeout(() => { if (box.textContent === text) box.hidden = true; }, 4000);
}

/** Run an async action, disabling the button and reporting errors. */
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    say(e.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

/** Ask the user to type a word before a destructive action. */
export function confirmTyped(message, word) {
  const typed = prompt(`${message}\n\nType ${word} to confirm.`);
  return typed !== null && typed.trim().toUpperCase() === word.toUpperCase();
}

export function fmtDate(d) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export const ROLE_LABEL = {
  organiser: "Organiser",
  receptionist: "Receptionist",
  station_lead: "Station lead",
  display: "Display",
};

const NAV = [
  ["events.html", "Events"],
  ["staff.html", "Staff"],
  ["athletes.html", "Athletes"],
];

/**
 * Every organiser page starts here: checks the user is an organiser signed in
 * with MFA (otherwise sends them to sign-in), then draws the header.
 */
export async function organiserPage(current) {
  const back = () => location.replace("../index.html");
  if (!api.configured) return back();
  let staff;
  try {
    staff = await api.currentStaff();
    if (!staff || staff.role !== "organiser") return back();
    const mfa = await api.mfaStatus();
    if (mfa.level !== "aal2") return back();
  } catch {
    return back();
  }
  const header = h("header", { class: "top" },
    h("a", { class: "brand", href: "events.html" }, "Healthy Athletes"),
    h("nav", {}, NAV.map(([href, label]) =>
      h("a", { href, "aria-current": href === current ? "page" : false }, label))),
    h("span", { class: "who" }, staff.name),
    h("button", { class: "link", onclick: async () => { await api.signOut(); back(); } }, "Sign out"));
  document.body.prepend(header);
  document.querySelector("main")?.removeAttribute("hidden");
  return staff;
}
