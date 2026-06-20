// ─── Domain definitions ───────────────────────────────────────────────────────
const DOMAINS = [
  {
    id: 'sleep',
    label: 'Sleep',
    hours: 7,
    color: '#1c2534',
    textColor: '#5b7aa8',
    fixed: true,
    defaultStart: '21:30',
    defaultEnd: '04:30',
  },
  {
    id: 'ulk',
    label: 'ULK',
    hours: 8,
    color: '#142b14',
    textColor: '#52a852',
    fixed: true,
    defaultStart: '07:00',
    defaultEnd: '14:00',
  },
  {
    id: 'prudential',
    label: 'Prudential',
    hours: 5,
    color: '#2b1414',
    textColor: '#c05a5a',
    fixed: false,
    defaultStart: '14:00',
    defaultEnd: '19:00',
  },
  {
    id: 'personal',
    label: 'Personal',
    hours: 2,
    color: '#251e0a',
    textColor: '#c09a40',
    fixed: false,
    defaultStart: '04:30',
    defaultEnd: '06:30',
  },
  {
    id: 'ai',
    label: 'AI Hours',
    hours: 2,
    color: '#111a2e',
    textColor: '#4a80d4',
    fixed: false,
    defaultStart: '19:00',
    defaultEnd: '21:00',
  },
];

const DOMAIN_MAP = Object.fromEntries(DOMAINS.map(d => [d.id, d]));

// ─── Time helpers ─────────────────────────────────────────────────────────────
const TIMELINE_START_MIN = 4 * 60 + 30;  // 4:30am
const TIMELINE_END_MIN   = 21 * 60 + 30; // 9:30pm
const TIMELINE_DURATION  = TIMELINE_END_MIN - TIMELINE_START_MIN; // 1020 min
const PX_PER_MIN         = 1.5;          // 90px per hour

function timeStrToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minToTimeStr(m) {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}
function timeToTop(timeStr) {
  return (timeStrToMin(timeStr) - TIMELINE_START_MIN) * PX_PER_MIN;
}
function durationToPx(startStr, endStr) {
  let start = timeStrToMin(startStr);
  let end   = timeStrToMin(endStr);
  if (end < start) end += 24 * 60; // crosses midnight
  return (end - start) * PX_PER_MIN;
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12  = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-SG', { weekday: 'short', month: 'short', day: 'numeric' });
}
function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // make Monday week start
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  view: 'day',
  date: todayStr(),
  data: {},       // { 'YYYY-MM-DD': { planned: [], actuals: [], planDone: false } }
  sb: null,       // supabase client
};

// ─── Persistence ─────────────────────────────────────────────────────────────
function loadLocal() {
  try {
    const raw = localStorage.getItem('dlyh_data');
    if (raw) state.data = JSON.parse(raw);
  } catch (_) {}
}
function saveLocal() {
  try {
    localStorage.setItem('dlyh_data', JSON.stringify(state.data));
  } catch (_) {}
}
function ensureDay(date) {
  if (!state.data[date]) {
    state.data[date] = { planned: getDefaultPlan(), actuals: [], planDone: false };
  }
}
function getDefaultPlan() {
  return DOMAINS
    .filter(d => !d.fixed)
    .map(d => ({ domain: d.id, start: d.defaultStart, end: d.defaultEnd, focus: '' }));
}
function getDayPlan(date) {
  ensureDay(date);
  return state.data[date].planned;
}
function getDayActuals(date) {
  ensureDay(date);
  return state.data[date].actuals;
}

// ─── Supabase sync ────────────────────────────────────────────────────────────
function initSupabase() {
  const url = localStorage.getItem('sb_url');
  const key = localStorage.getItem('sb_key');
  if (url && key && window.supabase) {
    try {
      state.sb = window.supabase.createClient(url, key);
    } catch (_) {}
  }
}

