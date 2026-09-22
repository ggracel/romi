# foqs.romi

Online Romi (prirejen remi) za 2 do 4 igralce. Prijava s foqs. računom (Supabase projekt ura-plus).

## Datoteke
- index.html, style.css, app.js, engine.js, foqs-logo.png = cela aplikacija (statična, GitHub Pages)
- engine.js = pravila igre; ISTA datoteka teče tudi na strežniku v edge funkciji "romi" (Supabase, projekt ura-plus)
- supabase/romi/index.ts + engine.js = izvorna koda edge funkcije (že objavljena)

## Objava
Aplikacija je narejena za naslov foqs.si/romi. Vsi linki so relativni, zato dela tudi na ggracel.github.io/romi.
1. Nov repo github.com/ggracel/romi, vanj skopiraj vsebino te mape (brez podmape supabase).
2. Settings > Pages > Source: Deploy from a branch, Branch: main / (root).
3. Da je na foqs.si/romi: repo ura-plus preimenuj v ggracel.github.io (Settings > General > Repository name). Domena foqs.si ostane na njem, vse obstoječe strani ostanejo na istih naslovih, vsak nov repo pa je avtomatsko na foqs.si/ime-repoja.

## Ob vsaki spremembi
V index.html dvigni ?v=N pri style.css in app.js (GitHub Pages cache), v app.js pri engine.js.

## Lokalni test brez strežnika
index.html?mock=1 (igra teče v brskalniku, 3 soigralci igrajo sami; samo za testiranje videza).
