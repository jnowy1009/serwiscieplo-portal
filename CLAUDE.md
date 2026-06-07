# SerwisCiepło — Portal Klienta — CLAUDE.md

## Opis aplikacji

**Portal Klienta SerwisCiepło** to PWA dla klientów (właścicieli kotłów) umożliwiająca:
- Przeglądanie historii serwisów własnego kotła i statusu przeglądu (z odliczaniem)
- Dostęp do danych technicznych obiektu
- Składanie zgłoszeń serwisowych oraz ich anulowanie i potwierdzanie terminu wizyty
- Podgląd statusu zgłoszeń na żywo (Supabase Realtime)
- Kontakt z serwisantem

URL: **portal.serwiscieplo.pl** (Cloudflare Pages)
Supabase projekt: `dzekzfxhqxiifuaesjum` (ten sam co panel technika).

---

## Stack

| Warstwa | Technologia |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — jeden plik `index.html` (bez bundlera) |
| Baza danych | Supabase (`dzekzfxhqxiifuaesjum`) — odczyt + zapis zgłoszeń serwisowych |
| Auth | Supabase Auth (email + hasło); aktywacja konta przez token (edge function) |
| Realtime | Supabase Realtime — nasłuch tabeli `service_requests` |
| PWA | Web App Manifest (`manifest.json`); `sw.js` jest celowo samo-wyrejestrowujący (portal działa online) |
| Ikony | Tabler Icons (CDN webfont) |
| Hosting | Cloudflare Pages |
| Deploy | `npx wrangler pages deploy . --project-name serwiscieplo-portal` |

---

## Jak działa powiązanie klient ↔ konto

Powiązanie jest przez kolumnę **`klienci.portal_user_id`** (NIE przez email):

1. Serwisant w panelu klika „Zaproś do portalu" → edge `send-portal-invitation` wysyła e-mail z linkiem `portal.serwiscieplo.pl/?token=XXX`.
2. Klient otwiera link → ekran „Aktywuj konto" (ustawia hasło).
3. Portal woła edge `handle-portal-auth` → tworzy konto w `auth.users`, ustawia `klienci.portal_user_id = <id konta>` i loguje klienta.
4. Po zalogowaniu portal pobiera dane przez RLS: `klienci.portal_user_id = auth.uid()`.

> Wcześniejsza wersja wiązała konto po `email` — to już nieaktualne. Obowiązuje `portal_user_id`.

---

## Tabele Supabase (używane przez portal)
- `klienci` — własny rekord klienta — **tylko odczyt** (`portal_user_id = auth.uid()`)
- `serwisy` — historia serwisów własnego kotła — **tylko odczyt**
- `serwisanci` — dane kontaktowe technika — **tylko odczyt**
- `service_requests` — zgłoszenia serwisowe — **odczyt + zapis** (składanie, anulowanie, potwierdzanie/odrzucanie terminu)

Pełną mapę tabel oraz model RLS opisuje sekcja **Ekosystem** poniżej.

---

## Ekosystem

SerwisCiepło to **dwie aplikacje** korzystające z **jednego projektu Supabase** (`dzekzfxhqxiifuaesjum`):