async function syncToSupabase(date) {
  if (!state.sb) return;
  const day = state.data[date];
  if (!day) return;
  try {
    // Upsert planned blocks
    for (const p of day.planned) {
      await state.sb.from('daily_plans').upsert({
        date, domain: p.domain, start_time: p.start, end_time: p.end, focus: p.focus,
      }, { onConflict: 'date,domain' });
    }
    // Upsert actuals
    for (const a of day.actuals) {
      await state.sb.from('day_logs').upsert({
        date, domain: a.domain, actual_hours: a.hours, notes: a.notes,
      }, { onConflict: 'date,domain' });
    }
  } catch (_) {}
}

async function loadFromSupabase(date) {
  if (!state.sb) return;
  try {
    const { data: plans } = await state.sb.from('daily_plans').select('*').eq('date', date);
    const { data: logs }  = await state.sb.from('day_logs').select('*').eq('date', date);
    if (plans && plans.length > 0) {
      ensureDay(date);
      state.data[date].planned = plans.map(p => ({
        domain: p.domain, start: p.start_time, end: p.end_time, focus: p.focus || '',
      }));
    }
    if (logs && logs.length > 0) {
      ensureDay(date);
      state.data[date].actuals = logs.map(l => ({
        domain: l.domain, hours: l.actual_hours, notes: l.notes || '',
      }));
    }
    saveLocal();
  } catch (_) {}
}

