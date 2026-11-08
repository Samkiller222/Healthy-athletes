# Healthy Athletes — Call & Management System: Handoff

**Owner:** Sam Micallef (Special Olympics Malta)
**Status:** Not started — this document is the brief.
**Last updated:** 2026-11-08

---

## 1. What this is

A small web app to run **Special Olympics Malta Healthy Athletes** screening events on the day:

1. **Reception** — check athletes in when they arrive and choose which screening stations they will visit.
2. **Call-up** — each station queues its athletes and **calls** them up when the station is free. A big **display** screen shows which athlete is called to which station.
3. **Overview** — organisers see live progress and a post-event summary of attendance and throughput.

"Call" in this system always means **calling an athlete up to a station**, not phone calls.

### The one rule that shapes everything

> **This system never records medical or health data.**
> It tracks *logistics only*: who arrived, which station they are queued at, who is called where, and whether they have *been through* a station. Screening results, findings, referrals, diagnoses, medications and clinicians' notes stay with the clinicians, on paper or in Special Olympics' own systems, never here.

Keeping health data out keeps this app out of GDPR's "special category" (Article 9) regime, which would otherwise require a full DPIA, field-level encryption, medical-grade access controls and much more. If a future feature needs health data, **stop** and treat it as a separate project with its own DPIA.

---

## 2. Data boundary

### Allowed

| Data | Why | Notes |
|---|---|---|
| Athlete first name + last name | Identification at reception | The display shows **first name + athlete code only** |
| Athlete code (e.g. `HA-0142`) | Display screen, QR wristband | Generated, not meaningful |
| Club / delegation | Grouping | |
| Event, station names | Structure | e.g. Opening Eyes, Special Smiles, Healthy Hearing, Fit Feet, FUNfitness, MedFest, Health Promotion, Strong Minds |
| Queue status per station | Call-up flow | `queued → called → in_station → done` or `skipped` |
| Timestamps | Throughput stats | |
| Staff accounts and roles | Access control | |

### Not allowed — never build a field for these

- Screening results, measurements or scores of any kind (vision, hearing, dental, BMI, blood pressure, etc.)
- Referrals or "needs follow-up" flags — a referral flag *is* a health finding
- Diagnoses, conditions, disabilities, medications, allergies
- Mobility or support needs that describe a condition (see open question Q1)
- Free-text notes on athletes (they will fill up with health details over time)
- File or photo uploads of any kind
- Date of birth (store an age band only if genuinely needed, e.g. `under 18` / `18+`)
- Guardian or athlete phone numbers / emails — not needed, since the system does no outreach

### How to enforce it in code, not just in policy

