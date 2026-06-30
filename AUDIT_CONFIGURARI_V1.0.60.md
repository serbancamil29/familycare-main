# Audit Configurări FamilyCare V1.0.66

## Concluzie

Navigarea a fost simplificată în patru grupe: Familie și structură, Persoane și colaboratori, Notificări și automatizări, Personalizare și sistem. Cheile și datele existente nu au fost schimbate.

## Ce este funcțional în restul aplicației

- `Contact familie` este citit de ecranul Senior pentru apeluri, SMS și ajutor.
- `Culori Senior` este citit de API-ul seniorilor și schimbă efectiv cardurile.
- `Email expeditor` este citit de modulul SMTP actual, cu limita Gmail descrisă în README.

## Ce este încă registru generic / prototip

Următoarele secțiuni salvează înregistrări JSON în `config_record`, dar nu actualizează automat tabelele principale sau toate funcțiile aplicației: Care Header, Ramificații, Entități urmărite, Tipuri entitate, Arbore genealogic, Utilizatori, Medici, Furnizori, Tipuri task, Reguli alerte, Canale notificare, Mail Center, Planuri abonament și Informații.

De exemplu, modificarea unei „Ramificații” în această pagină nu modifică automat `care_branch`, iar modificarea unei „Entități urmărite” nu modifică automat `managed_entity`. Aceste secțiuni nu trebuie prezentate publicului ca administrare complet funcțională până când CRUD-ul este legat de tabelele reale.

## Organizare recomandată pentru versiunea publică

1. `Configurări`: Personalizare, Notificări, Integrări, Securitate și Preferințe.
2. `Administrare`: Care Header, Ramificații, Entități și Utilizatori, cu permisiuni.
3. `Directoare`: Medici și Furnizori.
4. `Familie`: Arbore genealogic și Contacte.
5. `Comunicare`: într-un singur modul cu subsecțiuni pentru Reguli alerte, Canale, Expeditor și Istoric mesaje.
6. `Mail Center` trebuie mutat din Configurări într-o zonă operațională; `Planuri abonament` trebuie văzut doar de administrator.

## Priorități

- P0: autentificare Main, roluri și permisiuni; CRUD real pentru ramificații și entități; Google OAuth; criptarea tokenurilor și secretelor.
- P1: motor real pentru reguli de alertă și canale; audit al modificărilor; validări și unicitate.
- P2: directoare Medici/Furnizori, abonamente și arbore genealogic complet.
