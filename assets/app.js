/* ============================================================
   STATUS CENTER — app.js
   Talks to Supabase for auth, data storage and realtime updates.
   ============================================================ */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUSES = [
  {key:'loading',   label:'Loading',    color:'var(--loading)'},
  {key:'transit',    label:'In Transit', color:'var(--transit)'},
  {key:'delayed',    label:'Delayed',    color:'var(--delayed)'},
  {key:'delivered',  label:'Delivered',  color:'var(--delivered)'},
];
const US_STATES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado',
  CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho',
  IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
  ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi',
  MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
  OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
  TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington',
  WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'Washington, D.C.'
};

let orgCode = null;
let orgInfo = {};
let currentUser = null;   // {id, username, name, role}
let board = {};           // { loadId: loadRow } — ACTIVE (non-archived) loads only, used by Board tab
let allLoads = {};        // { loadId: loadRow } — every load ever recorded, used by Database tab
let selectedStatus = 'loading';
let dbSort = {col:'updated_at', dir:'desc'};
let dismissedAlerts = new Set();
let dismissedStale = new Set();
let realtimeChannel = null;

const $ = sel => document.querySelector(sel);
const toastEl = $('#toast');
function toast(msg){ toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'), 2200); }
function slugify(s){ return s.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function pseudoEmail(org, username){ return `${slugify(username)}@${org}.workspace.local`; }

/* ---------------- theme ---------------- */
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='dark' ? 'dark' : 'light');
  $('#theme-toggle').textContent = t==='dark' ? '☀️ Light' : '🌙 Dark';
}
$('#theme-toggle').addEventListener('click', ()=>{
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur==='dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('sc-theme', next);
});
applyTheme(localStorage.getItem('sc-theme') || 'light');

/* ---------------- auth: screen switching ---------------- */
function showStep(step){
  ['step-login','step-signup','step-join'].forEach(id=>$('#'+id).classList.add('hidden'));
  $('#'+step).classList.remove('hidden');
}
$('#show-signup-btn').addEventListener('click', ()=> showStep('step-signup'));
$('#show-join-btn').addEventListener('click', ()=> showStep('step-join'));
$('#back-to-login-1').addEventListener('click', ()=> showStep('step-login'));
$('#back-to-login-2').addEventListener('click', ()=> showStep('step-login'));