- **No free-text fields on athlete or visit records.** Use enums and fixed choices everywhere.
- **DB check constraints** on every status column so only allowed values can be stored.
- **No file-upload endpoint or storage bucket** exists at all.
- **A schema guard test** in CI that fails if any column name matches a deny-list (`diagnos|condition|medic|result|score|referr|allerg|note|comment|dob|birth|disab|phone|email`, excluding the `staff` table's login email). Changing the deny-list needs a reviewed PR.
- **A short notice on the reception and station screens**: "Do not enter health information in this system."

---

## 3. Accounts and roles

Only four kinds of account exist.

| Role | Who | Can do |
|---|---|---|
| **Organiser** | SO Malta event organisers | Create events and stations, import athletes, manage staff accounts, see the dashboard, export aggregates, delete event data. Also everything Receptionist can do. |
| **Receptionist** | Reception desk staff | Search athletes, check them in, assign wristband codes, choose which stations each athlete will visit, see the passport view, re-queue an athlete who comes back to reception |
| **Station lead** | The lead of each medical check-up area, one account per lead, tied to one station per event | See **only their station's** queue, **Call next**, mark `in_station` / `done` / `skipped` |
| **Display** | One shared, read-only account on the TV / big screen | Shows who is currently called and to which station. Cannot search, edit or see anything else |

Account rules:
- Every Organiser, Receptionist and Station lead has a **personal login** — no sharing.
- **MFA for Organisers.**
- Station-lead accounts are assigned to a station per event and deactivated after the event.
- The **Display** account is the only shared one. It is read-only at the database level (RLS), sees only the called-athlete feed (code, first name, station, called time), and its session can be revoked by an Organiser at any time. Use a long random password stored by the organiser, and keep the display device locked to the display page (kiosk mode).

---

## 4. Features

### 4.1 Reception (check-in)
- Search by name, code or club; mark **arrived**.
- Assign or print a QR wristband with the athlete code.
- Pick the stations the athlete will visit (default: all active stations). This puts them in each chosen station's queue.
- Undo check-in, and add or remove stations later.

### 4.2 Station call-up (Station lead)
- Queue for the lead's own station, ordered by check-in time. Manual reorder for group or support-person situations.
- **Call next** → the athlete appears on the Display with this station's name.
- Statuses: `queued → called → in_station → done`, plus `skipped` with a fixed reason: `not_present`, `declined`, `time_ran_out`.
- Scanning the wristband at a station moves that athlete straight to `in_station`.
- **Re-call** button if the athlete hasn't shown up; after N re-calls the lead can skip.
- An athlete can't be `called` at two stations at once; the app shows "busy at <station>" instead.

### 4.3 Display
- Full-screen page showing, for each station: **station name → athlete code + first name** currently called.
- A "recently called" strip for the last few calls.
- Large, high-contrast text, readable from across a hall; station colours/icons to help athletes who don't read.
- Optional chime on each new call.
- Updates in real time; shows a clear "reconnecting" banner if the network drops.

### 4.4 Athlete passport view (Receptionist, Organiser)
- Digital version of the paper passport: which stations are `done`, which are still pending. **Ticks only, never results.**
- Used to route athletes to the shortest queue next.

### 4.5 Organiser dashboard
- Live: checked-in count, queue length and average wait per station, stations completed per athlete.
- After the event: attendance, completions per station, throughput per hour. CSV export of these **aggregates** (no per-athlete export by default).

---

## 5. Suggested stack

Not fixed — choose what you're comfortable maintaining.

- **Frontend:** static site (plain HTML/JS or a light framework), hostable on GitHub Pages. Reception and station views must work well on tablets and phones; the Display view is built for a TV.
- **Backend:** Supabase in an **EU region**, using Postgres row-level security (RLS) for the four roles and Supabase Auth for logins. Realtime subscriptions for queues and the Display.
- **No home-server hosting** for anything with real athlete names.

---

## 6. Data model (draft)

```
events          (id, name, date, venue, status)
stations        (id, event_id, name, colour, display_order, active)
clubs           (id, name)
athletes        (id, code, first_name, last_name, club_id, age_band, created_at)
checkins        (id, event_id, athlete_id, checked_in_at, checked_in_by)
station_visits  (id, event_id, station_id, athlete_id,
                 status CHECK (status IN ('queued','called','in_station','done','skipped')),
                 skip_reason CHECK (skip_reason IN ('not_present','declined','time_ran_out')),
                 recall_count, queued_at, called_at, started_at, finished_at, updated_by)
staff           (id, auth_user_id, name,
                 role CHECK (role IN ('organiser','receptionist','station_lead','display')),
                 active)
station_leads   (event_id, station_id, staff_id)   -- which lead runs which station
audit_log       (id, staff_id, action, table_name, row_id, at)
```

Plus a **view** `display_feed` (station name, athlete code, first name, called_at) — the only thing the Display role can select.

Note what is **absent**: no `notes`, `results`, `referral`, `health`, `phone` or `email` columns on athletes.

---

## 7. Privacy and security — still required

No health data does **not** mean no personal data. Names of people with intellectual disabilities still need care under GDPR.

- [ ] Lawful basis agreed with SO Malta (likely legitimate interest, or consent collected at event registration); privacy notice in easy-read form.
- [ ] Data processing agreement with the hosting provider (Supabase DPA).
- [ ] RLS on every table; the anon key can read nothing; Display can read only `display_feed`; Station leads only their station's rows.
- [ ] HTTPS only; no personal data in URLs, logs or analytics.
- [ ] Display shows **first name + code only**, never surnames or clubs.
- [ ] Audit log of check-ins, status changes, exports and deletions.
- [ ] **Retention:** event-day records deleted or anonymised *N* days after the event (decide N with SO Malta); aggregates kept.
- [ ] Breach contact and procedure written down (IDPC must be notified within 72 hours).
- [ ] **This repo is public.** Never commit real names, CSV imports, `.env` files or keys. Seed data must be fake. Consider making the repo private.

---

## 8. Build order

1. **Schema + RLS for the four roles + schema guard test** (the deny-list check from §2).
2. **Organiser:** events, stations, staff accounts, athlete CSV import (with validation that rejects unknown columns).
3. **Station call-up + Display** — the core event-day loop.
4. **Reception check-in + wristband codes.**
5. **Passport view + dashboard.**
6. Retention job, exports, accessibility pass (large text, high contrast, simple language, station colours/icons).
7. Dry run at a small session before a full Healthy Athletes event.

---

## 9. Open questions for Sam

- **Q1.** Support needs: is a neutral logistics field like "comes with a support person (name)" acceptable, or should all of that stay verbal/paper? Default here: **excluded**.
- **Q2.** Retention period after each event?
- **Q3.** Does SO Malta (or Special Olympics International's Healthy Athletes programme) already require a particular system or data format for event logistics?
- **Q4.** Which stations run at the first event, and roughly how many athletes?
- **Q5.** Languages for the Display and station screens (Maltese, English, others)?
- **Q6.** One Display screen for the whole hall, or one per area? (The design supports either; a per-area display would just filter `display_feed` by station.)

---

## 10. Definition of done (v1)

- An Organiser can set up an event with stations, create Receptionist, Station lead and Display accounts, and import athletes.
- Receptionists check athletes in and assign their stations.
- Station leads call athletes up, and the Display shows who is called to which station in real time.
- Organisers see live and post-event numbers.
- The schema guard test passes and there is **no way to enter health information** anywhere in the app.
