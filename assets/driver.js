const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUSES = [
  {key:'loading',   label:'Loading',    color:'var(--loading)'},
  {key:'transit',    label:'In Transit', color:'var(--transit)'},
  {key:'delayed',    label:'Delayed',    color:'var(--delayed)'},
  {key:'delivered',  label:'Delivered',  color:'var(--delivered)'},
];

function fmtEta(v){
  if(!v) return null;
  try{ return new Date(v).toLocaleString('en-US', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}); }
  catch(e){ return v; }
}
function routeLabel(l){
  if(l.origin && l.destination) return `${l.origin} → ${l.destination}`;
  if(l.origin) return `From ${l.origin}`;
  if(l.destination) return `To ${l.destination}`;
  return '';
}
function toLocalInput(v){
  if(!v) return '';
  const d = new Date(v);
  const pad = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const params = new URLSearchParams(location.search);
const org = params.get('org');
const loadId = params.get('load');
const token = params.get('token');

const contentEl = document.getElementById('drv-content');

function showError(){
  contentEl.innerHTML = `<h1>Link not valid</h1><div class="sub">This driver update link is incorrect or has expired. Please ask your dispatcher for a new link.</div>`;
}

async function init(){
  if(!org || !loadId || !token){ showError(); return; }
  const { data, error } = await sb.rpc('driver_get_load', { p_org: org, p_load_id: loadId, p_token: token });
  if(error || !data || data.length===0){ showError(); return; }
  renderForm(data[0]);
}

function renderForm(l){
  contentEl.innerHTML = `
    <h1><span class="live-dot"></span>Load ${l.id}</h1>
    <div class="sub">Update this load's status — no login needed.</div>
    <div class="drv-summary">
      ${l.carrier ? `<div class="r"><span>Carrier</span><span>${l.carrier}</span></div>` : ''}
      ${routeLabel(l) ? `<div class="r"><span>Route</span><span>${routeLabel(l)}</span></div>` : ''}
      <div class="r"><span>Current status</span><span>${(STATUSES.find(s=>s.key===l.status)||STATUSES[0]).label}</span></div>
    </div>
    <div class="status-pills" id="drv-pills" style="margin-bottom:14px;"></div>
    <div class="field">
      <label for="drv-eta">ETA</label>
      <input id="drv-eta" type="datetime-local" value="${toLocalInput(l.eta)}">
    </div>
    <div class="field">
      <label for="drv-note">Note</label>
      <textarea id="drv-note" rows="2" placeholder="e.g. stopped for fuel, running 20 min late..."></textarea>
    </div>
    <button class="primary" id="drv-submit-btn">Send update</button>
    <div class="login-error" id="drv-error"></div>
  `;
  let drvStatus = l.status;
  const pillsEl = document.getElementById('drv-pills');
  function renderPills(){
    pillsEl.innerHTML = '';
    STATUSES.forEach(s=>{
      const b = document.createElement('button');
      b.type='button';
      b.className = 'pill' + (s.key===drvStatus ? ' active':'');
      b.style.color = s.key===drvStatus ? s.color : '';
      b.innerHTML = `<span class="dot" style="background:${s.color}"></span>${s.label}`;
      b.onclick = ()=>{ drvStatus = s.key; renderPills(); };
      pillsEl.appendChild(b);
    });
  }
  renderPills();

  document.getElementById('drv-submit-btn').addEventListener('click', async ()=>{
    const btn = document.getElementById('drv-submit-btn');
    btn.disabled = true; btn.textContent = 'Sending...';
    const eta = document.getElementById('drv-eta').value;
    const note = document.getElementById('drv-note').value.trim();
    const { error } = await sb.rpc('driver_update_load', {
      p_org: org, p_load_id: l.id, p_token: token,
      p_status: drvStatus, p_note: note, p_eta: eta ? new Date(eta).toISOString() : null,
    });
    if(error){
      document.getElementById('drv-error').textContent = 'Could not send update. Please try again.';
      btn.disabled = false; btn.textContent = 'Send update';
      return;
    }
    contentEl.innerHTML = `<div class="drv-done"><div class="big">✓</div><h1>Update sent</h1><div class="sub">Dispatch has been notified of the new status for ${l.id}.</div></div>`;
  });
}

init();
