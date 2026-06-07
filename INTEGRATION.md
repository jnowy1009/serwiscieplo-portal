# Instrukcja integracji z główną aplikacją serwisanta

## Co trzeba dodać do `C:\Users\nowys\Desktop\kotły\index.html`

---

## 1. Przycisk "Zaproś do portalu" przy karcie klienta

### Gdzie dodać (w `renderClient` lub widoku szczegółów klienta):

Znajdź sekcję `.det-hdr-actions` w funkcji renderującej szczegóły klienta i dodaj przycisk:

```html
<button class="btn btn-outline btn-sm" onclick="inviteToPortal(${klient.id}, '${klient.email}', '${klient.imie_nazwisko}')">
  <i class="ti ti-mail-forward"></i> Zaproś do portalu
</button>
```

Jeśli klient ma już aktywne konto portalu (`portal_activated_at != null`), pokaż zamiast tego:
```html
<span class="tag tag-ok"><i class="ti ti-check"></i> Portal aktywny</span>
```

### Funkcja `inviteToPortal`:

```javascript
async function inviteToPortal(klientId, email, klientName) {
  if (!email) {
    showToast('Klient nie ma wpisanego adresu email. Edytuj kartę klienta.');
    return;
  }
  const confirmed = confirm(`Wysłać zaproszenie do portalu na adres:\n${email}?`);
  if (!confirmed) return;

  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch('https://dzekzfxhqxiifuaesjum.supabase.co/functions/v1/send-portal-invitation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ klient_id: klientId, email, klient_name: klientName }),
  });

  const data = await res.json();
  if (data.success) {
    showToast('Zaproszenie wysłane na ' + email);
    // Opcjonalnie: odśwież dane klienta żeby pokazać portal_invited_at
  } else {
    showToast('Błąd: ' + (data.error || 'Nieznany błąd'));
  }
}
```

### Dane z Supabase — zaktualizuj query dla klienta:

Dodaj nowe kolumny do selecta przy wczytywaniu klientów:

```javascript
const { data: cl } = await sb.from('klienci')
  .select('*, portal_user_id, portal_invited_at, portal_activated_at')
  .order('imie_nazwisko');
```

---

## 2. Widok zgłoszeń serwisowych (service_requests) w panelu serwisanta

### Nowa sekcja w widoku klienta:

Dodaj zakładkę "Zgłoszenia" w `.tabs` przy szczegółach klienta:

```html
<button class="tab" onclick="switchTab('requests')" id="tab-requests">
  Zgłoszenia <span class="nav-badge" id="req-badge"></span>
</button>
```

### Query do pobrania zgłoszeń:

```javascript
async function loadServiceRequests(klientId) {
  const { data } = await sb
    .from('service_requests')
    .select('*')
    .eq('klient_id', klientId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  return data || [];
}
```

### Renderowanie listy zgłoszeń:

```javascript
function renderServiceRequests(requests) {
  if (!requests.length) return '<p style="color:var(--text3);font-size:13px">Brak zgłoszeń.</p>';

  const statusLabels = {
    new: 'Nowe',
    in_progress: 'W trakcie',
    scheduled: 'Zaplanowane',
    completed: 'Wykonane',
    cancelled: 'Anulowane',
  };
  const statusColors = {
    new: 'tag-due', in_progress: 'tag-warn',
    scheduled: 'tag-b', completed: 'tag-ok', cancelled: '',
  };

  return requests.map(r => `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div>
          <div style="font-size:12px;color:var(--text3)">${formatDate(r.created_at)}</div>
          ${r.priority === 'urgent' ? '<span style="color:var(--red);font-size:11px;font-weight:700">🔴 PILNE</span>' : ''}
        </div>
        <span class="tag ${statusColors[r.status]}">${statusLabels[r.status]}</span>
      </div>
      <div style="font-size:13px;line-height:1.55;margin-bottom:10px">${esc(r.description)}</div>
      ${r.preferred_date ? `<div style="font-size:12px;color:var(--text2)">Preferowana data: ${formatDate(r.preferred_date)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <select onchange="updateRequestStatus('${r.id}', this.value)" style="padding:6px 10px;border:1px solid var(--border2);border-radius:var(--rs);font-size:12px;background:var(--surface2);color:var(--text2);font-family:inherit;cursor:pointer">
          <option value="">Zmień status…</option>
          <option value="in_progress">→ W trakcie</option>
          <option value="scheduled">→ Zaplanowane</option>
          <option value="completed">→ Wykonane</option>
          <option value="cancelled">→ Anuluj</option>
        </select>
        ${r.status === 'scheduled' ? `
          <button class="btn btn-sm btn-outline" onclick="openScheduleModal('${r.id}')">
            <i class="ti ti-calendar"></i> Ustaw termin
          </button>` : ''}
      </div>
    </div>`).join('');
}
```

### Funkcja zmiany statusu:

```javascript
async function updateRequestStatus(requestId, newStatus) {
  if (!newStatus) return;
  const update = { status: newStatus };
  if (newStatus === 'completed') update.completed_at = new Date().toISOString();

  const { error } = await sb
    .from('service_requests')
    .update(update)
    .eq('id', requestId);

  if (error) { showToast('Błąd: ' + error.message); return; }
  showToast('Status zaktualizowany');
  // Odśwież listę zgłoszeń
}
```

### Ustawianie terminu wizyty:

```javascript
async function setScheduledDate(requestId, dateStr, note) {
  const { error } = await sb
    .from('service_requests')
    .update({
      status: 'scheduled',
      scheduled_date: new Date(dateStr).toISOString(),
      scheduled_by: 'app',
      technician_note: note,
    })
    .eq('id', requestId);

  if (!error) showToast('Termin wizyty ustawiony — klient zostanie powiadomiony');
}
```

---

## 3. Ikona portalu przy kliencie (opcjonalnie)

Na karcie klienta w liście (`.cc`) dodaj ikonę wskazującą status portalu:

```javascript
const portalIcon = klient.portal_activated_at
  ? '<i class="ti ti-world-check" title="Portal aktywny" style="color:var(--green);font-size:14px"></i>'
  : klient.portal_invited_at
  ? '<i class="ti ti-mail-forward" title="Zaproszenie wysłane" style="color:var(--amber);font-size:14px"></i>'
  : '';
```

---

## 4. RLS — serwisant widzi zgłoszenia swoich klientów

Upewnij się że polityka RLS na `service_requests` jest uruchomiona (jest w `001_portal_schema.sql`):

```sql
CREATE POLICY "Technician sees clients requests"
  ON service_requests FOR ALL TO authenticated
  USING (
    technician_id = auth.uid()
    OR klient_id IN (SELECT id FROM klienci WHERE user_id = auth.uid())
  );
```