// ─── Render: Day View ─────────────────────────────────────────────────────────
function renderDayView() {
  ensureDay(state.date);
  const day     = state.data[state.date];
  const isToday = state.date === todayStr();
  const plan    = day.planned;
  const totalH  = TIMELINE_DURATION * PX_PER_MIN;

  // Build time labels every 30min
  const labels = [];
  for (let m = TIMELINE_START_MIN; m <= TIMELINE_END_MIN; m += 30) {
    const top = (m - TIMELINE_START_MIN) * PX_PER_MIN;
    labels.push(`<div class="time-label" style="top:${top}px">${fmtTime(minToTimeStr(m))}</div>`);
  }

  // Build grid lines
  const gridLines = [];
  for (let m = TIMELINE_START_MIN; m <= TIMELINE_END_MIN; m += 30) {
    const top  = (m - TIMELINE_START_MIN) * PX_PER_MIN;
    const cls  = m % 60 === 0 ? 'hour' : 'half';
    gridLines.push(`<div class="timeline-grid-line ${cls}" style="top:${top}px"></div>`);
  }

  // Build blocks
  const blocks = [];
  // Fixed blocks (ULK only in our timeline window; sleep starts at 9:30pm = end of timeline)
  const fixedDomains = DOMAINS.filter(d => d.fixed && d.id !== 'sleep');
  for (const d of fixedDomains) {
    const top = timeToTop(d.defaultStart);
    const h   = durationToPx(d.defaultStart, d.defaultEnd);
    if (top + h < 0 || top > totalH) continue;
    const clampTop = Math.max(0, top);
    const clampH   = Math.min(h, totalH - clampTop);
    blocks.push(`
      <div class="t-block domain-${d.id} fixed"
           style="top:${clampTop}px;height:${clampH}px;background:${d.color};color:${d.textColor}">
        <div class="t-block-label">${d.label}</div>
        <div class="t-block-time">${fmtTime(d.defaultStart)} – ${fmtTime(d.defaultEnd)}</div>
      </div>`);
  }

  // Sleep end marker at top
  blocks.push(`
    <div class="t-block-unplanned" style="top:0px;height:${PX_PER_MIN * 30}px;background:transparent;border:none">
      <span style="color:var(--sleep-text);font-size:11px">← Wake up 4:30am</span>
    </div>`);

  // Flexible blocks
  for (const p of plan) {
    const d   = DOMAIN_MAP[p.domain];
    const top = timeToTop(p.start);
    const h   = durationToPx(p.start, p.end);
    if (top + h < 0 || top > totalH) continue;
    const focusHtml = p.focus
      ? `<div class="t-block-focus">${p.focus}</div>`
      : '';
    blocks.push(`
      <div class="t-block domain-${d.id}"
           style="top:${top}px;height:${h}px;background:${d.color};color:${d.textColor}"
           data-edit="${d.id}">
        <div class="t-block-label">${d.label}</div>
        <div class="t-block-time">${fmtTime(p.start)} – ${fmtTime(p.end)}</div>
        ${focusHtml}
      </div>`);
  }

  // Sleep start at 9:30pm = bottom
  blocks.push(`
    <div class="t-block domain-sleep fixed"
         style="top:${totalH - 30 * PX_PER_MIN}px;height:${30 * PX_PER_MIN}px;background:var(--sleep);color:var(--sleep-text)">
      <div class="t-block-label">Sleep →</div>
      <div class="t-block-time">9:30pm – 4:30am</div>
    </div>`);

  const plannedInfo = isToday
    ? `<span class="day-status">${plan.length} blocks planned</span>`
    : `<span class="day-status">${fmtDate(state.date)}</span>`;

  const planBtnCls = !day.planDone && isToday ? 'plan-btn primary' : 'plan-btn';
  const planBtnTxt = day.planDone ? 'Edit Plan' : 'Plan Today';

  const html = `
    <div class="day-view">
      <div class="legend">
        ${DOMAINS.map(d => `
          <div class="legend-item">
            <div class="legend-dot" style="background:${d.textColor}"></div>
            ${d.label} · ${d.hours}h
          </div>`).join('')}
      </div>
      <div class="day-banner">
        ${plannedInfo}
        <button class="${planBtnCls}" id="open-planner">${planBtnTxt}</button>
      </div>
      <div class="timeline-scroll">
        <div class="timeline-wrap" style="height:${totalH + 40}px">
          <div class="timeline-labels" style="height:${totalH}px">${labels.join('')}</div>
          <div class="timeline-blocks" style="height:${totalH}px">
            ${gridLines.join('')}
            ${blocks.join('')}
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('app-main').innerHTML = html;

  document.getElementById('open-planner').addEventListener('click', openPlannerModal);
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => openEditBlockModal(el.dataset.edit));
  });
}

// ─── Render: Week View ────────────────────────────────────────────────────────
function renderWeekView() {
  const ws   = weekStart(state.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const today = todayStr();

  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const flexDomains = DOMAINS.filter(d => !d.fixed);

  const headCells = days.map((d, i) => {
    const num = new Date(d + 'T00:00:00').getDate();
    const cls = d === today ? 'today' : (d === state.date ? 'selected' : '');
    return `
      <div class="week-day-head ${cls}" data-date="${d}">
        <div class="week-day-name">${dayNames[i]}</div>
        <div class="week-day-num">${num}</div>
      </div>`;
  }).join('');

  // Bar rows: one per flex domain
  const barRows = flexDomains.map(domain => {
    const cells = days.map(d => {
      const plan  = getDayPlan(d).find(p => p.domain === domain.id);
      const mins  = plan ? durationToPx(plan.start, plan.end) / PX_PER_MIN : 0;
      const pct   = Math.min(100, (mins / (domain.hours * 60)) * 100);
      return `
        <div class="week-bar-cell" data-date="${d}">
          <div class="week-bar-fill" style="width:${pct}%;background:${domain.textColor};opacity:0.7"></div>
        </div>`;
    }).join('');
    return `<div class="week-bar-row" title="${domain.label}">${cells}</div>`;
  }).join('');

  // Selected day detail
  const selPlan = getDayPlan(state.date);
  const selActuals = getDayActuals(state.date);
  const detailRows = flexDomains.map(domain => {
    const plan   = selPlan.find(p => p.domain === domain.id);
    const actual = selActuals.find(a => a.domain === domain.id);
    const planMins = plan ? durationToPx(plan.start, plan.end) / PX_PER_MIN : 0;
    const actMins  = actual ? actual.hours * 60 : null;
    const planHrs  = (planMins / 60).toFixed(1);
    const pct      = Math.min(100, (planMins / (domain.hours * 60)) * 100);
    const actBadge = actMins !== null
      ? `<span style="font-size:11px;color:${domain.textColor};margin-left:6px">${(actMins/60).toFixed(1)}h actual</span>`
      : '';
    return `
      <div class="week-domain-row">
        <div class="week-domain-label" style="color:${domain.textColor}">${domain.label}</div>
        <div class="week-domain-bar-bg">
          <div class="week-domain-bar-fill" style="width:${pct}%;background:${domain.textColor};opacity:0.7"></div>
        </div>
        <div class="week-domain-hrs">${planHrs}h</div>
        ${actBadge}
      </div>`;
  }).join('');

  const html = `
    <div class="week-view">
      <div class="week-header">${headCells}</div>
      <div style="padding:12px 12px 0">
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Domain coverage this week</div>
        ${barRows}
        <div style="margin-top:6px;display:flex;gap:10px">
          ${flexDomains.map(d => `
            <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text3)">
              <div style="width:8px;height:8px;border-radius:50%;background:${d.textColor}"></div>${d.label}
            </div>`).join('')}
        </div>
      </div>
      <div class="week-detail">
        <div class="week-detail-title">${fmtDate(state.date)}</div>
        ${detailRows}
      </div>
    </div>`;

  document.getElementById('app-main').innerHTML = html;

  document.querySelectorAll('.week-day-head, .week-bar-cell').forEach(el => {
    el.addEventListener('click', () => {
      state.date = el.dataset.date;
      updateHeaderDate();
      renderWeekView();
    });
  });
}

// ─── Render: Log View ─────────────────────────────────────────────────────────
function renderLogView() {
  ensureDay(state.date);
  const day     = state.data[state.date];
  const plan    = day.planned;
  const actuals = day.actuals;
  const flexDomains = DOMAINS.filter(d => !d.fixed);

  const cards = flexDomains.map(domain => {
    const p    = plan.find(x => x.domain === domain.id);
    const a    = actuals.find(x => x.domain === domain.id) || { hours: 0, notes: '' };
    const planH = p ? (durationToPx(p.start, p.end) / PX_PER_MIN / 60).toFixed(1) : domain.hours;
    const maxH  = Math.max(parseFloat(planH) + 2, domain.hours + 2);
    return `
      <div class="log-domain-card" data-domain="${domain.id}">
        <div class="log-domain-head">
          <div class="log-domain-name" style="color:${domain.textColor}">${domain.label}</div>
          <div class="log-domain-planned">Planned: ${planH}h</div>
        </div>
        <div class="log-slider-row">
          <input class="log-slider" type="range" min="0" max="${maxH}" step="0.25"
            value="${a.hours}" data-domain="${domain.id}" data-max="${maxH}">
          <div class="log-slider-val" id="val-${domain.id}">${a.hours}h</div>
        </div>
        <textarea class="log-notes" rows="2" placeholder="Notes (optional)…"
          data-domain="${domain.id}">${a.notes || ''}</textarea>
      </div>`;
  }).join('');

  const html = `
    <div class="log-view">
      <div class="log-title">End of Day Log</div>
      <div class="log-subtitle">${fmtDate(state.date)} — how did it actually go?</div>
      <div class="log-section">
        <div class="log-section-title">Actual hours</div>
        ${cards}
      </div>
      <button class="log-save-btn" id="save-log">Save Log</button>
    </div>`;

  document.getElementById('app-main').innerHTML = html;

  document.querySelectorAll('.log-slider').forEach(slider => {
    slider.addEventListener('input', () => {
      document.getElementById('val-' + slider.dataset.domain).textContent = slider.value + 'h';
    });
  });

  document.getElementById('save-log').addEventListener('click', saveLog);
}

function saveLog() {
  ensureDay(state.date);
  const actuals = [];
  document.querySelectorAll('.log-domain-card').forEach(card => {
    const domain  = card.dataset.domain;
    const slider  = card.querySelector('.log-slider');
    const notes   = card.querySelector('.log-notes');
    actuals.push({ domain, hours: parseFloat(slider.value), notes: notes.value.trim() });
  });
  state.data[state.date].actuals = actuals;
  saveLocal();
  syncToSupabase(state.date);
  showToast('Log saved');
}

// ─── Render: Settings View ────────────────────────────────────────────────────
function renderSettingsView() {
  const sbUrl = localStorage.getItem('sb_url') || '';
  const sbKey = localStorage.getItem('sb_key') || '';
  const connected = !!state.sb;

  const html = `
    <div class="settings-view">
      <div class="settings-title">Settings</div>
      <div class="settings-sub">Configuration and sync</div>

      <div class="settings-section">
        <div class="settings-section-title">Supabase Sync</div>
        <div class="settings-card">
          <div class="settings-block">
            <div class="settings-row-label">Project URL</div>
            <div class="settings-row-sub">From your Supabase project settings</div>
            <input class="settings-input" id="sb-url" type="url"
              placeholder="https://xxxx.supabase.co" value="${sbUrl}">
          </div>
          <div class="settings-block">
            <div class="settings-row-label">Anon Key</div>
            <div class="settings-row-sub">Public anon key from API settings</div>
            <input class="settings-input" id="sb-key" type="text"
              placeholder="eyJ…" value="${sbKey}">
          </div>
          <div class="settings-block">
            <button class="settings-btn" id="save-sb">Save &amp; Connect</button>
            <div class="sync-status ${connected ? 'ok' : ''}" id="sync-status">
              ${connected ? 'Connected' : 'Not connected — data saved locally'}
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Data</div>
        <div class="settings-card">
          <div class="settings-block">
            <div class="settings-row-label">Sync today from Supabase</div>
            <div class="settings-row-sub">Pull latest plan and logs for today</div>
            <button class="settings-btn" id="pull-today" ${!connected ? 'disabled style="opacity:0.4"' : ''}>Pull Today</button>
          </div>
          <div class="settings-block">
            <div class="settings-row-label">Clear local data</div>
            <div class="settings-row-sub">Wipes all locally stored plans and logs</div>
            <button class="settings-btn danger" id="clear-data">Clear All Local Data</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">About</div>
        <div class="settings-card">
          <div class="settings-row">
            <div>
              <div class="settings-row-label">D.lyh Schedule</div>
              <div class="settings-row-sub">Phase 1 — July 2026</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('app-main').innerHTML = html;

  document.getElementById('save-sb').addEventListener('click', () => {
    const url = document.getElementById('sb-url').value.trim();
    const key = document.getElementById('sb-key').value.trim();
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    initSupabase();
    const status = document.getElementById('sync-status');
    if (state.sb) {
      status.textContent = 'Connected';
      status.className = 'sync-status ok';
    } else {
      status.textContent = 'Failed to connect — check URL and key';
      status.className = 'sync-status err';
    }
  });

  const pullBtn = document.getElementById('pull-today');
  if (pullBtn) {
    pullBtn.addEventListener('click', async () => {
      pullBtn.textContent = 'Pulling…';
      await loadFromSupabase(state.date);
      pullBtn.textContent = 'Done';
      setTimeout(() => { pullBtn.textContent = 'Pull Today'; }, 2000);
    });
  }

  document.getElementById('clear-data').addEventListener('click', () => {
    if (confirm('Clear all local data? This cannot be undone.')) {
      localStorage.removeItem('dlyh_data');
      state.data = {};
      showToast('Data cleared');
    }
  });
}

