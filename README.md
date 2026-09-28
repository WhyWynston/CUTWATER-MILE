# CUTWATER-MILE

An attendance race for our three project advisors: **Ethelyn**, **Alok** and **Jaansi**.

Every work session, an advisor takes a photo with **Miguel** or **Frida** and uploads it.
Each photo moves them one step further around the track. Whoever has the worst
attendance runs the **milk mile**. 🥛

## Running it

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm test
```

### Configuration (environment variables)

| Variable       | Default   | What it does                                                       |
| -------------- | --------- | ------------------------------------------------------------------ |
| `PORT`         | `3000`    | HTTP port                                                          |
| `DATA_DIR`     | `./data`  | Where the SQLite database (`attendance.db`) and `uploads/` live    |
| `TRACK_LENGTH` | `20`      | Number of sessions needed to cross the finish line                 |
| `ADMIN_TOKEN`  | _(unset)_ | Enables deleting check-ins; send it in the `x-admin-token` header  |

Back up `DATA_DIR`. It holds all attendance records and photos.

## How it works

- **One check-in per advisor per session date.** A group photo can check in several
  advisors at once. If any of them already has a check-in for that date, the whole
  upload is rejected and nothing is recorded.
- **Milk mile:** everyone tied for the fewest sessions is flagged 🥛.
- Photos must be images (JPEG, PNG, WebP, GIF or HEIC) up to 15 MB.

## API

| Method   | Path                         | Notes                                                                                   |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/config`                | Advisors, witnesses, track length                                                       |
| `GET`    | `/api/standings`             | Sessions, progress (0–1) and milk-mile flag per advisor                                 |
| `GET`    | `/api/checkins?advisor=<id>` | Check-in history with photo URLs (the `advisor` filter is optional)                     |
| `POST`   | `/api/checkins`              | `multipart/form-data`: `photo`, `advisors` (repeatable id), `witness`, `sessionDate` (YYYY-MM-DD) |
| `DELETE` | `/api/checkins/:id`          | Requires `x-admin-token`                                                                |

## Layout

```
server.js         entry point (reads env, opens DB, starts server)
src/db.js         SQLite schema, seed data and queries
src/app.js        Express app: API, uploads, static files
public/           frontend (racetrack, standings, check-in form, photo feed)
test/             API tests (node:test)
```
