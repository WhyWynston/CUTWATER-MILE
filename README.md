# CUTWATER-MILE

An attendance race for our three project advisors: **Ethelyn**, **Alok** and **Jaansi**.

Every work session, an advisor takes a photo with **Miguel** or **Frida** and uploads it.
Once Miguel or Frida approves the photo, it counts. That rule is there to stop AI-generated
or reused photos. The advisor with the most approved sessions leads the track, and everyone
else is placed behind in proportion. Whoever has the fewest sessions when the semester ends
in December runs the **milk mile**. 🥛

## Running it

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
APPROVER_PASSWORD='pick-something' npm start   # http://localhost:3000
npm test
```

### Configuration (environment variables)

| Variable            | Default   | What it does                                                                    |
| ------------------- | --------- | ------------------------------------------------------------------------------- |
| `APPROVER_PASSWORD` | _(unset)_ | Password Miguel and Frida use to log in and approve. Approval is off until set. |
| `SESSION_SECRET`    | random    | Signs approver logins. Set it so logins survive server restarts.                |
| `PORT`              | `3000`    | HTTP port                                                                       |
| `DATA_DIR`          | `./data`  | Where the SQLite database (`attendance.db`) and `uploads/` live                 |
| `TRUST_PROXY`       | _(unset)_ | Set to `1` behind a hosting proxy (Railway, Render, Fly) so cookies are Secure  |

Back up `DATA_DIR`. It holds all attendance records and photos.

## How it works

- **Advisors don't log in.** Anyone with the link can submit a check-in. It shows as
  "Waiting for Miguel/Frida" and doesn't count yet.
- **Miguel and Frida log in** with the approver password at the bottom of the page. A
  "Waiting for approval" list then appears at the top, where they approve or reject each
  photo. Rejecting deletes the check-in so the advisor can resubmit.
- **One check-in per advisor per date.** A group photo can check in several advisors at
  once. If any of them already has a check-in for that date, the whole upload is refused.
- **Standings** count approved sessions only. "Sessions held" is the number of dates with
  at least one approved check-in, and attendance % is measured against it.
- **Milk mile:** once someone has pulled ahead, everyone tied for the fewest sessions is
  flagged 🥛.
- Approver logins are signed, HttpOnly, SameSite=Strict cookies that last 30 days. Five wrong
  passwords from one address lock login for 15 minutes.

## API

| Method   | Path                          | Auth     | Notes                                                                                     |
| -------- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `GET`    | `/api/config`                 |          | Advisors, approvers, and who is logged in                                                 |
| `GET`    | `/api/standings`              |          | Approved sessions, attendance %, track position, milk-mile flag; plus sessions held       |
| `GET`    | `/api/checkins`               |          | `?advisor=<id>` and `?status=pending\|approved` are optional filters                     |
| `POST`   | `/api/checkins`               |          | `multipart/form-data`: `photo`, `advisors` (repeatable id), `witness`, `sessionDate`      |
| `POST`   | `/api/approver/login`         |          | JSON `{ name: "Miguel" \| "Frida", password }`                                            |
| `POST`   | `/api/approver/logout`        |          |                                                                                           |
| `POST`   | `/api/checkins/:id/approve`   | approver |                                                                                           |
| `DELETE` | `/api/checkins/:id`           | approver | Reject a pending check-in or remove an approved one                                       |

## Layout

```
server.js         entry point (reads env, opens DB, starts server)
src/db.js         SQLite schema, seed data and queries
src/auth.js       approver password login (signed cookies, rate limiting)
src/app.js        Express app: API, uploads, static files
public/           frontend (racetrack, standings, approval queue, check-in form, photo feed)
test/             API tests (node:test)
```

A claude.ai-hosted version of the same app exists too. It uses claude.ai sharing roles
(Editor = approver) instead of a password.