// ─── Planner Modal ────────────────────────────────────────────────────────────
function openPlannerModal() {
  ensureDay(state.date);
  const plan = state.data[state.date].planned;
  const flexDomains = DOMAINS.filter(d => !d.fixed);

  const cards = flexDomains.map(domain => {
    const p = plan.find(x => x.domain === domain.id) || { start: domain.defaultStart, end: domain.defaultEnd, focus: '' };
    return `
      <div class="modal-domain-card" data-domain="${domain.id}">
        <div class="modal-domain-name" style="color:${domain.textColor}">${domain.label} · ${domain.hours}h target</div>
        <div class="modal-time-row">
          <div class="modal-time-group">
            <label>Start</label>
            <input class="modal-time-input" type="time" data-field="start" value="${p.start}">
          </div>
          <div class="modal-time-group">
            <label>End</label>
            <input class="modal-time-input" type="time" data-field="end" value="${p.end}">
          </div>
        </div>
        <input class="modal-focus-input" type="text" data-field="focus"
          placeholder="What's the focus today? (optional)"
          value="${p.focus || ''}">
      </div>`;
  }).join('');

  const content = `
    <div class="modal-handle"></div>
    <div class="modal-title">Plan ${state.date === todayStr() ? 'Today' : fmtDate(state.date)}</div>
    <div class="modal-sub">Set when and what for each flexible block.</div>
    ${cards}
    <div class="modal-actions">
      <button class="modal-btn" id="modal-cancel">Cancel</button>
      <button class="modal-btn confirm" id="modal-save">Save Plan</button>
    </div>`;

  document.getElementById('modal-content').innerHTML = content;
  document.getElementById('modal-overlay').classList.remove('hidden');

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', savePlan);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
}