/* ---------------- sign in ---------------- */
$('#login-btn').addEventListener('click', doLogin);
$('#lg-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
async function doLogin(){
  const org = slugify($('#lg-org').value.trim());
  const username = $('#lg-user').value.trim();
  const password = $('#lg-pass').value;
  const errEl = $('#login-error'); errEl.textContent = '';
  if(!org || !username || !password){ errEl.textContent = 'Fill in all fields.'; return; }
  const btn = $('#login-btn'); btn.disabled = true; btn.textContent = 'Signing in...';
  const { error } = await sb.auth.signInWithPassword({ email: pseudoEmail(org, username), password });
  btn.disabled = false; btn.textContent = 'Sign in';
  if(error){ errEl.textContent = 'Incorrect organization code, username, or password.'; return; }
  await afterAuth();
}

/* ---------------- create new workspace ---------------- */
$('#signup-btn').addEventListener('click', async ()=>{
  const orgName = $('#su-orgname').value.trim();
  const code = slugify($('#su-orgcode').value);
  const name = $('#su-name').value.trim();
  const username = $('#su-user').value.trim();
  const password = $('#su-pass').value;
  const errEl = $('#signup-error'); errEl.textContent = '';
  if(!orgName || !code || !name || !username || !password){ errEl.textContent = 'Fill in all fields.'; return; }
  if(password.length < 6){ errEl.textContent = 'Password must be at least 6 characters.'; return; }
  const btn = $('#signup-btn'); btn.disabled = true; btn.textContent = 'Creating...';

  const { error: signUpErr } = await sb.auth.signUp({ email: pseudoEmail(code, username), password });
  if(signUpErr){
    errEl.textContent = signUpErr.message.includes('already') ? 'That username is already taken.' : signUpErr.message;
    btn.disabled = false; btn.textContent = 'Create workspace & sign in';
    return;
  }
  const { error: rpcErr } = await sb.rpc('create_org', { p_code: code, p_name: orgName, p_username: username, p_full_name: name });
  btn.disabled = false; btn.textContent = 'Create workspace & sign in';
  if(rpcErr){
    errEl.textContent = rpcErr.message.includes('org_taken') ? 'That organization code is already taken.' : rpcErr.message;
    return;
  }
  await afterAuth();
});

/* ---------------- join existing workspace ---------------- */
$('#join-btn').addEventListener('click', async ()=>{
  const code = slugify($('#jo-orgcode').value);
  const name = $('#jo-name').value.trim();
  const username = $('#jo-user').value.trim();
  const password = $('#jo-pass').value;
  const errEl = $('#join-error'); errEl.textContent = '';
  if(!code || !name || !username || !password){ errEl.textContent = 'Fill in all fields.'; return; }
  if(password.length < 6){ errEl.textContent = 'Password must be at least 6 characters.'; return; }
  const btn = $('#join-btn'); btn.disabled = true; btn.textContent = 'Joining...';

  const { error: signUpErr } = await sb.auth.signUp({ email: pseudoEmail(code, username), password });
  if(signUpErr){
    errEl.textContent = signUpErr.message.includes('already') ? 'That username is already taken.' : signUpErr.message;
    btn.disabled = false; btn.textContent = 'Join workspace & sign in';
    return;
  }
  const { error: rpcErr } = await sb.rpc('join_org', { p_code: code, p_username: username, p_full_name: name });
  btn.disabled = false; btn.textContent = 'Join workspace & sign in';
  if(rpcErr){
    errEl.textContent = rpcErr.message.includes('org_not_found') ? 'No workspace found with that code.' : rpcErr.message;
    return;
  }
  await afterAuth();
});

/* ---------------- sign out ---------------- */
$('#logout-btn').addEventListener('click', async ()=>{
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  await sb.auth.signOut();
  currentUser = null; orgCode = null; board = {};
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  showStep('step-login');
  $('#lg-org').value=''; $('#lg-user').value=''; $('#lg-pass').value='';
});

/* ---------------- after successful auth: load profile & enter app ---------------- */
async function afterAuth(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) return;
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if(error || !profile){ toast('Could not load your profile'); return; }
  orgCode = profile.org_code;
  currentUser = { id: user.id, username: profile.username, name: profile.name, role: profile.role };
  const { data: org } = await sb.from('orgs').select('*').eq('code', orgCode).single();
  orgInfo = org || {};
  await enterApp();
}

/* ---------------- restore session on page load ---------------- */
(async function init(){
  const { data: { session } } = await sb.auth.getSession();
  if(session) await afterAuth();
})();

/* ---------------- enter app ---------------- */
async function enterApp(){
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#who-name').textContent = currentUser.name;
  $('#who-role').textContent = currentUser.role;
  $('#app-org-name').textContent = (orgInfo.name || orgCode) + ' · ' + orgCode;
  $('#org-code-display').value = orgCode;
  const isManager = currentUser.role === 'manager';
  $('#tab-database').classList.toggle('hidden', !isManager);
  $('#tab-users').classList.toggle('hidden', !isManager);
  populateStateSelects();
  await loadBoard();
  renderPills();
  updateModeHint();
  renderQuickChips();
  renderDayStat();
  renderBoard();
  $('#status-msg').style.display = 'none';
  switchTab('board');
  subscribeRealtime();
}

