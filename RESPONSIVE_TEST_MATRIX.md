# Matrice responsive FamilyCare V1.0.66

Aplicația folosește CSS responsive, nu versiuni separate pe model de telefon. Dimensiunile sunt exprimate în pixeli CSS; rezoluția fizică și densitatea ecranului sunt convertite de browser prin device pixel ratio.

## Viewporturi verificate

- Telefoane portret: 320×568, 360×640, 375×667, 390×844, 412×915, 430×932.
- Telefon landscape: 640×360, 740×360, 844×390, 915×412.
- Tablete portret: 600×960, 768×1024, 800×1280, 1024×1366.
- Tablete landscape: 960×600, 1024×768, 1280×800, 1366×1024.
- Laptop/desktop: 1280×720, 1366×768, 1440×900, 1920×1080.

## Cum confirmi pe dispozitivul real


1. Pornește modul Network pe laptop și conectează telefonul/tableta la aceeași rețea Wi-Fi.
2. Deschide adresa HTTPS afișată de script.
3. Testează portret și landscape, mărimea implicită a fontului și zoom 100%.
4. Verifică notch-ul, bara browserului, tastatura virtuală, instalarea PWA și revenirea din fundal.

Emularea confirmă layout-ul pentru viewport, dar validarea finală pe Realme și Samsung rămâne necesară pentru bara browserului, fonturile producătorului, gesturi și safe-area.
