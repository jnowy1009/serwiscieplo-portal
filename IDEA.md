# SerwisCiepło — Portal klienta — IDEA

## Co to jest i dla kogo
PWA dla **klientów (właścicieli kotłów)** — prosty wgląd w swój kocioł i kontakt z serwisem.
Osobna aplikacja od panelu technika, ale wspólny backend Supabase. Cały frontend to jeden plik `index.html`.

## Główne funkcje (już istnieją)
- **Dashboard obiektu** — dane kotła, status przeglądu z odliczaniem do następnego.
- **Historia serwisów** — lista wykonanych serwisów własnego kotła (tylko odczyt).
- **Zgłoszenia serwisowe** — składanie zgłoszenia (priorytet, preferowana data), anulowanie, potwierdzanie lub odrzucanie terminu zaproponowanego przez technika.
- **Status na żywo** — aktualizacje zgłoszeń przez Supabase Realtime.
- **Kontakt z serwisantem** — dane technika pobierane z jego profilu.
- **Aktywacja konta przez token** — z linku w e-mailu (bez ręcznej rejestracji).
- **Tryb ciemny**, działanie na iOS i Androidzie.

## Kierunek rozwoju (propozycje)
- Powiadomienia push o zmianie statusu zgłoszenia / potwierdzeniu wizyty.
- Więcej szczegółów obiektu i dokumentów dostępnych dla klienta.
- Dopracowanie potwierdzania wizyt i komunikacji z technikiem.

> Szczegóły techniczne (tabele, RLS, edge functions, powiązania): patrz `CLAUDE.md`, sekcja **Ekosystem**.
> Druga apka: **Panel technika** — `C:\Users\nowys\Desktop\kotły`.
