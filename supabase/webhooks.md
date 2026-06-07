# Supabase Database Webhooks

## Webhook: Powiadomienie serwisanta o nowym zgłoszeniu

**Cel:** Gdy klient złoży zgłoszenie serwisowe, Edge Function wysyła email do serwisanta.

### Konfiguracja w Supabase Dashboard

1. Otwórz: **Database → Webhooks** w projekcie `dzekzfxhqxiifuaesjum`
2. Kliknij **Create a new hook**
3. Wypełnij:

| Pole | Wartość |
|---|---|
| Name | `notify_technician_new_request` |
| Table | `service_requests` |
| Events | `INSERT` |
| Type | `HTTP Request` |
| Method | `POST` |
| URL | `https://dzekzfxhqxiifuaesjum.supabase.co/functions/v1/notify-technician-new-request` |

4. W sekcji **HTTP Headers** dodaj:
   - `Authorization`: `Bearer YOUR_SUPABASE_ANON_KEY`
   - `Content-Type`: `application/json`

5. Kliknij **Confirm**

### Payload który otrzyma Edge Function

```json
{
  "type": "INSERT",
  "table": "service_requests",
  "record": {
    "id": "uuid",
    "klient_id": "uuid",
    "portal_user_id": "uuid",
    "technician_id": "uuid",
    "status": "new",
    "priority": "normal",
    "description": "Opis zgłoszenia",
    "preferred_date": "2026-06-15",
    ...
  },
  "old_record": null
}
```

### Uwagi

- Edge Function używa `SUPABASE_SERVICE_ROLE_KEY` aby pobrać email serwisanta z `auth.users`
- Email wysyłany jest z `kontakt@serwiscieplo.pl` przez Resend
- W razie błędu Resend — sprawdź logi Edge Function w Supabase Dashboard → Edge Functions → Logs
