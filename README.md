# على فين؟ | ALA FEEN?

Admin Dashboard and REST API for the ALA FEEN? Egyptian transportation platform.

## Stack

- Node.js + Express
- Firebase / Firestore (Admin SDK, server-side only)
- JWT (HttpOnly cookie)
- Cloudinary (uploads)
- Vanilla HTML/CSS/JS frontend
- Vercel-ready

## Project structure

```
public/
  login.html
  dashboard.html
  css/login.css
  css/dashboard.css
  js/login.js
  js/dashboard.js
  assets/logo.png
server.js
package.json
vercel.json
.env
README.md
```

## Installation

```
npm install
```

## Environment

Copy `.env.example` to `.env` and fill the values.

Generate a password hash:

```
npm run hash-password -- "your-strong-password"
```

Paste the output into `ADMIN_PASSWORD_HASH`.

## Firebase setup

1. Create a Firebase project.
2. Enable Firestore in production mode.
3. Project Settings -> Service Accounts -> Generate new private key.
4. Copy `project_id`, `client_email`, `private_key` into `.env`.
5. `FIREBASE_PRIVATE_KEY` must keep its `\n` sequences; wrap it in double quotes.

### Firestore collections

```
users
routes
stations
transportTypes
fares
complaints
suggestions
reports
governorates
cities
areas
syncMetadata
adminLogs
```

### Recommended indexes

- complaints: `status ASC, createdAt DESC`
- complaints: `priority ASC, createdAt DESC`
- complaints: `status ASC, priority ASC, createdAt DESC`
- routes: `active ASC, updatedAt DESC`
- stations: `governorate ASC, active ASC`
- adminLogs: `timestamp DESC`

## Cloudinary setup

1. Create a Cloudinary account.
2. Copy cloud name, API key, API secret into `.env`.
3. Optionally set `CLOUDINARY_FOLDER`.

## Local development

```
npm run dev
```

Open `http://localhost:3000/login`.

## Vercel deployment

1. Push the repo to GitHub.
2. Import into Vercel.
3. Add all `.env` values as Environment Variables.
4. Deploy.

## Admin login

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` in `.env`.

Only the hash is stored. The plain password is never saved anywhere.

## API endpoints

Auth:
- POST   /api/auth/login
- POST   /api/auth/logout
- GET    /api/auth/me

Dashboard:
- GET    /api/dashboard/stats

Routes:
- GET    /api/routes
- POST   /api/routes
- GET    /api/routes/:id
- PUT    /api/routes/:id
- DELETE /api/routes/:id

Stations:
- GET    /api/stations
- POST   /api/stations
- GET    /api/stations/:id
- PUT    /api/stations/:id
- DELETE /api/stations/:id

Transport types:
- GET    /api/transport-types
- POST   /api/transport-types
- PUT    /api/transport-types/:id
- DELETE /api/transport-types/:id

Fares:
- GET    /api/fares
- POST   /api/fares
- PUT    /api/fares/:id
- DELETE /api/fares/:id

Complaints:
- GET    /api/complaints
- GET    /api/complaints/:id
- PUT    /api/complaints/:id
- DELETE /api/complaints/:id
- POST   /api/complaints/:id/confirm

Suggestions:
- GET    /api/suggestions
- POST   /api/suggestions
- PUT    /api/suggestions/:id

Users:
- GET    /api/users
- GET    /api/users/:id

Reports:
- GET    /api/reports

Geography:
- GET    /api/governorates
- GET    /api/cities
- GET    /api/areas

Upload:
- POST   /api/upload

Search:
- GET    /api/search

Logs:
- GET    /api/admin-logs

Sync:
- GET    /api/sync/metadata
- POST   /api/sync/ack