/* ---------------- realtime subscription ---------------- */
let refreshDebounceTimer = null;
function scheduleRefresh(){
  clearTimeout(refreshDebounceTimer);
  refreshDebounceTimer = setTimeout(refreshVisiblePanels, 400);
}
function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('loads-' + orgCode)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loads', filter: `org_code=eq.${orgCode}` }, scheduleRefresh)
    .subscribe();
}
async function refreshVisiblePanels(){
  await loadBoard();
  if(!$('#panel-board').classList.contains('hidden')){ renderBoard(); renderQuickChips(); renderDayStat(); }
  if(!$('#panel-database').classList.contains('hidden')){ await loadAllLoads(); renderDatabase(); }
}

/* ---------------- 30s fallback poll ----------------
   Realtime covers most cases instantly, but a websocket can silently
   drop (sleeping laptop, flaky wifi, mobile network switch). This
   safety-net makes sure the screen is never more than ~30s stale
   even if the realtime connection is lost. */
setInterval(()=>{
  if(!currentUser || !orgCode) return;
  if($('#app').classList.contains('hidden')) return;
  if(document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return; // don't yank focus mid-edit
  if(!$('#hist-modal').classList.contains('hidden')) return;
  refreshVisiblePanels();
}, 30000);

/* ---------------- tabs ---------------- */
document.querySelectorAll('#tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=> switchTab(btn.dataset.tab));
});
function switchTab(tab){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  $('#panel-board').classList.toggle('hidden', tab!=='board');
  $('#panel-database').classList.toggle('hidden', tab!=='database');
  $('#panel-users').classList.toggle('hidden', tab!=='users');
  if(tab==='database'){ loadAllLoads().then(renderDatabase); }
  if(tab==='users'){ renderUsers(); $('#dispatch-phone').value = orgInfo.dispatch_phone || ''; }
}

/* ---------------- state selects ---------------- */
function populateStateSelects(){
  [$('#f-origin'), $('#f-dest')].forEach(sel=>{
    sel.innerHTML = '<option value="">Select state</option>' +
      Object.entries(US_STATES).map(([abbr,name])=>`<option value="${abbr}">${name} (${abbr})</option>`).join('');
  });
}

/* ---------------- board data ---------------- */
async function loadBoard(){
  const { data, error } = await sb.from('loads').select('*').eq('org_code', orgCode).eq('archived', false);
  if(error){ toast('Could not load data: ' + error.message); return; }
  board = {};
  (data||[]).forEach(l=>{ board[l.id] = l; });
}
async function loadAllLoads(){
  const { data, error } = await sb.from('loads').select('*').eq('org_code', orgCode);
  if(error){ toast('Could not load database: ' + error.message); return; }
  allLoads = {};
  (data||[]).forEach(l=>{ allLoads[l.id] = l; });
}

