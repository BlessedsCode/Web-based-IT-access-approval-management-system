const app = (() => {
  const STATUS_LABELS = {
    'новая': 'Новая',
    'на_согласовании': 'На согласовании',
    'требуется_уточнение': 'Требуется уточнение',
    'согласована': 'Согласована',
    'выполнена': 'Выполнена',
    'отклонена': 'Отклонена',
    'закрыта': 'Закрыта'
  };

  const PRIORITY_LABELS = {
    low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный'
  };

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts
    });
    if (res.status === 401) {
      location.href = '/login.html';
      return Promise.reject(new Error('unauthorized'));
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Ошибка ' + res.status }));
      throw new Error(err.error || ('Ошибка ' + res.status));
    }
    return res.status === 204 ? null : res.json();
  }

  async function loadMe() {
    const me = await api('/api/auth/me');
    document.getElementById('userName').textContent = `${me.full_name} (${me.role})`;
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      location.href = '/login.html';
    });
    await wireNav(me);
    return me;
  }

  async function wireNav(me) {
    const canApprove = me.role === 'approver' || me.role === 'admin';
    const approvalsLink = document.getElementById('approvalsLink');
    if (approvalsLink && canApprove) {
      approvalsLink.hidden = false;
      try {
        const { count } = await api('/api/requests/count-pending');
        const badge = document.getElementById('pendingCount');
        if (badge) {
          badge.textContent = count;
          badge.hidden = count === 0;
        }
      } catch (_) { /* счётчик не критичен */ }
    }
    const auditLink = document.getElementById('auditLink');
    if (auditLink && me.role === 'admin') auditLink.hidden = false;
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('ru-RU');
  }

  function badge(status) {
    const label = STATUS_LABELS[status] || status;
    return `<span class="badge ${status}">${label}</span>`;
  }

  async function initList() {
    const me = await loadMe();

    const reportLink = document.getElementById('reportLink');
    if (me.role === 'approver' || me.role === 'admin') {
      reportLink.hidden = false;
      reportLink.addEventListener('click', (e) => { e.preventDefault(); showReport(); });
    }

    const reload = async () => {
      const params = new URLSearchParams();
      const s = document.getElementById('search').value;
      const st = document.getElementById('filterStatus').value;
      const pr = document.getElementById('filterPriority').value;
      if (s) params.set('search', s);
      if (st) params.set('status', st);
      if (pr) params.set('priority', pr);
      const list = await api('/api/requests?' + params.toString());
      const tbody = document.getElementById('rows');
      tbody.innerHTML = '';
      document.getElementById('empty').hidden = list.length > 0;
      for (const r of list) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.number}</td>
          <td>${escapeHtml(r.resource)}</td>
          <td>${escapeHtml(r.access_type)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${escapeHtml(r.applicant_name)}</td>
          <td>${PRIORITY_LABELS[r.priority] || r.priority}</td>
          <td>${badge(r.status)}</td>
          <td>${fmtDate(r.created_at)}</td>
        `;
        tr.addEventListener('click', () => location.href = `/request.html?id=${r.id}`);
        tbody.appendChild(tr);
      }
    };

    document.getElementById('applyFilters').addEventListener('click', reload);
    document.getElementById('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') reload(); });

    document.getElementById('createBtn').addEventListener('click', () => {
      document.getElementById('createDialog').hidden = false;
    });
    document.getElementById('closeCreate').addEventListener('click', () => {
      document.getElementById('createDialog').hidden = true;
    });

    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const errEl = document.getElementById('createError');
      errEl.textContent = '';
      try {
        await api('/api/requests', { method: 'POST', body: JSON.stringify(data) });
        document.getElementById('createDialog').hidden = true;
        e.target.reset();
        reload();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    document.getElementById('closeReport').addEventListener('click', () => {
      document.getElementById('reportDialog').hidden = true;
    });

    await reload();
  }

  async function showReport() {
    const data = await api('/api/report');
    const out = [];
    out.push(`<p>Всего заявок: <strong>${data.total}</strong></p>`);
    out.push('<h3>По статусам</h3><table><tr><th>Статус</th><th>Кол-во</th></tr>');
    for (const r of data.by_status) out.push(`<tr><td>${STATUS_LABELS[r.status] || r.status}</td><td>${r.count}</td></tr>`);
    out.push('</table>');

    out.push('<h3>По приоритету</h3><table><tr><th>Приоритет</th><th>Кол-во</th></tr>');
    for (const r of data.by_priority) out.push(`<tr><td>${PRIORITY_LABELS[r.priority] || r.priority}</td><td>${r.count}</td></tr>`);
    out.push('</table>');

    out.push('<h3>По отделам</h3><table><tr><th>Отдел</th><th>Кол-во</th></tr>');
    for (const r of data.by_department) out.push(`<tr><td>${escapeHtml(r.department)}</td><td>${r.count}</td></tr>`);
    out.push('</table>');

    out.push('<h3>Недавние</h3><table><tr><th>№</th><th>Заявитель</th><th>Статус</th><th>Создана</th></tr>');
    for (const r of data.recent) out.push(`<tr><td><a href="/request.html?id=${r.id}">${r.number}</a></td><td>${escapeHtml(r.applicant_name)}</td><td>${STATUS_LABELS[r.status] || r.status}</td><td>${fmtDate(r.created_at)}</td></tr>`);
    out.push('</table>');

    document.getElementById('reportBody').innerHTML = out.join('');
    document.getElementById('reportDialog').hidden = false;
  }

  async function initRequest() {
    const me = await loadMe();
    const id = new URLSearchParams(location.search).get('id');
    if (!id) { location.href = '/index.html'; return; }

    const reload = async () => {
      const r = await api('/api/requests/' + id);
      document.getElementById('loading').hidden = true;
      document.getElementById('reqRoot').hidden = false;

      document.getElementById('reqTitle').textContent = `${r.number} — ${r.resource}`;
      document.getElementById('reqStatus').outerHTML = badge(r.status).replace('<span', '<span id="reqStatus"');
      document.getElementById('reqApplicant').textContent = `${r.applicant_name} (${r.applicant_username})`;
      document.getElementById('reqDept').textContent = r.department;
      document.getElementById('reqResource').textContent = r.resource;
      document.getElementById('reqType').textContent = r.access_type;
      document.getElementById('reqPriority').textContent = PRIORITY_LABELS[r.priority] || r.priority;
      document.getElementById('reqValid').textContent = r.valid_until || '—';
      document.getElementById('reqCreated').textContent = fmtDate(r.created_at);
      document.getElementById('reqUpdated').textContent = fmtDate(r.updated_at);
      document.getElementById('reqJustification').textContent = r.justification;

      renderActions(r, me, reload);
      renderFiles(r, id);
      renderComments(r);
      renderHistory(r);
      renderSteps(r);
    };

    document.getElementById('fileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = await fetch(`/api/requests/${id}/files`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка загрузки');
        return;
      }
      e.target.reset();
      reload();
    });

    document.getElementById('commentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        await api(`/api/requests/${id}/comment`, { method: 'POST', body: JSON.stringify(data) });
        e.target.reset();
        reload();
      } catch (err) { alert(err.message); }
    });

    await reload();
  }

  function renderActions(r, me, reload) {
    const wrap = document.getElementById('actions');
    const label = document.getElementById('actionCommentLabel');
    const commentEl = document.getElementById('actionComment');
    const errEl = document.getElementById('actionError');
    wrap.innerHTML = '';
    label.hidden = true;
    errEl.textContent = '';

    const isOwner = r.applicant_id === me.id;
    const canApprove = me.role === 'approver' || me.role === 'admin';
    const isAdmin = me.role === 'admin';

    const transition = async (status) => {
      try {
        await api(`/api/requests/${r.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status, comment: commentEl.value || undefined })
        });
        commentEl.value = '';
        reload();
      } catch (err) { errEl.textContent = err.message; }
    };

    const approve = async () => {
      try {
        await api(`/api/requests/${r.id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ comment: commentEl.value || undefined })
        });
        commentEl.value = '';
        reload();
      } catch (err) { errEl.textContent = err.message; }
    };

    const reject = async () => {
      if (!commentEl.value.trim()) { errEl.textContent = 'Укажите причину отклонения'; return; }
      try {
        await api(`/api/requests/${r.id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ comment: commentEl.value })
        });
        commentEl.value = '';
        reload();
      } catch (err) { errEl.textContent = err.message; }
    };

    const addBtn = (text, cls, handler) => {
      const b = document.createElement('button');
      b.textContent = text;
      if (cls) b.className = cls;
      b.addEventListener('click', handler);
      wrap.appendChild(b);
      label.hidden = false;
    };

    if (isOwner && r.status === 'новая') addBtn('Отправить на согласование', 'primary', () => transition('на_согласовании'));
    if (isOwner && r.status === 'требуется_уточнение') addBtn('Отправить заново', 'primary', () => transition('на_согласовании'));

    if (canApprove && r.status === 'на_согласовании') {
      addBtn('Согласовать', 'success', approve);
      addBtn('Отклонить', 'danger', reject);
      addBtn('Требуется уточнение', '', () => transition('требуется_уточнение'));
    }

    if (canApprove && r.status === 'согласована') addBtn('Отметить выполненной', 'success', () => transition('выполнена'));
    if (canApprove && (r.status === 'выполнена' || r.status === 'отклонена')) addBtn('Закрыть заявку', '', () => transition('закрыта'));

    if (isAdmin) {
      const del = document.createElement('button');
      del.textContent = 'Удалить';
      del.className = 'danger';
      del.addEventListener('click', async () => {
        if (!confirm('Удалить заявку?')) return;
        try {
          await api('/api/requests/' + r.id, { method: 'DELETE' });
          location.href = '/index.html';
        } catch (err) { errEl.textContent = err.message; }
      });
      wrap.appendChild(del);
    }

    if (!wrap.children.length) {
      wrap.innerHTML = '<span class="hint">Действия по статусу недоступны</span>';
      label.hidden = true;
    }
  }

  function renderFiles(r, id) {
    const ul = document.getElementById('filesList');
    ul.innerHTML = '';
    if (!r.files.length) { ul.innerHTML = '<li class="hint">Файлов нет</li>'; return; }
    for (const f of r.files) {
      const li = document.createElement('li');
      li.innerHTML = `<a href="/api/requests/${id}/files/${f.id}">${escapeHtml(f.filename)}</a> <span class="hint">${(f.size/1024).toFixed(1)} КБ · ${fmtDate(f.uploaded_at)}</span>`;
      ul.appendChild(li);
    }
  }

  function renderComments(r) {
    const wrap = document.getElementById('commentsList');
    wrap.innerHTML = '';
    if (!r.comments.length) { wrap.innerHTML = '<p class="hint">Комментариев пока нет</p>'; return; }
    for (const c of r.comments) {
      const div = document.createElement('div');
      div.className = 'comment';
      div.innerHTML = `<div class="meta">${escapeHtml(c.author_name)} · ${fmtDate(c.created_at)}</div><div class="body">${escapeHtml(c.text)}</div>`;
      wrap.appendChild(div);
    }
  }

  function renderHistory(r) {
    const ol = document.getElementById('historyList');
    ol.innerHTML = '';
    for (const h of r.history) {
      const li = document.createElement('li');
      const from = h.old_status ? STATUS_LABELS[h.old_status] || h.old_status : '—';
      const to = h.new_status ? STATUS_LABELS[h.new_status] || h.new_status : '—';
      li.innerHTML = `<span>${escapeHtml(h.changed_by_name)}: ${from} → ${to}${h.comment ? ' · ' + escapeHtml(h.comment) : ''}</span><span class="hint">${fmtDate(h.changed_at)}</span>`;
      ol.appendChild(li);
    }
  }

  function renderSteps(r) {
    const ol = document.getElementById('stepsList');
    ol.innerHTML = '';
    if (!r.approval_steps.length) { ol.innerHTML = '<li class="hint">Шагов согласования нет</li>'; return; }
    for (const s of r.approval_steps) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(s.approver_name)} · ${s.status}${s.comment ? ' · ' + escapeHtml(s.comment) : ''}</span><span class="hint">${fmtDate(s.decided_at)}</span>`;
      ol.appendChild(li);
    }
  }

  async function initApprovals() {
    await loadMe();

    const selected = new Set();
    let all = [];
    let activeFilter = 'pending';

    const bulkBtn = document.getElementById('bulkApproveBtn');
    const tbody = document.getElementById('rows');
    const selectAll = document.getElementById('selectAll');

    const isOverdue = (r) => r.valid_until && r.valid_until < new Date().toISOString().slice(0, 10);
    const isUrgent = (r) => r.priority === 'urgent' || r.priority === 'high';

    const visible = () => all.filter((r) => {
      if (activeFilter === 'urgent') return isUrgent(r);
      if (activeFilter === 'overdue') return isOverdue(r);
      return true;
    });

    const updateBulkBtn = () => {
      bulkBtn.disabled = selected.size === 0;
      bulkBtn.textContent = selected.size
        ? `Согласовать выбранные (${selected.size})`
        : 'Согласовать выбранные';
    };

    const render = () => {
      const list = visible();
      tbody.innerHTML = '';
      document.getElementById('empty').hidden = list.length > 0;
      for (const r of list) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="checkbox" class="row-check" data-id="${r.id}" ${selected.has(r.id) ? 'checked' : ''}></td>
          <td><a href="/request.html?id=${r.id}">${r.number}</a></td>
          <td>${escapeHtml(r.resource)}</td>
          <td>${escapeHtml(r.access_type)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td>${escapeHtml(r.applicant_name)}</td>
          <td>${PRIORITY_LABELS[r.priority] || r.priority}</td>
          <td>${isOverdue(r) ? '<span class="overdue">' + escapeHtml(r.valid_until) + '</span>' : (r.valid_until || '—')}</td>
          <td>${fmtDate(r.created_at)}</td>
        `;
        tbody.appendChild(tr);
      }
      tbody.querySelectorAll('.row-check').forEach((cb) => {
        cb.addEventListener('change', () => {
          const id = Number(cb.dataset.id);
          if (cb.checked) selected.add(id); else selected.delete(id);
          updateBulkBtn();
        });
      });
      selectAll.checked = list.length > 0 && list.every((r) => selected.has(r.id));
      updateBulkBtn();
    };

    selectAll.addEventListener('change', () => {
      for (const r of visible()) {
        if (selectAll.checked) selected.add(r.id); else selected.delete(r.id);
      }
      render();
    });

    document.querySelectorAll('.quick-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quick-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        render();
      });
    });

    const dialog = document.getElementById('bulkDialog');
    bulkBtn.addEventListener('click', () => {
      if (!selected.size) return;
      document.getElementById('bulkInfo').textContent = `Будет согласовано заявок: ${selected.size}`;
      document.getElementById('bulkComment').value = '';
      dialog.hidden = false;
    });
    document.getElementById('bulkCancel').addEventListener('click', () => { dialog.hidden = true; });

    document.getElementById('bulkConfirm').addEventListener('click', async () => {
      const errEl = document.getElementById('bulkError');
      errEl.textContent = '';
      try {
        const res = await api('/api/approval/bulk', {
          method: 'POST',
          body: JSON.stringify({ ids: [...selected], comment: document.getElementById('bulkComment').value || undefined })
        });
        dialog.hidden = true;
        selected.clear();
        errEl.textContent = `Согласовано: ${res.approved}` + (res.skipped.length ? `, пропущено: ${res.skipped.length}` : '');
        await load();
      } catch (err) { errEl.textContent = err.message; }
    });

    const load = async () => {
      all = await api('/api/requests/my-approvals');
      for (const id of [...selected]) if (!all.some((r) => r.id === id)) selected.delete(id);
      render();
    };

    await load();
  }

  const AUDIT_LABELS = {
    login: 'Вход',
    logout: 'Выход',
    login_failed: 'Неудачная попытка',
    lockout: 'Блокировка',
    password_changed: 'Смена пароля'
  };

  async function initAudit() {
    await loadMe();

    const reload = async () => {
      const params = new URLSearchParams();
      const user = document.getElementById('filterUser').value;
      const event = document.getElementById('filterEvent').value;
      const from = document.getElementById('filterFrom').value;
      const to = document.getElementById('filterTo').value;
      if (user) params.set('user', user);
      if (event) params.set('event_type', event);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const rows = await api('/api/audit?' + params.toString());
      const tbody = document.getElementById('rows');
      tbody.innerHTML = '';
      document.getElementById('empty').hidden = rows.length > 0;
      for (const r of rows) {
        const tr = document.createElement('tr');
        const label = AUDIT_LABELS[r.event_type] || r.event_type;
        tr.innerHTML = `
          <td>${fmtDate(r.created_at)}</td>
          <td>${escapeHtml(r.user_login)}</td>
          <td><span class="badge event-${r.event_type}">${label}</span></td>
          <td>${escapeHtml(r.ip_address)}</td>
          <td>${escapeHtml(r.details)}</td>
        `;
        tbody.appendChild(tr);
      }
    };

    document.getElementById('applyFilters').addEventListener('click', reload);
    document.getElementById('filterUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') reload(); });
    document.getElementById('resetFilters').addEventListener('click', () => {
      document.getElementById('filterUser').value = '';
      document.getElementById('filterEvent').value = '';
      document.getElementById('filterFrom').value = '';
      document.getElementById('filterTo').value = '';
      reload();
    });

    await reload();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { initList, initRequest, initApprovals, initAudit };
})();
