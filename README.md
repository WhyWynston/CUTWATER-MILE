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
npm start          # http://localhost:3000
npm test
```

### Hosting on Railway (about 5 minutes)

1. Go to https://railway.com, sign in with GitHub, then **New Project → Deploy from GitHub repo**
   and pick `cutwater-mile`.
2. In the service's **Settings → Source**, set the branch to deploy.
3. Right-click the service → **Attach volume**, mount path `/data`. Without this, every
   redeploy wipes the attendance records and photos.
4. **Variables → New variable:** `SESSION_SECRET` = any long random string.
5. **Settings → Networking → Generate domain.** That URL is the app.

The repo's `Dockerfile` and `railway.json` handle the build, `DATA_DIR=/data`, and the port.

### Configuration (environment variables)

| Variable            | Default   | What it does                                                                    |
| ------------------- | --------- | ------------------------------------------------------------------------------- |
| `PASSWORDS`         | see below | `Name:password,Name:password` for everyone who logs in                          |
| `SESSION_SECRET`    | random    | Signs logins. Set it so people stay logged in across server restarts.           |
| `PORT`              | `3000`    | HTTP port                                                                       |
| `DATA_DIR`          | `./data`  | Where the SQLite database (`attendance.db`) and `uploads/` live                 |
| `TRUST_PROXY`       | _(unset)_ | Set to `1` behind a hosting proxy (Railway, Render, Fly) so cookies are Secure  |

Back up `DATA_DIR`. It holds all attendance records and photos.

### Logins

Everyone has their own password. The defaults are in `server.js`; set `PASSWORDS` to change
them. This is a small internal tool, so they're deliberately simple.

| Person  | Can                                   |
| ------- | ------------------------------------- |
| Ethelyn, Alok, Jaansi | Log sessions              |
| Miguel, Frida         | Log sessions, approve, reject and remove check-ins |

## How it works

- **Everyone logs in** in the "Log a session" panel. A new check-in shows as
  "Waiting for Miguel/Frida" and doesn't count yet.
- **Miguel and Frida** see a "Waiting for approval" list at the top of the page, where they
  approve or reject each photo. Rejecting deletes the check-in so the advisor can resubmit.
- **One check-in per advisor per date.** A group photo can check in several advisors at
  once. If any of them already has a check-in for that date, the whole upload is refused.
- **Standings** count approved sessions only. "Sessions held" is the number of dates with
  at least one approved check-in, and attendance % is measured against it.
- **Milk mile:** once someone has pulled ahead, everyone tied for the fewest sessions is
  flagged 🥛.
- Logins are signed, HttpOnly, SameSite=Strict cookies that last 30 days. Five wrong
  passwords from one address lock login for 15 minutes.
- **Character art** lives in `public/characters/`. A sprite's face becomes that advisor's
  runner token on the track and shows on their standings card. To add one, drop the PNG in
  that folder and add it to `SPRITES` at the top of `public/app.js`.

## API

| Method   | Path                          | Auth     | Notes                                                                                     |
| -------- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `GET`    | `/api/config`                 |          | Advisors, approvers, who can log in, and who is logged in                                 |
| `GET`    | `/api/standings`              |          | Approved sessions, attendance %, track position, milk-mile flag; plus sessions held       |
| `GET`    | `/api/checkins`               |          | `?advisor=<id>` and `?status=pending\|approved` are optional filters                     |
| `POST`   | `/api/checkins`               | anyone   | `multipart/form-data`: `photo`, `advisors` (repeatable id), `witness`, `sessionDate`      |
| `POST`   | `/api/login`                  |          | JSON `{ name, password }`                                                                 |
| `POST`   | `/api/logout`                 |          |                                                                                           |
| `POST`   | `/api/checkins/:id/approve`   | approver |                                                                                           |
| `DELETE` | `/api/checkins/:id`           | approver | Reject a pending check-in or remove an approved one                                       |

## Layout

```
server.js         entry point (reads env, opens DB, starts server)
src/db.js         SQLite schema, seed data and queries
src/auth.js       per-person password login (signed cookies, rate limiting)
src/app.js        Express app: API, uploads, static files
public/           frontend (racetrack, standings, approval queue, check-in form, photo feed)
public/characters pixel-art sprites for the advisors
test/             API tests (node:test)
```

A claude.ai-hosted version of the same app exists too. It uses claude.ai sharing roles
(Editor = approver) instead of a password.