function openEditBlockModal(domainId) {
  ensureDay(state.date);
  const domain = DOMAIN_MAP[domainId];
  const plan   = state.data[state.date].planned;
  const p      = plan.find(x => x.domain === domainId) || { start: domain.defaultStart, end: domain.defaultEnd, focus: '' };

  const content = `
    <div class="modal-handle"></div>
    <div class="modal-title" style="color:${domain.textColor}">${domain.label}</div>
    <div class="modal-sub">Adjust this block for ${fmtDate(state.date)}</div>
    <div class="modal-domain-card" data-domain="${domainId}" style="background:var(--bg)">
      <div class="modal-time-row">
        <div class="modal-time-group">
          <label>Start</label>
          <input class="modal-time-input" type="time" data-field="start" value="${p.start}">
        </div>
        <div class="modal-time-group">
          <label>End</label>
          <input class="modal-time-input" type="time" data-field="end" value="${p.end}">
        </div>
      </div>
      <input class="modal-focus-input" type="text" data-field="focus"
        placeholder="Focus for today…"
        value="${p.focus || ''}">
    </div>
    <div class="modal-actions">
      <button class="modal-btn" id="modal-cancel">Cancel</button>
      <button class="modal-btn confirm" id="modal-save">Save</button>
    </div>`;

  document.getElementById('modal-content').innerHTML = content;
  document.getElementById('modal-overlay').classList.remove('hidden');

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', savePlan);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
}