/* ---------------- rendering helpers ---------------- */
function renderPills(){
  const pillsEl = $('#status-pills');
  pillsEl.innerHTML = '';
  STATUSES.forEach(s=>{
    const b = document.createElement('button');
    b.type='button';
    b.className = 'pill' + (s.key===selectedStatus ? ' active':'');
    b.style.color = s.key===selectedStatus ? s.color : '';
    b.innerHTML = `<span class="dot" style="background:${s.color}"></span>${s.label}`;
    b.onclick = ()=>{ selectedStatus = s.key; renderPills(); };
    pillsEl.appendChild(b);
  });
}
function relTime(ts){
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const min = Math.floor(diff/60000);
  if(min < 1) return 'just now';
  if(min < 60) return `${min} min ago`;
  const hr = Math.floor(min/60);
  if(hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr/24);
  return `${d} day${d>1?'s':''} ago`;
}
function fmtEta(v){
  if(!v) return null;
  try{ return new Date(v).toLocaleString('en-US', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}); }
  catch(e){ return v; }
}
function toLocalInput(v){
  if(!v) return '';
  const d = new Date(v);
  const pad = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function routeLabel(l){
  if(l.origin && l.destination) return `${l.origin} → ${l.destination}`;
  if(l.origin) return `From ${l.origin}`;
  if(l.destination) return `To ${l.destination}`;
  return '';
}

function renderBoard(){
  const q = $('#search').value.trim().toLowerCase();
  const boardEl = $('#board');
  const idListEl = $('#id-list');
  boardEl.innerHTML = '';
  idListEl.innerHTML = '';
  let total = 0;

  const allIds = Object.keys(board);
  allIds.forEach(id=>{
    const opt = document.createElement('option');
    opt.value = id;
    idListEl.appendChild(opt);
  });

  STATUSES.forEach(s=>{
    const col = document.createElement('div');
    col.className = 'column';
    let items = allIds.map(id=>board[id])
      .filter(l=>l.status===s.key)
      .filter(l=> !q || l.id.toLowerCase().includes(q) || (l.carrier||'').toLowerCase().includes(q))
      .sort((a,b)=> new Date(b.updated_at) - new Date(a.updated_at));
    total += items.length;

    col.innerHTML = `
      <div class="col-head"><span class="name">${s.label}</span><span class="n">${items.length}</span></div>
      <div class="col-bar" style="background:${s.color}"></div>
      <div class="cards"></div>`;
    const cardsEl = col.querySelector('.cards');
    if(items.length===0){
      cardsEl.innerHTML = `<div class="empty-col">Empty</div>`;
    } else {
      items.forEach(l=>{
        const c = document.createElement('div');
        c.className = 'card';
        c.style.borderLeftColor = s.color;
        c.innerHTML = `
          <div class="row1"><span class="id mono">${l.id}</span>${l.eta ? `<span class="eta">${fmtEta(l.eta)}</span>`:''}</div>
          ${l.carrier ? `<div class="carrier">${l.carrier}</div>`:''}
          ${routeLabel(l) ? `<div class="route">${routeLabel(l)}</div>`:''}
          ${l.note ? `<div class="note">${l.note}</div>`:''}
          <div class="updated"><span>${relTime(l.updated_at)}</span><span>${l.updated_by||''}</span></div>
          <button type="button" class="hist-link" data-hist="${l.id}">History</button>`;
        c.addEventListener('click', (e)=>{
          if(e.target.closest('.hist-link')){ e.stopPropagation(); openHistory(l.id); return; }
          fillForm(l);
        });
        cardsEl.appendChild(c);
      });
    }
    boardEl.appendChild(col);
  });
  $('#total-count').textContent = `${total} loads`;
  renderAlertBanner();
  renderStaleBanner();
}

/* ---------------- alerts ---------------- */
function renderAlertBanner(){
  const slot = $('#alert-banner-slot');
  const delayed = Object.values(board).filter(l=>l.status==='delayed' && !dismissedAlerts.has(l.id));
  if(delayed.length===0){ slot.innerHTML=''; return; }
  const names = delayed.map(l=>l.id).join(', ');
  slot.innerHTML = `<div class="alert-banner">
    <span class="dot"></span>
    <span><b>${delayed.length} load${delayed.length>1?'s':''} delayed:</b> ${names}</span>
    <button class="close" id="alert-dismiss">Dismiss</button>
  </div>`;
  $('#alert-dismiss').addEventListener('click', ()=>{ delayed.forEach(l=>dismissedAlerts.add(l.id)); renderAlertBanner(); });
}
function renderStaleBanner(){
  const slot = $('#stale-banner-slot');
  const threeHrs = 3*3600000;
  const stale = Object.values(board).filter(l=>l.status!=='delivered' && (Date.now()-new Date(l.updated_at).getTime())>threeHrs && !dismissedStale.has(l.id));
  if(stale.length===0){ slot.innerHTML=''; return; }
  const names = stale.map(l=>l.id).join(', ');
  slot.innerHTML = `<div class="stale-banner">
    <span class="dot"></span>
    <span><b>${stale.length} load${stale.length>1?'s':''}</b> haven't been updated in 3+ hours: ${names}</span>
    <button class="close" id="stale-dismiss">Dismiss</button>
  </div>`;
  $('#stale-dismiss').addEventListener('click', ()=>{ stale.forEach(l=>dismissedStale.add(l.id)); renderStaleBanner(); });
}

/* ---------------- quick chips + daily stat ---------------- */
function renderQuickChips(){
  const mine = Object.values(board)
    .filter(l=>l.updated_by===currentUser.username)
    .sort((a,b)=> new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0,5);
  const wrap = $('#quick-chips');
  if(mine.length===0){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<span class="qlabel">Your recent:</span>` + mine.map(l=>`<button type="button" class="chip" data-chip="${l.id}">${l.id}</button>`).join('');
  wrap.querySelectorAll('.chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{ const l = board[btn.dataset.chip]; if(l) fillForm(l); });
  });
}
async function renderDayStat(){
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const { count } = await sb.from('load_history').select('*', {count:'exact', head:true})
    .eq('org_code', orgCode).eq('updated_by', currentUser.username).gte('updated_at', startOfDay.toISOString());
  $('#day-stat').innerHTML = `<b>${count||0}</b> update${count===1?'':'s'} today`;
}

/* ---------------- history modal ---------------- */
async function openHistory(id){
  $('#hist-title').textContent = `${id} — history`;
  $('#hist-list').innerHTML = 'Loading...';
  $('#hist-modal').classList.remove('hidden');
  const { data, error } = await sb.from('load_history').select('*').eq('org_code', orgCode).eq('load_id', id).order('updated_at', {ascending:false});
  if(error){ $('#hist-list').innerHTML = 'Could not load history.'; return; }
  const s = h => (STATUSES.find(x=>x.key===h.status)||STATUSES[0]).label;
  $('#hist-list').innerHTML = (data||[]).map(h=>`
    <div class="hist-item">
      <div class="row"><span>${s(h)} · ${h.updated_by||''}</span><span>${new Date(h.updated_at).toLocaleString('en-US')}</span></div>
      ${h.note ? `<div class="note">${h.note}</div>` : ''}
    </div>`).join('') || '<div class="hist-item">No history yet.</div>';
}
$('#hist-close').addEventListener('click', ()=> $('#hist-modal').classList.add('hidden'));
$('#hist-modal').addEventListener('click', (e)=>{ if(e.target.id==='hist-modal') $('#hist-modal').classList.add('hidden'); });

/* ---------------- form fill / mode hint ---------------- */
function fillForm(l){
  $('#f-id').value = l.id;
  $('#f-carrier').value = l.carrier || '';
  $('#f-origin').value = l.origin || '';
  $('#f-dest').value = l.destination || '';
  $('#f-eta').value = toLocalInput(l.eta);
  $('#f-note').value = '';
  selectedStatus = l.status;
  renderPills();
  updateModeHint();
  window.scrollTo({top:0, behavior:'smooth'});
  $('#f-note').focus();
}
function updateModeHint(){
  const id = $('#f-id').value.trim();
  const hint = $('#mode-hint');
  if(!id){ hint.textContent = "Enter a new Load ID or pick an existing one"; return; }
  hint.textContent = board[id] ? `Updating existing load "${id}"` : `"${id}" will be added as a new load`;
}
$('#f-id').addEventListener('input', ()=>{
  const id = $('#f-id').value.trim();
  if(board[id]){
    const l = board[id];
    $('#f-carrier').value = l.carrier || '';
    $('#f-origin').value = l.origin || '';
    $('#f-dest').value = l.destination || '';
    $('#f-eta').value = toLocalInput(l.eta);
    selectedStatus = l.status;
    renderPills();
  }
  updateModeHint();
});
$('#f-note').addEventListener('keydown', e=>{
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); $('#submit-btn').click(); }
});

/* ---------------- submit update ---------------- */
$('#submit-btn').addEventListener('click', async ()=>{
  const id = $('#f-id').value.trim();
  if(!id){ toast('Enter a load ID'); $('#f-id').focus(); return; }
  const carrier = $('#f-carrier').value.trim();
  const origin = $('#f-origin').value;
  const destination = $('#f-dest').value;
  const eta = $('#f-eta').value;
  const note = $('#f-note').value.trim();
  const btn = $('#submit-btn');

  let existing = board[id];
  if(!existing){
    const { data: maybeExisting } = await sb.from('loads').select('*').eq('org_code', orgCode).eq('id', id).maybeSingle();
    existing = maybeExisting || null;
  }

  if(selectedStatus === 'delayed' && !note && !eta){
    toast('Delayed loads need a note or updated ETA');
    $('#f-note').focus();
    return;
  }
  if(existing && existing.status === 'delivered' && selectedStatus !== 'delivered'){
    if(!confirm(`"${id}" is already marked Delivered. Change it back to ${STATUSES.find(s=>s.key===selectedStatus).label}?`)) return;
  }

  btn.disabled = true; btn.textContent = 'Saving...';
  const etaIso = eta ? new Date(eta).toISOString() : (existing ? existing.eta : null);
  const row = {
    id,
    org_code: orgCode,
    carrier: carrier || (existing ? existing.carrier : ''),
    origin: origin || (existing ? existing.origin : ''),
    destination: destination || (existing ? existing.destination : ''),
    eta: etaIso,
    status: selectedStatus,
    note: note || '',
    archived: false,
    updated_by: currentUser.username,
    updated_at: new Date().toISOString(),
  };
  const { error: upErr } = await sb.from('loads').upsert(row, { onConflict: 'org_code,id' });
  if(upErr){ toast('Save failed: ' + upErr.message); btn.disabled=false; btn.textContent='Update'; return; }
  await sb.from('load_history').insert({
    org_code: orgCode, load_id: id, status: selectedStatus, note: note || '',
    eta: etaIso, updated_by: currentUser.username,
  });

  btn.disabled = false; btn.textContent = 'Update';
  toast(`${id} — ${STATUSES.find(s=>s.key===selectedStatus).label}`);
  $('#f-id').value=''; $('#f-carrier').value=''; $('#f-origin').value=''; $('#f-dest').value=''; $('#f-eta').value=''; $('#f-note').value='';
  updateModeHint();
  await loadBoard();
  renderBoard();
  renderQuickChips();
  renderDayStat();
});

$('#search').addEventListener('input', renderBoard);

/* ---------------- sample data / clear ---------------- */
$('#seed-btn').addEventListener('click', async ()=>{
  const now = Date.now();
  const sample = [
    {id:'LD-1042', carrier:'Lone Star Freight', origin:'TX', destination:'CA', status:'transit', eta:new Date(now+3*3600000).toISOString(), note:'Driver checked in, no issues'},
    {id:'LD-1043', carrier:'Great Lakes Cargo', origin:'IL', destination:'OH', status:'loading', eta:new Date(now+6*3600000).toISOString(), note:'Paperwork in progress'},
    {id:'LD-1044', carrier:'Southern Route Co', origin:'GA', destination:'FL', status:'delayed', eta:new Date(now+1*3600000).toISOString(), note:'Road construction, ~40 min delay expected'},
    {id:'LD-1045', carrier:'Lone Star Freight', origin:'AZ', destination:'NM', status:'loading', eta:new Date(now+8*3600000).toISOString(), note:''},
  ];
  for(const s of sample){
    await sb.from('loads').upsert({...s, org_code: orgCode, updated_by: currentUser.username, updated_at: new Date().toISOString()}, {onConflict:'org_code,id'});
    await sb.from('load_history').insert({org_code: orgCode, load_id: s.id, status: s.status, note: s.note, eta: s.eta, updated_by: currentUser.username});
  }
  await loadBoard();
  renderBoard();
  toast('Sample loads added');
});
$('#clear-btn').addEventListener('click', async ()=>{
  if(!confirm('Clear all loads from the Board? They will stay saved in Database, just hidden from the Board.')) return;
  const ids = Object.keys(board);
  if(ids.length===0){ toast('Board is already empty'); return; }
  const { error } = await sb.from('loads').update({ archived: true }).eq('org_code', orgCode).eq('archived', false);
  if(error){ toast('Could not clear board: ' + error.message); return; }
  await loadBoard();
  renderBoard();
  toast('Board cleared — records kept in Database');
});

/* ---------------- database tab ---------------- */
function renderDatabase(){
  const q = $('#db-search').value.trim().toLowerCase();
  const tbody = $('#db-tbody');
  let rows = Object.values(allLoads).filter(l =>
    !q || l.id.toLowerCase().includes(q) || (l.carrier||'').toLowerCase().includes(q) || (l.origin||'').toLowerCase().includes(q) || (l.destination||'').toLowerCase().includes(q)
  );
  rows.sort((a,b)=>{
    let av = a[dbSort.col], bv = b[dbSort.col];
    if(dbSort.col==='updated_at'){ av = new Date(a.updated_at); bv = new Date(b.updated_at); }
    else { av = (av||'').toString().toLowerCase(); bv = (bv||'').toString().toLowerCase(); }
    if(av < bv) return dbSort.dir==='asc' ? -1 : 1;
    if(av > bv) return dbSort.dir==='asc' ? 1 : -1;
    return 0;
  });
  tbody.innerHTML = rows.map(l=>{
    const s = STATUSES.find(s=>s.key===l.status) || STATUSES[0];
    return `<tr>
      <td class="mono">${l.id}</td>
      <td>${l.carrier||''}</td>
      <td>${l.origin||''}</td>
      <td>${l.destination||''}</td>
      <td><span class="status-badge"><span class="dot" style="background:${s.color}"></span>${s.label}</span></td>
      <td>${l.archived ? '<span style="color:var(--ink-faint);">Archived</span>' : '<span style="color:var(--delivered);">Active</span>'}</td>
      <td>${fmtEta(l.eta) || ''}</td>
      <td>${l.note||''}</td>
      <td>${l.updated_by||''}</td>
      <td class="mono">${new Date(l.updated_at).toLocaleString('en-US')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="10" style="color:var(--ink-faint);">No records</td></tr>`;
  $('#db-count').textContent = `${rows.length} records`;
}
$('#db-search').addEventListener('input', renderDatabase);
document.querySelectorAll('#panel-database th').forEach(th=>{
  th.addEventListener('click', ()=>{
    const col = th.dataset.col;
    if(dbSort.col===col) dbSort.dir = dbSort.dir==='asc' ? 'desc' : 'asc';
    else { dbSort.col = col; dbSort.dir = 'asc'; }
    renderDatabase();
  });
});
$('#export-btn').addEventListener('click', async ()=>{
  await loadAllLoads();
  const rows = Object.values(allLoads);
  const header = ['Load ID','Carrier','Origin','Destination','Status','State','ETA','Note','Updated By','Last Updated'];
  const lines = [header.join(',')];
  rows.forEach(l=>{
    const s = STATUSES.find(s=>s.key===l.status) || STATUSES[0];
    const vals = [l.id, l.carrier, l.origin, l.destination, s.label, l.archived ? 'Archived' : 'Active', fmtEta(l.eta)||'', l.note, l.updated_by, new Date(l.updated_at).toLocaleString('en-US')]
      .map(v => `"${(v||'').toString().replace(/"/g,'""')}"`);
    lines.push(vals.join(','));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `loads-${orgCode}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV exported');
});

/* ---------------- users tab ---------------- */
async function renderUsers(){
  const { data, error } = await sb.from('profiles').select('*').eq('org_code', orgCode).order('username');
  const tbody = $('#users-tbody');
  if(error){ tbody.innerHTML = `<tr><td colspan="4">Could not load users.</td></tr>`; return; }
  const managerCount = (data||[]).filter(u=>u.role==='manager').length;
  const isManager = currentUser.role === 'manager';
  tbody.innerHTML = (data||[]).map(u=>{
    const isSelf = u.id === currentUser.id;
    const isLastManager = u.role==='manager' && managerCount<=1;
    const canEdit = isManager && !isSelf;
    const canDelete = canEdit && !isLastManager;
    return `<tr>
      <td class="mono">${u.username}</td>
      <td>${u.name}</td>
      <td>${canEdit
        ? `<select class="role-select" data-role-for="${u.id}"><option value="updater" ${u.role==='updater'?'selected':''}>updater</option><option value="manager" ${u.role==='manager'?'selected':''}>manager</option></select>`
        : u.role}</td>
      <td>${canDelete ? `<button class="del-btn" data-user="${u.id}">Remove</button>` : ''}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-role-for]').forEach(sel=>{
    sel.addEventListener('change', async ()=>{
      const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.roleFor);
      if(error) toast('Could not update role: ' + error.message);
      else toast('Role updated');
      renderUsers();
    });
  });
  tbody.querySelectorAll('.del-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm('Remove this user from the workspace?')) return;
      const { error } = await sb.from('profiles').delete().eq('id', btn.dataset.user);
      if(error) toast('Could not remove user: ' + error.message);
      else toast('User removed');
      renderUsers();
    });
  });
}
$('#save-phone-btn').addEventListener('click', async ()=>{
  const phone = $('#dispatch-phone').value.trim();
  const { error } = await sb.from('orgs').update({ dispatch_phone: phone }).eq('code', orgCode);
  if(error){ toast('Could not save: ' + error.message); return; }
  orgInfo.dispatch_phone = phone;
  toast(phone ? 'Dispatch number saved' : 'Dispatch number cleared');
});

