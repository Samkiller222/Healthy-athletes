# Healthy Athletes — Call & Management System: Handoff

**Owner:** Sam Micallef (Special Olympics Malta)
**Status:** Not started — this document is the brief. The repo is empty.
**Last updated:** 2026-11-08

---

## 1. What this is

A small web app to run **Special Olympics Malta Healthy Athletes** screening events:

1. **Outreach ("calls")** — a call list for contacting athletes or their guardians to invite them, confirm attendance and log the outcome.
2. **Event-day management** — check athletes in, queue them for each screening station (discipline), call them up when a station is free, and track which stations each athlete has been through.
3. **Overview** — live counts for organisers and a post-event summary of attendance and throughput.

### The one rule that shapes everything

> **This system never records medical or health data.**
> It tracks *logistics only*: who was invited, who came, which station they are queued at, and whether they have *been through* a station. Screening results, findings, referrals, diagnoses, medications and notes from clinicians stay with the clinicians, on paper or in Special Olympics' own systems, never here.

Keeping health data out keeps this app out of GDPR's "special category" (Article 9) regime, which would otherwise require a full DPIA, encryption at field level, medical-grade access controls and a lot more. If a future feature needs health data, **stop** and treat it as a separate project with its own DPIA.

---

## 2. Data boundary

### Allowed

| Data | Why | Notes |
|---|---|---|
| Athlete first name + last name | Identification at check-in | Display screens show **first name + athlete code only** |
| Athlete code (e.g. `HA-0142`) | Queue display, QR wristband | Generated, not meaningful |
| Club / delegation | Grouping and outreach | |
| Guardian / contact name, phone, preferred language | Outreach calls | Phone visible to callers only |
| Event, station (discipline) names | Structure | e.g. Opening Eyes, Special Smiles, Healthy Hearing, Fit Feet, FUNfitness, MedFest, Health Promotion, Strong Minds |
| Invitation / call outcomes | Outreach tracking | Fixed choices only (see §4) |
| Queue status per station | Event-day flow | `queued → called → in_station → done` or `skipped` |
| Timestamps | Throughput stats | |
| Staff accounts and roles | Access control | |

### Not allowed — never build a field for these

- Screening results, measurements or scores of any kind (vision, hearing, dental, BMI, blood pressure, etc.)
- Referrals or "needs follow-up" flags — a referral flag *is* a health finding
- Diagnoses, conditions, disabilities, medications, allergies
- Mobility or support needs that describe a condition (see open question Q2)
- Free-text notes on athletes (they will fill up with health details over time)
- File or photo uploads of any kind
- Date of birth (store an age band only if genuinely needed, e.g. `under 18` / `18+`)

### How to enforce it in code, not just in policy

- **No free-text fields on athlete, visit or call records.** Use enums and fixed choices everywhere.
- **DB check constraints** on every status column so only allowed values can be stored.
- **No file-upload endpoint or storage bucket** exists at all.
- **A schema guard test** in CI that fails if any column name matches a deny-list (`diagnos|condition|medic|result|score|referr|allerg|note|comment|dob|birth|disab`). Changing the deny-list needs a reviewed PR.
- **A short notice on the check-in screen**: "Do not enter health information in this system."

---

## 3. Users and roles

| Role | Can do |
|---|---|
| **Admin** | Create events and stations, import athletes, manage staff, export summaries, delete data |
| **Caller** | See the call list and contact numbers, log call outcomes |
| **Check-in volunteer** | Search athletes, check them in, print or assign wristband codes |
| **Station lead** | See their station's queue, call next, mark `in_station` / `done` / `skipped` |
| **Display** | Read-only TV screen per station: athlete code + first name of who is called next |

Every staff member logs in with their own account (no shared logins) with MFA for Admin. Volunteers' access is removed after each event.

---

## 4. Features

### 4.1 Outreach (calls)
- Call list per event, filterable by club and status.
- One-tap phone link on mobile.
- A short call script shown alongside each entry (editable by Admin, per language: Maltese / English).
- Outcome buttons only: `no_answer`, `call_back`, `confirmed`, `declined`, `wrong_number`.
- Attempt count and last-called time; "call back" items float to the top.

### 4.2 Event-day check-in
- Search by name or code; mark arrived.
- Assign or print a QR wristband with the athlete code.
- Choose which stations the athlete will visit (default: all).