function savePlan() {
  ensureDay(state.date);
  const planned = [];
  document.querySelectorAll('[data-domain]').forEach(card => {
    const domain = card.dataset.domain;
    if (!domain || card.classList.contains('log-domain-card')) return;
    const start  = card.querySelector('[data-field="start"]')?.value;
    const end    = card.querySelector('[data-field="end"]')?.value;
    const focus  = card.querySelector('[data-field="focus"]')?.value?.trim() || '';
    if (start && end) planned.push({ domain, start, end, focus });
  });
  if (planned.length > 0) {
    state.data[state.date].planned  = planned;
    state.data[state.date].planDone = true;
    saveLocal();
    syncToSupabase(state.date);
  }
  closeModal();
  render();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
    background: '#222', color: '#e8e8e8', padding: '10px 18px', borderRadius: '20px',
    fontSize: '13px', zIndex: '200', opacity: '0',
    transition: 'opacity 0.2s', pointerEvents: 'none',
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setView(v) {
  state.view = v;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === v);
  });
  const dateNav = document.getElementById('header-date-nav');
  dateNav.style.display = (v === 'week') ? 'none' : 'flex';
  render();
}

function render() {
  switch (state.view) {
    case 'day':      renderDayView();      break;
    case 'week':     renderWeekView();     break;
    case 'log':      renderLogView();      break;
    case 'settings': renderSettingsView(); break;
  }
}

function updateHeaderDate() {
  const el = document.getElementById('header-date');
  if (!el) return;
  const d = new Date(state.date + 'T00:00:00');
  el.textContent = state.date === todayStr()
    ? 'Today'
    : d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
function boot() {
  loadLocal();
  initSupabase();

  updateHeaderDate();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.getElementById('prev-date').addEventListener('click', () => {
    state.date = addDays(state.date, -1);
    updateHeaderDate();
    render();
  });
  document.getElementById('next-date').addEventListener('click', () => {
    state.date = addDays(state.date, 1);
    updateHeaderDate();
    render();
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();

  // Auto-load from Supabase if connected
  if (state.sb) {
    loadFromSupabase(state.date).then(() => render());
  }
}

document.addEventListener('DOMContentLoaded', boot);