| Aplikacja | Dla kogo | Ścieżka lokalna | URL | Repo GitHub |
|---|---|---|---|---|
| **Panel technika** („kotły") | serwisanci | `C:\Users\nowys\Desktop\kotły` | serwiscieplo.pl | jnowy1009/serwiscieplo |
| **Portal klienta** (ta apka) | właściciele kotłów | `C:\Users\nowys\Desktop\inne projekty\serwiscieplo-portal` | portal.serwiscieplo.pl | jnowy1009/serwiscieplo-portal |

### Tabele Supabase — kto czego używa
Legenda: **O** = odczyt (SELECT), **Z** = zapis (INSERT/UPDATE/DELETE), **—** = brak dostępu z tej apki.

| Tabela | Panel technika | Portal klienta | Współdzielona |
|---|---|---|---|
| `klienci` | O + Z (CRUD) | O (własny rekord) | ✅ |
| `serwisy` | O + Z (CRUD) | O (własne, tylko odczyt) | ✅ |
| `serwisanci` | O + Z (własny profil) | O (kontakt technika) | ✅ |
| `service_requests` | O + Z (status/termin) | O + Z (składa/anuluje/potwierdza) | ✅ |
| `portal_invitations` | Z (edge `send-portal-invitation`) | odczyt przez edge `handle-portal-auth` | ✅ (przez backend) |
| `user_roles` | przez RPC (logowanie/admin) | wiersz tworzony przy rejestracji | ✅ (przez backend) |
| `wydarzenia` | O + Z (kalendarz) | — | tylko panel |
| `instrukcje` | O + Z | — | tylko panel |
| `notatki` | O + Z | — | tylko panel |
| `powiadomienia` (+ `_odczytane`) | O + Z | — | tylko panel |
| `push_subscriptions` | Z (upsert) | — | tylko panel |

### Tabele współdzielone — model RLS (spójny po obu stronach)
- **`klienci`** — technik: pełen CRUD na rekordach gdzie `user_id = auth.uid()`; klient portalu: **tylko SELECT** gdzie `portal_user_id = auth.uid()`. Powiązanie klient ↔ konto przez kolumnę `klienci.portal_user_id` (ustawia ją edge `handle-portal-auth` przy aktywacji).
- **`serwisy`** — technik: CRUD gdzie `user_id = auth.uid()`; klient portalu: **tylko SELECT** swoich (`klient_id` należy do jego `klienci`). Portal nie zapisuje serwisów.
- **`serwisanci`** — właściciel: ALL gdzie `user_id = auth.uid()`; każdy zalogowany: SELECT (portal czyta dane kontaktowe technika).
- **`service_requests`** — klient: ALL gdzie `portal_user_id = auth.uid()` (składa, anuluje, potwierdza/odrzuca termin); technik: ALL gdzie `technician_id = auth.uid()` **lub** `klient_id` należy do jego klientów (zmienia status, ustawia termin wizyty). Portal nasłuchuje tej tabeli przez Supabase Realtime.

### Edge Functions i triggery (wspólny backend)
- `claude-proxy` (panel) — proxy do asystenta AI (Anthropic Claude Haiku).
- `send-reminders` (panel) — przypomnienia o przeglądach.
- `send-portal-invitation` (źródło w repo portalu, **wywoływana przez panel**) — wysyła e-mail z linkiem aktywacyjnym (token) przez Resend.
- `handle-portal-auth` (portal) — aktywuje konto klienta z tokenu, ustawia `klienci.portal_user_id`.
- `notify-technician-new-request` (portal) — wyzwalana triggerem DB `SERWIS-REQUESTS` na INSERT do `service_requests` → e-mail do technika (Resend).

### Strony portalu klienta i operacje na danych
- **Dashboard (`/dashboard`)** — O: `klienci` (własny), `serwisy` (własne, zagnieżdżone), `serwisanci` (kontakt technika).
- **Szczegóły obiektu (`/klient/:id`)** — O: `serwisy` danego kotła.
- **Zgłoszenia (`/requests`)** — O: `service_requests` (własne).
- **Szczegóły zgłoszenia (`/request/:id`)** — O + Z: potwierdzenie terminu, prośba o zmianę, anulowanie (UPDATE `service_requests`).
- **Nowe zgłoszenie (`/request/new`)** — Z: INSERT `service_requests`.
- **Profil (`/profile`)** — tylko odczyt danych z pamięci + wylogowanie.
- Realtime: nasłuch zmian `service_requests` (własne) → aktualizacja widoku na żywo.

### Drugi projekt — Panel technika
- Ścieżka: `C:\Users\nowys\Desktop\kotły` · Repo: `jnowy1009/serwiscieplo` · URL: `serwiscieplo.pl`
- Główna aplikacja dla serwisantów (CRUD klientów/serwisów, kalendarz, AI, obsługa zgłoszeń). CLAUDE.md panelu zawiera **identyczną** sekcję Ekosystem — przy zmianach utrzymuj spójność opisu po obu stronach.

---

## Architektura auth (KRYTYCZNE — nie regresować)

supabase-js v2 trzyma lock sesji (`navigator.locks`). **Nigdy** nie wywołuj `await sb.*` (np. `sb.from`, `sb.auth.getSession`) **wewnątrz** callbacka `onAuthStateChange` — powoduje to deadlock i zawieszanie portalu po odświeżeniu strony.
- Callback `onAuthStateChange` jest synchroniczny; ładowanie odracza przez `setTimeout(bootstrapApp, 0)` (zwalnia lock).
- Start aplikacji napędza zdarzenie `INITIAL_SESSION` — bez równoległego `getSession()` w `init()`.
- `loadData()` ma retry z `refreshSession()` po błędzie JWT/401 (wygasły token).

---

## Zasady pracy

### 1. Backup przed każdą edycją index.html
Backupy w folderze `_backup/` (gitignorowany). Format: `index.backup.HHMM.html`, max 5 kopii.
```powershell
$backupDir = "C:\Users\nowys\Desktop\inne projekty\serwiscieplo-portal\_backup"
New-Item -ItemType Directory -Force $backupDir | Out-Null
$stamp = (Get-Date).ToString("HHmm")
Copy-Item "C:\Users\nowys\Desktop\inne projekty\serwiscieplo-portal\index.html" "$backupDir\index.backup.$stamp.html"
$backups = Get-ChildItem "$backupDir\index.backup.*.html" | Sort-Object Name
if ($backups.Count -gt 5) { $backups | Select-Object -First ($backups.Count - 5) | Remove-Item }
```

### 2. Priorytet mobilny
Portal używany głównie na iOS Safari i Android Chrome.

### 3. Jeden plik — index.html
Cały frontend to jeden plik `index.html`. Nie twórz oddzielnych plików JS/CSS bez wyraźnej prośby.

### 4. Informuj o zmianach w Supabase
Gdy zmiana wymaga nowej kolumny/tabeli/polityki RLS/edge function — poinformuj użytkownika i podaj gotowe SQL.

### 5. Commit i push na końcu sesji
```powershell
Set-Location "C:\Users\nowys\Desktop\inne projekty\serwiscieplo-portal"
git add -A
git commit -m "opis zmian"
git push
```

### 6. Changelog — TYLKO na wyraźne polecenie
**NIE twórz ani NIE aktualizuj automatycznie `CHANGELOG.md`.**
- Zmiany w kodzie zapisuj na bieżąco w `_pending_changes.md` (bufor roboczy, niewidoczny dla klienta).
- `CHANGELOG.md` aktualizuj **wyłącznie** gdy użytkownik wprost powie „stwórz changelog" lub „zaktualizuj changelog" — przenieś wtedy treść z `_pending_changes.md` i wyczyść bufor.
- Wersja: stała `const V` w index.html, format `v2.X.Y` (minor = nowa funkcja, patch = poprawka).

### 7. Bezpieczeństwo
- Escapuj dane użytkownika funkcją `esc()`.
- `SB_KEY` to klucz `anon` (publiczny) — to akceptowalne. Sekrety (`service_role`, Resend) wyłącznie w edge functions.

---

## Edge Functions (źródła w `supabase/functions/`)
- `send-portal-invitation` — wysyła e-mail z tokenem zaproszenia (Resend). Wywoływana z panelu technika.
- `handle-portal-auth` — aktywuje konto klienta z tokenu, ustawia `klienci.portal_user_id`.
- `notify-technician-new-request` — trigger DB na INSERT do `service_requests` → e-mail do technika.

Stałe kontaktu serwisanta (`SERWISANT_*`) w index.html są nadpisywane danymi z tabeli `serwisanci`, jeśli technik uzupełnił profil.

---

## Środowisko
- OS: Windows 11, Shell: PowerShell
- Node.js: v24, npm: v11
- Wrangler: globalnie przez npm; GitHub CLI (`gh`) zainstalowany