### 4.3 Station queues ("call-up")
- Each station has a queue ordered by check-in time, with a manual reorder for support-person or group needs.
- Station lead taps **Call next** → athlete shows on that station's display screen.
- Statuses: `queued → called → in_station → done`, plus `skipped` (with a fixed reason: `not_present`, `declined`, `time_ran_out`).
- Scanning the wristband at a station jumps that athlete to `in_station`.
- An athlete can't be `called` at two stations at once.

### 4.4 Athlete "passport" view
- Digital version of the paper passport: which stations are `done`, which are pending. **Ticks only, never results.**
- Volunteers use it to route athletes to the shortest queue next.

### 4.5 Organiser dashboard
- Live: checked-in count, queue length and average wait per station, stations completed per athlete.
- After the event: attendance vs invited, completions per station, throughput per hour. CSV export of these **aggregates** (no per-athlete export by default).

---

## 5. Suggested stack

Not fixed — choose what you're comfortable maintaining.

- **Frontend:** static site (plain HTML/JS or a light framework), hostable on GitHub Pages. Must work well on phones and tablets.
- **Backend:** Supabase in an **EU region**, using Postgres row-level security (RLS) for the roles above and Supabase Auth for staff logins. Realtime subscriptions for the queue and display screens.
- **No home-server hosting** for anything with real athlete or guardian contact data.

---

## 6. Data model (draft)

```
events          (id, name, date, venue, status)
stations        (id, event_id, name, display_order, active)
clubs           (id, name)
athletes        (id, code, first_name, last_name, club_id, age_band, created_at)
contacts        (id, athlete_id, name, phone, language)
invitations     (id, event_id, athlete_id, status, attempts, last_called_at, called_by)
checkins        (id, event_id, athlete_id, checked_in_at, checked_in_by)
station_visits  (id, event_id, station_id, athlete_id,
                 status CHECK (status IN ('queued','called','in_station','done','skipped')),
                 skip_reason CHECK (skip_reason IN ('not_present','declined','time_ran_out')),
                 queued_at, called_at, started_at, finished_at, updated_by)
staff           (id, auth_user_id, name, role)
audit_log       (id, staff_id, action, table_name, row_id, at)
```

Note what is **absent**: no `notes`, `results`, `referral` or `health` columns anywhere.

---

## 7. Privacy and security — still required

No health data does **not** mean no personal data. Names and guardians' phone numbers of people with intellectual disabilities still need care under GDPR.

- [ ] Lawful basis agreed with SO Malta (likely legitimate interest or consent collected at registration); privacy notice in easy-read form.
- [ ] Data processing agreement with the hosting provider (Supabase DPA).
- [ ] RLS on every table; the anon key can read nothing.
- [ ] HTTPS only; no personal data in URLs, logs or analytics.
- [ ] Display screens show **first name + code only**.
- [ ] Audit log of check-ins, status changes, exports and deletions.
- [ ] **Retention:** event-day records deleted or anonymised *N* days after the event (decide N with SO Malta); aggregates kept.
- [ ] Breach contact and procedure written down (IDPC must be notified within 72 hours).
- [ ] **This repo is public.** Never commit real names, phone numbers, CSV imports, `.env` files or keys. Seed data must be fake.

---

## 8. Build order

1. **Schema + RLS + schema guard test** (the deny-list check from §2).
2. **Admin:** events, stations, athlete CSV import (with validation that rejects unknown columns).
3. **Station queue + display screen** — the core event-day loop.
4. **Check-in + wristband codes.**
5. **Outreach call list.**
6. **Passport view + dashboard.**
7. Retention job, exports, accessibility pass (large text, high contrast, simple language).
8. Dry run at a small session before a full Healthy Athletes event.

---

## 9. Open questions for Sam

- **Q1.** Does "call" mean phone outreach, event-day call-up, or both? This brief assumes **both**.
- **Q2.** Support needs: is a neutral logistics field like "comes with a support person (name)" acceptable, or should all of that stay verbal/paper? Default here: **excluded**.
- **Q3.** Retention period after each event?
- **Q4.** Does SO Malta (or Special Olympics International's Healthy Athletes programme) already require a particular system or data format for event logistics?
- **Q5.** Which stations run at the first event, and roughly how many athletes?
- **Q6.** Languages needed for scripts and display screens (Maltese, English, others)?

---

## 10. Definition of done (v1)

- An admin can set up an event with stations and import athletes.
- Callers can work through the call list and log outcomes.
- On event day, athletes are checked in, queued, called up on screens and marked through each station.
- Organisers see live and post-event numbers.
- The schema guard test passes and there is **no way to enter health information** anywhere in the app.
