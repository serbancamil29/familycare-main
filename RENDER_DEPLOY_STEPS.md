# FamilyCare Main V1.0.67 Render

## Render Web Service
- Build Command: `npm install`
- Start Command: `npm start`

## Environment Variables
```text
NODE_ENV=production
DATABASE_URL=<Internal Database URL from Render PostgreSQL>
PGSCHEMA=familycare
SENIOR_BASE_URL=https://familycare-senior.onrender.com
```

## Database
Rulează `postgresql_schema.sql` o singură dată pe baza Render PostgreSQL.

## Observații
- Nu se folosesc BAT-uri pe Render.
- Serverul ascultă automat pe `process.env.PORT` și `0.0.0.0`.
- Conexiunea PostgreSQL folosește `DATABASE_URL` și librăria `pg`.
- HTTPS este oferit de Render; aplicația rulează intern HTTP, normal pentru Render.
