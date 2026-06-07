# SerwisCiepło — Portal Klienta

PWA dla klientów serwisu kotłów grzewczych. Klienci mogą sprawdzać historię serwisów, śledzić datę przeglądu i zgłaszać zapotrzebowanie na wizytę.

**URL produkcyjny:** https://portal.serwiscieplo.pl  
**Supabase projekt:** `dzekzfxhqxiifuaesjum`  
**Główna apka serwisanta:** https://serwiscieplo.pl

---

## Szybki start (lokalne uruchomienie)

```bash
# Przeglądarka — otwórz bezpośrednio
# Lub przez prosty serwer (wymagany do PWA/SW):
npx serve .
# Otwórz http://localhost:3000
```

---

## Wdrożenie

### 1. SQL Migration (jednorazowo)

Uruchom `migrations/001_portal_schema.sql` w Supabase SQL Editor:  
https://supabase.com/dashboard/project/dzekzfxhqxiifuaesjum/sql

### 2. Edge Functions

```bash
# Zainstaluj Supabase CLI (jeśli nie masz)
npm install -g supabase

# Zlinkuj projekt
npx supabase link --project-ref dzekzfxhqxiifuaesjum

# Ustaw sekrety
npx supabase secrets set RESEND_API_KEY=re_twoj_klucz
# SUPABASE_SERVICE_ROLE_KEY i SUPABASE_URL są automatycznie dostępne

# Wdróż funkcje
npx supabase functions deploy send-portal-invitation
npx supabase functions deploy handle-portal-auth
npx supabase functions deploy notify-technician-new-request
```

### 3. Database Webhook

Skonfiguruj webhook dla powiadomień serwisanta — patrz `supabase/webhooks.md`.

### 4. Cloudflare Pages

1. Otwórz Cloudflare Pages → Create a project
2. Połącz repozytorium `jnowy1009/serwiscieplo-portal`
3. Ustawienia buildu:
   - Build command: *(puste)*
   - Output directory: `.`
4. Dodaj domenę: `portal.serwiscieplo.pl`

### 5. Ikony PWA

Skopiuj ikony z głównej apki:
```powershell
Copy-Item "C:\Users\nowys\Desktop\kotły\icon-192x192.png" "icon-192.png"
Copy-Item "C:\Users\nowys\Desktop\kotły\icon-512x512.png" "icon-512.png"
```

---

## Jak działa flow zaproszenia

```
Serwisant (główna apka)
  → klika "Zaproś do portalu" przy karcie klienta
  → wywołuje Edge Function send-portal-invitation
  → klient dostaje email z linkiem: portal.serwiscieplo.pl/?token=XXX

Klient
  → otwiera link, widzi formularz "Aktywuj konto" (tylko hasło)
  → portal wywołuje Edge Function handle-portal-auth
  → Edge Function tworzy konto w auth.users, łączy z klienci.portal_user_id
  → portal loguje klienta automatycznie → Dashboard

Klient (zalogowany)
  → widzi swoją kartę kotła, historię serwisów
  → może złożyć zgłoszenie serwisowe
  → serwisant dostaje email z powiadomieniem
  → serwisant zmienia status w głównej apce
  → portal klienta aktualizuje się przez Supabase Realtime
```

---

## Struktura projektu

```
serwiscieplo-portal/
├── index.html                    ← Cały frontend (routing hash-based, vanilla JS)
├── sw.js                         ← Service Worker (PWA)
├── manifest.json                 ← PWA Manifest
├── icon-192.png                  ← Ikona PWA (do skopiowania z kotły/)
├── icon-512.png                  ← Ikona PWA (do skopiowania z kotły/)
├── CLAUDE.md                     ← Instrukcje dla Claude Code
├── INTEGRATION.md                ← Instrukcja integracji z główną apką
├── migrations/
│   └── 001_portal_schema.sql     ← SQL: nowe tabele, kolumny, RLS
└── supabase/
    ├── webhooks.md               ← Konfiguracja Database Webhooks
    └── functions/
        ├── send-portal-invitation/index.ts    ← Wysyłanie zaproszenia (Resend)
        ├── handle-portal-auth/index.ts        ← Aktywacja konta przez token
        └── notify-technician-new-request/index.ts ← Email do serwisanta
```

---

## Konfiguracja kontaktu serwisanta

W `index.html` (linia ~20 skryptu) zaktualizuj stałe:

```js
const SERWISANT_PHONE = '+48 600 000 000';
const SERWISANT_EMAIL = 'serwis@serwiscieplo.pl';
const SERWISANT_NAME  = 'SerwisCiepło';
const SERWISANT_HOURS = 'Pn – Pt, 8:00–16:00';
```
