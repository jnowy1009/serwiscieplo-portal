# SerwisCiepło — Portal Klienta — CLAUDE.md

## Opis aplikacji

**Portal Klienta SerwisCiepło** to PWA dla klientów (właścicieli kotłów) umożliwiające:
- Przeglądanie historii serwisów własnego kotła
- Sprawdzenie daty następnego przeglądu z odliczaniem
- Dostęp do danych technicznych kotła
- Kontakt z serwisantem

URL: **portal.serwiscieplo.pl** (Cloudflare Pages)
Supabase projekt: `dzekzfxhqxiifuaesjum` (ten sam co główna apka serwisanta)

---

## Stack

| Warstwa | Technologia |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — jeden plik `index.html` (bez bundlera) |
| Baza danych | Supabase (projekt dzekzfxhqxiifuaesjum) — tylko odczyt |
| Auth | Supabase Auth (email + hasło) — klient rejestruje się swoim emailem |
| PWA | Service Worker (`sw.js`), Web App Manifest (`manifest.json`) |
| Ikony | Tabler Icons (CDN webfont) |
| Hosting | Cloudflare Pages |
| Deploy | `npx wrangler pages deploy . --project-name serwiscieplo-portal` |

---

## Jak działa powiązanie klient ↔ konto

1. Serwisant wpisuje email klienta w jego karcie (pole Email w formularzu klienta)
2. Klient rejestruje się na portalu **tym samym adresem email**
3. Portal wyszukuje rekord w `klienci` po `email = auth.email()`
4. Jeśli znaleziony → pokazuje dane; jeśli nie → ekran "konto niepowiązane"

---

## Tabele Supabase (tylko odczyt)

- `klienci` — dane klienta (imie_nazwisko, adres, kociol, nr_seryjny, nastepny_przeglad, …)
- `serwisy` — historia serwisów (klient_id, data_serwisu, opis, status)

---

## Wymagane polityki RLS w Supabase

```sql
-- Klient może czytać swój własny rekord
CREATE POLICY "portal_klienci_self_read" ON public.klienci
  FOR SELECT TO authenticated
  USING (email = auth.email());

-- Klient może czytać swoje serwisy
CREATE POLICY "portal_serwisy_self_read" ON public.serwisy
  FOR SELECT TO authenticated
  USING (klient_id IN (
    SELECT id FROM public.klienci WHERE email = auth.email()
  ));
```

---

## Zasady pracy

### 1. Backup przed każdą edycją index.html

**Przed każdą edycją pliku `index.html` utwórz kopię zapasową.**

Format nazwy: `index.backup.HHMM.html`

```powershell
$backupDir = "C:\Users\nowys\Desktop\inne projekty\serwiscieplo-portal"
$stamp = (Get-Date).ToString("HHmm")
Copy-Item "$backupDir\index.html" "$backupDir\index.backup.$stamp.html"
$backups = Get-ChildItem "$backupDir\index.backup.*.html" | Sort-Object Name
if ($backups.Count -gt 5) { $backups | Select-Object -First ($backups.Count - 5) | Remove-Item }
```

### 2. Priorytet mobilny

Portal jest używany głównie na iOS Safari i Android Chrome.

### 3. Jeden plik — index.html

Cały frontend to jeden plik `index.html`. Nie twórz oddzielnych plików JS/CSS.

### 4. Commit i push na końcu sesji

```powershell
Set-Location "C:\Users\nowys\Desktop\inne projekty\serwiscieplo-portal"
git add -A
git commit -m "opis zmian"
git push
```

### 5. Wersja

Wersja to `v1.X.Y` — minor (X) przy nowych funkcjach, patch (Y) przy poprawkach.
Aktualizuj stałą `footerVersion` w index.html.

### 6. Konfiguracja kontaktu serwisanta

Dane kontaktowe serwisanta są w stałych JS w index.html:
```js
const SERWISANT_PHONE = '+48 600 000 000';
const SERWISANT_EMAIL = 'serwis@serwiscieplo.pl';
const SERWISANT_NAME = 'SerwisCiepło';
```

---

## Środowisko

- OS: Windows 11, Shell: PowerShell
- Node.js: v24, npm: v11
- Wrangler: globalnie przez npm
- GitHub CLI: zainstalowany (`gh`)
