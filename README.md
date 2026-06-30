# FamilyCare Main V1.0.66 Render MOBILE MAIN FIX

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

---

# FamilyCare Main V1.0.66 Universal PWA

Aceeași aplicație este adaptată pentru desktop, laptop, tabletă și telefon.

## Pornire

- Numai pe PC: rulează `START_FAMILYCARE.bat`.
- PC + telefoane/tablete în aceeași rețea Wi-Fi: rulează `START_FAMILYCARE_NETWORK.bat`.
- Instrucțiuni Android și instalare PWA: `MOBILE_TABLET_SETUP.md`.

## Ce aduce V1.0.66

- Scurtătură `Culori carduri` în Dashboard; configurarea completă este în `Configurări > Personalizare și sistem > Culori Senior`.
- Interfață Main fluidă pentru telefon, tabletă, laptop și desktop, fără depășire orizontală.
- Tabele transformate automat în carduri etichetate pe telefon.
- Configurări grupate în patru zone logice și selector compact pe mobil.
- Configurare vizuală a culorii de fundal și a culorii textului pentru fiecare card Senior.
- Selectarea seniorului direct după nume și cod în `Configurări > Culori Senior`.
- PWA instalabilă cu iconiță și mod standalone.
- Layout universal, safe-area pentru notch și controale tactile.
- Legătura către Senior folosește automat IP-ul sau domeniul curent.
- Service worker numai pentru interfața statică; datele medicale și API-urile nu sunt păstrate offline.
- Certificat local cu SAN pentru localhost, numele PC-ului și adresele IPv4 active.
- Mod Network separat și regulă firewall opțională limitată la rețeaua Private.
- Păstrează protecțiile HTTPS și de securitate din V1.0.57.

## Limită de securitate

Modul Network este pentru o rețea Wi-Fi privată și de încredere. Main nu are încă autentificare completă multi-utilizator. Nu publica portul 31000 pe internet.

Gmail nu acceptă parola normală prin această integrare SMTP. Nu salva parola personală Google; pentru publicare, integrarea trebuie înlocuită cu Google OAuth.

Vezi `RESPONSIVE_TEST_MATRIX.md` și `AUDIT_CONFIGURARI_V1.0.66.md` pentru limitele testării și reorganizarea recomandată.


## V1.0.66
- Mobile Main navigation polished.
- Phone scroll retained.
- PWA cache updated.
- Test screens are not shown in the menu.