/* ---------------- WhatsApp forward ---------------- */
$('#wa-btn').addEventListener('click', ()=>{
  const id = $('#f-id').value.trim();
  if(!id){ toast('Enter a Load ID first'); $('#f-id').focus(); return; }
  const phone = orgInfo.dispatch_phone;
  if(!phone){ toast('No dispatch WhatsApp number set — a manager can add one in Users tab'); return; }
  const l = board[id] || {};
  const statusLabel = (STATUSES.find(s=>s.key===selectedStatus)||STATUSES[0]).label;
  const note = $('#f-note').value.trim();
  const eta = $('#f-eta').value;
  const lines = [`${id} — ${statusLabel}`];
  if(l.carrier || $('#f-carrier').value) lines.push(`Carrier: ${$('#f-carrier').value || l.carrier}`);
  if(eta) lines.push(`ETA: ${fmtEta(eta)}`);
  if(note) lines.push(`Note: ${note}`);
  lines.push(`— ${currentUser.name}`);
  const text = encodeURIComponent(lines.join('\n'));
  const digits = phone.replace(/[^0-9]/g,'');
  window.open(`https://wa.me/${digits}?text=${text}`, '_blank');
});

/* ---------------- driver link (share, no login required) ---------------- */
$('#drv-link-btn').addEventListener('click', async ()=>{
  const id = $('#f-id').value.trim();
  if(!id){ toast('Enter a Load ID first'); $('#f-id').focus(); return; }
  const l = board[id];
  if(!l){ toast('Save this load once before sharing a link'); return; }
  const url = `${location.origin}${location.pathname.replace('index.html','')}driver.html?org=${encodeURIComponent(orgCode)}&load=${encodeURIComponent(id)}&token=${l.dtoken}`;
  try{ await navigator.clipboard.writeText(url); toast('Driver link copied — no login needed to use it'); }
  catch(e){ prompt('Copy this driver link:', url); }
});
