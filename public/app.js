
const APP_CONFIG = window.APP_CONFIG || {};
const APP_NAME = APP_CONFIG.APP_NAME || 'إلى الله';
const API_BASE = '/api';
const state = { khatmas: [], managedKhatmas: [], managedReaders: [], activeUnitKey: '', activeManagedUnitKey: '', activeAdminKhatmaId: '', activeResetUserId: '', activeDeleteUserId: '', activeDeleteKhatmaId: '', activeUpdateKhatmaId: '', activeDeleteManagedKhatmaId: '', activeUpdateManagedKhatmaId: '', activeDuplicateManagedKhatmaId: '', activeUnitFilter: 'all', activeUnitSearch: '', activeManagedUnitFilter: 'all', activeManagedUnitSearch: '', loading: true, user: null, token: localStorage.getItem('auth_token') || '', currentManageMode: false, currentManagedManageMode: false, ownerCreateUserOpen: false, activeReadersGroupId: '', editGroupId: '', currentReaderGroup: null, currentGroupReaders: [] };

const app = document.getElementById('app');
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.dataset.theme = savedTheme;
themeToggle.textContent = savedTheme === 'dark' ? '☀' : '☾';
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  themeToggle.textContent = next === 'dark' ? '☀' : '☾';
});

const menuToggle = document.getElementById('menuToggle');
const mainNav = document.getElementById('mainNav');
function setMobileMenu(open){
  document.body.classList.toggle('nav-open', Boolean(open));
  menuToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
// v5.10: menu is toggled by inline fallback onclick to survive cached/mobile browsers
mainNav?.addEventListener('click', (event) => { if(event.target.closest('a')) setMobileMenu(false); });
document.addEventListener('click', (event) => {
  const link = event.target.closest('#mainNav a');
  if(link) setMobileMenu(false);
});
window.addEventListener('resize', () => { syncHeaderMode(); });
window.toggleMobileMenuV511 = function(button){
  const next = !document.body.classList.contains('nav-open');
  setMobileMenu(next);
  if(button) button.setAttribute('aria-expanded', next ? 'true' : 'false');
};

function closeUserMenu(){
  const userMenu = document.getElementById('userMenu');
  const userPill = document.getElementById('userPill');
  const userDropdown = document.getElementById('userDropdown');
  userMenu?.classList.remove('open');
  if(userDropdown) userDropdown.hidden = true;
  userPill?.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (event) => {
  const pill = event.target.closest('#userPill');
  const menu = event.target.closest('#userMenu');
  if(pill){
    event.preventDefault();
    const userMenu = document.getElementById('userMenu');
    const userDropdown = document.getElementById('userDropdown');
    const next = !userMenu?.classList.contains('open');
    userMenu?.classList.toggle('open', next);
    if(userDropdown) userDropdown.hidden = !next;
    pill.setAttribute('aria-expanded', next ? 'true' : 'false');
    return;
  }
  if(!menu) closeUserMenu();
  if(event.target.closest('#userDropdown a')) closeUserMenu();
});

window.addEventListener('hashchange', () => closeUserMenu());


function isMobileHeader(){
  return window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
}

function syncHeaderMode(){
  const isMobile = isMobileHeader();
  const isLoggedIn = Boolean(state.user);
  const isOwner = Boolean(state.user && state.user.role === 'owner');
  const mobileUserNav = document.getElementById('mobileUserNav');
  const mobileLogoutNav = document.getElementById('mobileLogoutNav');
  const userMenu = document.getElementById('userMenu');
  const userPill = document.getElementById('userPill');
  const loginNav = document.getElementById('loginNav');

  if (mobileUserNav) {
    mobileUserNav.hidden = !(isMobile && isLoggedIn);
    mobileUserNav.style.display = (isMobile && isLoggedIn) ? 'flex' : 'none';
    mobileUserNav.textContent = state.user ? `الحساب: ${state.user.displayName}` : '';
    mobileUserNav.href = isOwner ? '#/owner' : (canUseManagedKhatmas() ? '#/dashboard' : '#/home');
  }

  if (mobileLogoutNav) {
    mobileLogoutNav.hidden = !(isMobile && isLoggedIn);
    mobileLogoutNav.style.display = (isMobile && isLoggedIn) ? 'flex' : 'none';
  }

  if (userMenu) {
    userMenu.hidden = !(isLoggedIn && !isMobile);
    userMenu.style.display = (isLoggedIn && !isMobile) ? 'block' : 'none';
  }

  if (userPill) {
    userPill.hidden = !(isLoggedIn && !isMobile);
    userPill.style.display = (isLoggedIn && !isMobile) ? 'inline-flex' : 'none';
  }

  if (loginNav) {
    loginNav.hidden = isLoggedIn;
    loginNav.style.display = isLoggedIn ? 'none' : '';
  }

  if (!isMobile) setMobileMenu(false);
}



// تنظيف بيانات النسخ المحلية السابقة حتى لا تختلط مع نسخة قاعدة البيانات
['khatmas','khatmat_khatmas','darb_alzahra_khatmas','khatmat_darb_alzahra_khatmas'].forEach(key => localStorage.removeItem(key));

window.addEventListener('hashchange', router);
setInterval(async () => {
  const hash = location.hash || '';
  if (hash.startsWith('#/khatma/') || hash.startsWith('#/managed-khatma/')) {
    document.querySelectorAll('[data-countdown-for]').forEach(el => {
      const k = state.khatmas.find(x => x.id === el.dataset.countdownFor) || state.managedKhatmas.find(x => x.id === el.dataset.countdownFor);
      if(k) el.innerHTML = countdownHtml(k);
    });
  }
}, 60000);

init();
async function init(){
  await loadCurrentUser();
  renderAuthLinks();
  if(state.user?.role === 'owner') await refreshKhatmas();
  if(canUseManagedKhatmas()) await refreshManagedKhatmas();
  router();
}
async function loadCurrentUser(){
  if(!state.token){ state.user = null; return; }
  try{
    const res = await api('/auth/me');
    state.user = res.user || null;
    if(!state.user){ localStorage.removeItem('auth_token'); state.token = ''; }
  }catch(err){ localStorage.removeItem('auth_token'); state.token = ''; state.user = null; }
}
function canUseManagedKhatmas(){
  return Boolean(state.user && (state.user.role === 'owner' || state.user.managedKhatmaCreator || state.user.managed_khatma_creator));
}
const KHATMA_TYPE_OPTIONS = [
  ['weekly', 'أسبوعية', 'الأسبوعية'],
  ['monthly', 'شهرية', 'الشهرية'],
  ['yearly', 'سنوية', 'السنوية'],
  ['special', 'خاصة', 'الخاصة'],
  ['separate', 'منفصلة', 'المنفصلة'],
  ['sub', 'فرعية', 'الفرعية'],
  ['specific', 'محددة', 'المحددة']
];
function normalizeKhatmaType(value=''){
  const raw = String(value || '').trim();
  return KHATMA_TYPE_OPTIONS.some(([key]) => key === raw) ? raw : 'monthly';
}
function khatmaTypeOptionsHtml(selected='monthly'){
  const current = normalizeKhatmaType(selected);
  return KHATMA_TYPE_OPTIONS.map(([key,label]) => `<option value="${key}" ${current === key ? 'selected' : ''}>${label}</option>`).join('');
}
function khatmaTypeAdjective(value='monthly'){
  const current = normalizeKhatmaType(value);
  return KHATMA_TYPE_OPTIONS.find(([key]) => key === current)?.[2] || 'الأسبوعية';
}
// Dropdown nav toggle
window.toggleNavGroup = function(id){
  const group = document.getElementById(id);
  if(!group) return;
  const wasOpen = group.classList.contains('open');
  document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
  if(!wasOpen) group.classList.add('open');
};
document.addEventListener('click', e => {
  if(!e.target.closest('.nav-group')) document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
});
window.addEventListener('hashchange', () => document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open')));

function renderAuthLinks(){
  const ownerNav = document.getElementById('ownerNav');
  const managedNavGroup = document.getElementById('managedNavGroup');
  const loginNav = document.getElementById('loginNav');
  const mobileLogoutNav = document.getElementById('mobileLogoutNav');
  const userMenu = document.getElementById('userMenu');
  const userPill = document.getElementById('userPill');
  const userDropdown = document.getElementById('userDropdown');
  const userMenuOwner = document.getElementById('userMenuOwner');
  const mobileUserNav = document.getElementById('mobileUserNav');
  const isOwner = Boolean(state.user && state.user.role === 'owner');
  const isLoggedIn = Boolean(state.user);

  document.body.classList.toggle('is-authenticated', isLoggedIn);

  const khatmasNavGroup = document.getElementById('khatmasNavGroup');
  if(khatmasNavGroup) khatmasNavGroup.hidden = !isOwner;
  if(ownerNav) ownerNav.hidden = !isOwner;
  if(managedNavGroup) managedNavGroup.hidden = !canUseManagedKhatmas();
  if(userMenuOwner) userMenuOwner.hidden = !isOwner;
  const khatmasDropdownLink = document.getElementById('khatmasDropdownLink');
  if(khatmasDropdownLink) khatmasDropdownLink.hidden = !isOwner;
  // Rename managed-nav labels: non-owners see clean generic labels, owners keep "مُدارة" labels
  const managedNavBtn = managedNavGroup?.querySelector('.nav-group-btn');
  const managedCreateNavLink = managedNavGroup?.querySelector('a[href="#/managed-create"]');
  if(managedNavBtn) managedNavBtn.textContent = isOwner ? 'الختمات المُدارة ▾' : 'الختمات ▾';
  if(managedCreateNavLink) managedCreateNavLink.textContent = isOwner ? 'إنشاء ختمة مُدارة' : 'إنشاء ختمة';

  // Desktop: keep the account inside the premium pill only.
  // Mobile: show account/logout inside the hamburger menu.
  if(loginNav){ loginNav.textContent = 'دخول'; loginNav.href = '#/login'; loginNav.hidden = isLoggedIn; }
  if(mobileLogoutNav){ mobileLogoutNav.hidden = !isLoggedIn; }

  if(userMenu){ userMenu.hidden = !isLoggedIn; userMenu.classList.remove('open'); }
  if(userDropdown){ userDropdown.hidden = true; }
  if(userPill){
    userPill.textContent = state.user ? state.user.displayName : '';
    userPill.hidden = !isLoggedIn;
    userPill.setAttribute('aria-expanded', 'false');
  }
  if(mobileUserNav){
    mobileUserNav.textContent = state.user ? `الحساب: ${state.user.displayName}` : '';
    mobileUserNav.href = isOwner ? '#/owner' : (canUseManagedKhatmas() ? '#/dashboard' : '#/home');
  }

  syncHeaderMode();
}
async function refreshKhatmas(){
  if(!state.user || state.user.role !== 'owner'){ state.khatmas = []; return; }
  try{
    const res = await api('/khatmas');
    state.khatmas = res.khatmas || [];
  }catch(err){
    console.error(err);
    state.khatmas = [];
    toast(err.message || 'تعذر الاتصال بقاعدة البيانات');
  }
}
async function refreshManagedKhatmas(){
  if(!canUseManagedKhatmas()){ state.managedKhatmas = []; return; }
  try{
    const res = await api('/managed-khatmas');
    state.managedKhatmas = res.khatmas || [];
  }catch(err){
    console.error(err);
    state.managedKhatmas = [];
    toast(err.message || 'تعذر تحميل الختمات المُدارة');
  }
}
async function refreshManagedReaders(groupId){
  if(!canUseManagedKhatmas()){ state.managedReaders = []; return; }
  try{
    const path = groupId ? '/managed-readers?groupId=' + encodeURIComponent(groupId) : '/managed-readers';
    const res = await api(path);
    state.managedReaders = res.readers || [];
  }catch(err){ console.error(err); state.managedReaders = []; toast(err.message || 'تعذر تحميل القراء'); }
}
async function refreshOne(id){
  try{
    const res = await api('/khatmas/' + encodeURIComponent(id));
    const index = state.khatmas.findIndex(x=>x.id===id);
    if(index >= 0) state.khatmas[index] = res.khatma;
    else state.khatmas.unshift(res.khatma);
    return res.khatma;
  }catch(err){ console.error(err); toast('تعذر تحديث بيانات الختمة'); }
}
async function refreshManagedOne(id, includeAdmin=false){
  try{
    const path = includeAdmin ? '/managed-khatmas/' + encodeURIComponent(id) + '/admin' : '/managed-khatmas/' + encodeURIComponent(id);
    const res = await api(path);
    upsertManagedKhatma(res.khatma);
    return res.khatma;
  }catch(err){ console.error(err); toast('تعذر تحديث بيانات الختمة المُدارة'); }
}
function upsertManagedKhatma(khatma){
  if(!khatma) return;
  const index = state.managedKhatmas.findIndex(x=>x.id===khatma.id);
  if(index >= 0) state.managedKhatmas[index] = khatma;
  else state.managedKhatmas.unshift(khatma);
}
function managedIdentityKey(id){ return 'managed_identity_' + id; }
function getManagedIdentity(id){ return localStorage.getItem(managedIdentityKey(id)) || sessionStorage.getItem(managedIdentityKey(id)) || ''; }
function setManagedIdentity(id, identity){ localStorage.setItem(managedIdentityKey(id), identity); sessionStorage.setItem(managedIdentityKey(id), identity); }
async function verifyManagedKhatmaIdentity(id, identity){
  const res = await api('/managed-khatmas/' + encodeURIComponent(id) + '/verify', {method:'POST', body:{identity}});
  setManagedIdentity(id, identity);
  upsertManagedKhatma(res.khatma);
  return res.khatma;
}
async function api(path, options={}){
  const res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: {'Content-Type':'application/json', ...(state.token ? {'Authorization':'Bearer ' + state.token} : {}), ...(options.headers || {})},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'API error');
  return data;
}
function getOwnerKey(){
  if(state.user) return state.user.id;
  let key = localStorage.getItem('khatmat_owner_key');
  if(!key){ key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('khatmat_owner_key', key); }
  return key;
}
function adminCodeFor(id){ return sessionStorage.getItem('admin_code_' + id) || ''; }
function isAdminPromptOpen(id){ return state.activeAdminKhatmaId === id; }

async function router(){
  setMobileMenu(false);
  const hash = location.hash || '#/home';
  if(hash.startsWith('#/logout')) return logout();
  if(hash.startsWith('#/login')) return renderTemplate('loginTemplate', setupLogin);
  if(hash.startsWith('#/owner')) return renderTemplate('ownerTemplate', setupOwner);
  if(hash.startsWith('#/reports')) return renderTemplate('reportsTemplate', setupReports);
  if(hash.startsWith('#/dashboard')) return renderTemplate('dashboardTemplate', setupDashboard);
  if(hash.startsWith('#/managed-readers')) return renderTemplate('managedReadersTemplate', setupManagedReaders);
  if(hash.startsWith('#/managed-create')) return renderTemplate('managedCreateTemplate', setupManagedCreate);
  if(hash.startsWith('#/managed-monitor')) return renderTemplate('managedMonitorTemplate', setupManagedMonitor);
  if(hash.startsWith('#/reader-login')) return renderTemplate('readerLoginTemplate', setupReaderLogin);
  if(hash.startsWith('#/reader-khatma/')) return renderTemplate('readerKhatmaTemplate', () => { const parts = hash.split('/'); setupReaderKhatma(parts[2]); });
  if(hash.startsWith('#/reader-group/')) return renderTemplate('readerGroupTemplate', () => { const parts = hash.split('/'); setupReaderGroup(parts[2]); });
  if(hash.startsWith('#/managed-khatma/')) return renderTemplate('managedKhatmaTemplate', () => { const parts = hash.split('/'); setupManagedKhatma(parts[2], parts[3] === 'manage'); });
  if(hash.startsWith('#/managed-khatmas/archived')) return renderTemplate('managedKhatmasArchivedTemplate', setupManagedKhatmasArchived);
  if(hash.startsWith('#/managed-khatmas')) return renderTemplate('managedKhatmasTemplate', setupManagedKhatmas);
  if(hash.startsWith('#/create')){
    if(!state.user || state.user.role !== 'owner'){ location.hash = canUseManagedKhatmas() ? '#/managed-khatmas' : '#/home'; return; }
    return renderTemplate('createTemplate', setupCreate);
  }
  if(hash.startsWith('#/khatmas')){
    if(!state.user || state.user.role !== 'owner'){ location.hash = canUseManagedKhatmas() ? '#/managed-khatmas' : '#/home'; return; }
    return renderTemplate('khatmasTemplate', setupKhatmas);
  }
  if(hash.startsWith('#/khatma/')){
    if(!state.user || state.user.role !== 'owner'){ location.hash = canUseManagedKhatmas() ? '#/managed-khatmas' : '#/home'; return; }
    return renderTemplate('khatmaTemplate', () => { const parts = hash.split('/'); setupKhatma(parts[2], parts[3] === 'manage'); });
  }
  renderTemplate('homeTemplate', setupHome);
}
function renderTemplate(id, setup){
  const tpl = document.getElementById(id);
  app.innerHTML = tpl.innerHTML;
  setup?.();
}

function setupLogin(){
  const form = document.getElementById('loginForm');
  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    try{
      const res = await api('/auth/login', {method:'POST', body:data});
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('auth_token', state.token);
      renderAuthLinks();
      if(state.user?.role === 'owner') await refreshKhatmas();
      if(canUseManagedKhatmas()) await refreshManagedKhatmas();
      toast('تم تسجيل الدخول');
      location.hash = state.user?.role === 'owner' ? '#/owner' : (canUseManagedKhatmas() ? '#/dashboard' : '#/home');
    }catch(err){ toast(err.message || 'تعذر تسجيل الدخول'); }
  });
  const registerForm = document.getElementById('registerForm');
  registerForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    if(submit){ submit.disabled = true; submit.textContent = 'جاري إنشاء الحساب...'; }
    try{
      await api('/auth/register', {method:'POST', body:data});
      toast('تم إنشاء الحساب. سجل الدخول الآن.');
      registerForm.reset();
      document.querySelector('#loginForm input[name="username"]')?.focus();
    }catch(err){ toast(err.message || 'تعذر إنشاء الحساب'); }
    finally{ if(submit){ submit.disabled = false; submit.textContent = 'إنشاء الحساب'; } }
  });
}
async function logout(){
  try{ if(state.token) await api('/auth/logout', {method:'POST', body:{}}); }catch{}
  localStorage.removeItem('auth_token');
  state.token = '';
  state.user = null;
  renderAuthLinks();
  await refreshKhatmas();
  state.managedKhatmas = [];
  toast('تم تسجيل الخروج');
  location.hash = '#/home';
}
async function setupOwner(){
  const root = document.getElementById('ownerView');
  if(!state.user){ root.innerHTML = `<article class="feature-card"><h3>تسجيل الدخول مطلوب</h3><p>سجل الدخول بحساب المالك لإدارة المستخدمين.</p><a class="btn primary" href="#/login">تسجيل الدخول</a></article>`; return; }
  if(state.user.role !== 'owner'){ root.innerHTML = `<article class="feature-card"><h3>غير مصرح</h3><p>هذه الصفحة تظهر للمالك فقط.</p></article>`; return; }

  const createUserForm = document.getElementById('createUserForm');
  if(createUserForm){
    createUserForm.classList.add('collapsible-owner-form');
    createUserForm.hidden = !state.ownerCreateUserOpen;
    createUserForm.insertAdjacentHTML('beforebegin', `<div class="owner-toolbar glass"><div><h3>المستخدمون</h3><p>إدارة الحسابات المصرحة بإنشاء الختمات.</p></div><button class="btn primary compact-btn" id="toggleCreateUser" type="button">${state.ownerCreateUserOpen ? 'إخفاء النموذج' : '+ إضافة مستخدم'}</button></div>`);
    document.getElementById('toggleCreateUser')?.addEventListener('click', ()=>{ state.ownerCreateUserOpen = !state.ownerCreateUserOpen; router(); });
    createUserForm.addEventListener('submit', createUserFromOwnerPanel);
  }


  await Promise.all([renderUsers(), renderCreatorGroups()]);

  // Backup & Restore section
  const ownerRoot = document.getElementById('ownerView');
  if(ownerRoot){
    const backupHtml = `<div class="admin-panel premium-admin-panel" style="margin-top:28px">
      <div class="sheet-head"><h3>النسخ الاحتياطي والاستعادة</h3><span>بيانات النظام كاملاً</span></div>
      <p>تصدير جميع بيانات النظام (ختمات، قراء، مجموعات، مستخدمين، صلاحيات، قوالب) إلى ملف JSON يمكن استعادته لاحقاً.</p>
      <div class="compact-actions">
        <button class="btn primary compact-btn" id="downloadBackupBtn">⬇ تحميل نسخة احتياطية JSON</button>
        <button class="btn ghost compact-btn" id="downloadCsvBackupBtn">تصدير CSV شامل</button>
        <button class="btn ghost compact-btn danger-btn" id="restoreBackupBtn">↺ استعادة من نسخة احتياطية</button>
      </div>
      <input type="file" id="restoreFileInput" accept=".json" style="display:none" />
      <div id="restoreStatusMsg" style="display:none;margin-top:10px;padding:10px 14px;border-radius:14px;font-weight:800;font-size:14px"></div>
    </div>`;
    ownerRoot.insertAdjacentHTML('beforeend', backupHtml);
    document.getElementById('downloadBackupBtn')?.addEventListener('click', async () => {
      try{
        const res = await api('/system-backup');
        const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
        const fullBackup = { version: res.version, exportedAt: res.exportedAt, summary: res.summary, data: res.data };
        downloadTextFile(`khatmat-backup-${ts}.json`, JSON.stringify(fullBackup, null, 2), 'application/json');
        const s = res.summary || {};
        toast(`تم التصدير · ${s.users||0} مستخدم · ${s.managedKhatmas||0} ختمة مُدارة · ${s.readers||0} قارئ`);
      }catch(err){ toast(err.message||'تعذر التصدير'); }
    });
    document.getElementById('downloadCsvBackupBtn')?.addEventListener('click', async () => {
      try{
        const res = await api('/system-backup');
        const d = res.data;
        const ts = new Date().toISOString().slice(0,10);
        const files = [
          [`users-${ts}.csv`, rowsToCsv(d.users||[])],
          [`khatmas-${ts}.csv`, rowsToCsv((d.khatmas||[]).map(k=>({id:k.id,title:k.title,status:k.status,created_at:k.created_at})))],
          [`managed-khatmas-${ts}.csv`, rowsToCsv((d.managedKhatmas||[]).map(k=>({id:k.id,title:k.title,khatma_type:k.khatma_type,archived_at:k.archived_at||'',status:k.status,created_at:k.created_at})))],
          [`readers-${ts}.csv`, rowsToCsv(d.readers||[])],
          [`reader-groups-${ts}.csv`, rowsToCsv(d.readerGroups||[])],
          [`creator-groups-${ts}.csv`, rowsToCsv(d.creatorGroups||[])],
          [`permissions-${ts}.csv`, rowsToCsv(d.permissions||[])],
          [`templates-${ts}.csv`, rowsToCsv((d.khatmaTemplates||[]).map(t=>({id:t.id,name:t.name,created_at:t.created_at})))],
        ];
        for(const [name, csv] of files){ downloadTextFile(name, csv, 'text/csv;charset=utf-8'); await new Promise(r=>setTimeout(r,200)); }
        toast('تم تصدير ' + files.length + ' ملفات CSV');
      }catch(err){ toast(err.message||'تعذر التصدير'); }
    });

    // Restore
    const restoreBtn = document.getElementById('restoreBackupBtn');
    const restoreInput = document.getElementById('restoreFileInput');
    const restoreStatus = document.getElementById('restoreStatusMsg');
    const showRestoreStatus = (msg, ok=true) => {
      restoreStatus.textContent = msg;
      restoreStatus.style.display = 'block';
      restoreStatus.style.background = ok ? 'rgba(15,95,69,.12)' : 'rgba(157,63,63,.12)';
      restoreStatus.style.color = ok ? 'var(--primary)' : 'var(--danger)';
      restoreStatus.style.border = ok ? '1px solid rgba(15,95,69,.22)' : '1px solid rgba(157,63,63,.22)';
    };

    restoreBtn?.addEventListener('click', () => restoreInput?.click());

    restoreInput?.addEventListener('change', async () => {
      const file = restoreInput.files?.[0];
      if(!file){ return; }
      restoreInput.value = '';

      // Read file
      let parsed;
      try{
        const text = await file.text();
        parsed = JSON.parse(text);
      }catch(err){
        showRestoreStatus('تعذر قراءة الملف. تأكد أنه ملف JSON صالح.', false);
        return;
      }

      // Frontend validation
      if(parsed.version !== 'v5'){
        showRestoreStatus(`الملف غير متوافق (الإصدار: ${parsed.version || 'غير معروف'}). يجب أن يكون v5.`, false);
        return;
      }
      if(!parsed.data || !Array.isArray(parsed.data.users)){
        showRestoreStatus('الملف لا يحتوي على بيانات صالحة.', false);
        return;
      }

      const d = parsed.data;
      const exportedAt = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('ar-SA') : 'تاريخ غير معروف';
      const summary = [
        `${(d.users||[]).length} مستخدم`,
        `${(d.khatmas||[]).length} ختمة عادية`,
        `${(d.managedKhatmas||[]).length} ختمة مُدارة`,
        `${(d.readers||[]).length} قارئ`,
        `${(d.readerGroups||[]).length} مجموعة`,
        `${(d.permissions||[]).length} صلاحية`,
        `${(d.khatmaTemplates||[]).length} قالب`,
      ].join(' · ');

      const confirmed = await showConfirmModal({
        title: 'استعادة النظام من نسخة احتياطية',
        message: `النسخة المؤرخة: ${exportedAt}\n\nسيُستعاد:\n${summary}\n\n⚠ تحذير: سيُحذف جميع البيانات الحالية ويُستبدل بمحتوى هذا الملف. هذا الإجراء لا يمكن التراجع عنه.`,
        confirmText: 'استعادة الآن',
        danger: true
      });
      if(!confirmed) return;

      showRestoreStatus('جاري الاستعادة... لا تغلق الصفحة.', true);
      restoreBtn.disabled = true;
      try{
        const res = await api('/system-restore', { method:'POST', body: parsed });
        const r = res.restored || {};
        showRestoreStatus(
          `✓ تمت الاستعادة بنجاح · ${r.users||0} مستخدم · ${r.managedKhatmas||0} ختمة مُدارة · ${r.readers||0} قارئ · ${r.readerGroups||0} مجموعة`,
          true
        );
        toast('تمت الاستعادة — سيتم تحديث الصفحة');
        setTimeout(() => location.reload(), 2000);
      }catch(err){
        showRestoreStatus('فشلت الاستعادة: ' + (err.message || 'خطأ غير معروف'), false);
        restoreBtn.disabled = false;
      }
    });
  }
}

async function renderCreatorGroups(){
  const el = document.getElementById('creatorGroupsSection');
  if(!el) return;
  el.innerHTML = '<p style="color:var(--muted)">جاري التحميل...</p>';
  try{
    const [groupsRes, usersRes] = await Promise.all([api('/managed-creator-groups'), api('/users')]);
    const groups = groupsRes.groups || [];
    const users = (usersRes.users || []).filter(u => u.role !== 'owner' && u.status === 'active');
    const usersOpts = users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name||u.username)}</option>`).join('');
    el.innerHTML = `
      <div class="admin-panel premium-admin-panel">
        <div class="sheet-head"><h3>مجموعات منشئي الختمات</h3><span>الرؤية المشتركة للختمات المُدارة</span></div>
        <p style="color:var(--muted);font-size:14px">المنشئون في نفس المجموعة يرون ختماتهم المُدارة المشتركة في لوحة واحدة.</p>
        <form id="createCreatorGroupForm" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <input id="cgName" placeholder="اسم المجموعة" style="flex:1;min-width:180px" required />
          <button class="btn primary compact-btn" type="submit">+ إنشاء مجموعة</button>
        </form>
        <div id="creatorGroupsList">${groups.map(g => `
          <div class="owner-row" data-cg-id="${escapeHtml(g.id)}" style="flex-wrap:wrap;gap:8px">
            <div class="owner-row-main">
              <strong class="owner-row-title">${escapeHtml(g.name)}</strong>
              <span class="owner-row-meta">${(g.members||[]).map(m=>escapeHtml(m.display_name||m.username)).join('، ')||'لا أعضاء بعد'}</span>
            </div>
            <div class="owner-row-actions">
              <select id="addMember_${escapeHtml(g.id)}" style="height:38px;min-width:130px;border-radius:12px;font-size:13px">
                <option value="">إضافة منشئ...</option>${usersOpts}
              </select>
              <button class="btn ghost compact-btn" onclick="window.addCreatorMember('${escapeJs(g.id)}')">إضافة</button>
              <button class="btn ghost danger-btn compact-btn" onclick="window.deleteCreatorGroup('${escapeJs(g.id)}')">حذف</button>
            </div>
            ${(g.members||[]).length ? `<div style="width:100%;display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 0">${(g.members||[]).map(m=>`<span class="badge" style="font-size:12px">${escapeHtml(m.display_name||m.username)} <button onclick="window.removeCreatorMember('${escapeJs(g.id)}','${escapeJs(m.userId)}')" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;padding:0 2px;line-height:1">×</button></span>`).join('')}</div>` : ''}
          </div>`).join('') || '<p style="color:var(--muted);padding:8px 0">لا توجد مجموعات بعد.</p>'}
        </div>
      </div>`;

    document.getElementById('createCreatorGroupForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const name = document.getElementById('cgName')?.value.trim();
      if(!name){ toast('اسم المجموعة مطلوب'); return; }
      try{ await api('/managed-creator-groups', {method:'POST', body:{name}}); toast('تم إنشاء المجموعة'); renderCreatorGroups(); }
      catch(err){ toast(err.message||'تعذر الإنشاء'); }
    });
  }catch(err){ el.innerHTML = `<p style="color:var(--muted)">تعذر تحميل المجموعات</p>`; }
}
window.addCreatorMember = async function(groupId){
  const sel = document.getElementById('addMember_' + groupId);
  const userId = sel?.value; if(!userId){ toast('اختر منشئًا أولًا'); return; }
  try{ await api('/managed-creator-groups/' + encodeURIComponent(groupId) + '/members', {method:'POST', body:{userId}}); toast('تم إضافة المنشئ'); renderCreatorGroups(); }
  catch(err){ toast(err.message||'تعذر الإضافة'); }
};
window.removeCreatorMember = async function(groupId, userId){
  try{ await api('/managed-creator-groups/' + encodeURIComponent(groupId) + '/members/' + encodeURIComponent(userId), {method:'DELETE'}); toast('تم الحذف من المجموعة'); renderCreatorGroups(); }
  catch(err){ toast(err.message||'تعذر الحذف'); }
};
window.deleteCreatorGroup = async function(id){
  if(!confirm('حذف المجموعة؟')) return;
  try{ await api('/managed-creator-groups/' + encodeURIComponent(id), {method:'DELETE'}); toast('تم الحذف'); renderCreatorGroups(); }
  catch(err){ toast(err.message||'تعذر الحذف'); }
};




async function renderUsers(){
  const list = document.getElementById('usersList');
  try{
    const res = await api('/users');
    const users = res.users || [];
    list.innerHTML = users.map(userCardHtml).join('') || `<article class="feature-card empty-state"><h3>لا يوجد مستخدمون</h3></article>`;
  }catch(err){ list.innerHTML = `<article class="feature-card empty-state"><h3>تعذر تحميل المستخدمين</h3><p>${escapeHtml(err.message || '')}</p></article>`; }
}
function userCardHtml(u){
  const isOwner = u.role === 'owner';
  const resetOpen = state.activeResetUserId === u.id;
  const deleteOpen = state.activeDeleteUserId === u.id;
  const statusLabel = u.status === 'active' ? 'نشط' : 'معطل';
  const roleLabel = isOwner ? 'المالك' : 'منشئ ختمة';
  const managedEnabled = Boolean(u.managedKhatmaCreator || u.managed_khatma_creator);
  const resetBlock = resetOpen ? `<div class="inline-panel user-inline-panel action-sheet"><div class="sheet-head"><h4>إعادة تعيين كلمة المرور</h4><span>تحديث آمن</span></div><label>كلمة المرور الجديدة<input id="resetPassword_${u.id}" type="password" autocomplete="new-password" placeholder="اكتب كلمة المرور الجديدة" /></label><div class="compact-actions"><button class="btn primary compact-btn" onclick="confirmResetUserPassword('${u.id}')">حفظ</button><button class="btn ghost compact-btn" onclick="cancelUserInlineAction()">إلغاء</button></div></div>` : '';
  const deleteBlock = deleteOpen ? `<div class="inline-panel user-inline-panel action-sheet danger-inline"><div class="sheet-head"><h4>حذف المستخدم</h4><span>حذف نهائي</span></div><p>سيتم حذف المستخدم من قاعدة البيانات وتسجيل خروجه من جميع الجلسات. لن تُحذف الختمات السابقة.</p><div class="compact-actions"><button class="btn danger-btn compact-btn" onclick="confirmDeleteUser('${u.id}')">نعم، حذف</button><button class="btn ghost compact-btn" onclick="cancelUserInlineAction()">إلغاء</button></div></div>` : '';
  const actions = isOwner
    ? `<button class="btn ghost compact-btn" onclick="openResetUserPassword('${u.id}')">إعادة تعيين</button>`
    : `<button class="btn ghost compact-btn" onclick="openResetUserPassword('${u.id}')">إعادة تعيين</button><button class="btn ghost compact-btn" onclick="toggleManagedUserPermission('${u.id}',${managedEnabled ? 'false' : 'true'})">${managedEnabled ? 'إلغاء التحكم' : 'منشئ متحكم'}</button><button class="btn ghost compact-btn" onclick="toggleUserStatus('${u.id}','${u.status === 'active' ? 'disabled' : 'active'}')">${u.status === 'active' ? 'تعطيل' : 'تفعيل'}</button><button class="btn ghost danger-btn compact-btn" onclick="openDeleteUser('${u.id}')">حذف</button>`;
  return `<article class="owner-row user-row" data-user-id="${escapeHtml(u.id)}">
    <div class="owner-row-main">
      <strong class="owner-row-title">${escapeHtml(u.display_name || u.displayName || u.username)}</strong>
      <span class="owner-row-meta">${escapeHtml(u.username)} · ${roleLabel} · ${statusLabel}${managedEnabled ? ' · منشئ ختمات متحكم' : ''}</span>
    </div>
    <div class="owner-row-actions">${actions}</div>
    ${resetBlock}${deleteBlock}
  </article>`;
}
async function createUserFromOwnerPanel(e){
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector('button[type="submit"]');
  if(submit){ submit.disabled = true; submit.textContent = 'جاري الإنشاء...'; }
  try{
    const res = await api('/users', {method:'POST', body:data});
    form.reset();
    toast('تم إنشاء المستخدم');
    await renderUsers();
    if(res.user){ setTimeout(()=>document.querySelector(`[data-user-id="${CSS.escape(res.user.id)}"]`)?.scrollIntoView({behavior:'smooth', block:'center'}), 60); }
  }catch(err){
    toast(err.message || 'تعذر إنشاء المستخدم');
  }finally{
    if(submit){ submit.disabled = false; submit.textContent = 'إنشاء المستخدم'; }
  }
}
window.openResetUserPassword = function(id){
  state.activeResetUserId = id;
  state.activeDeleteUserId = '';
  renderUsers();
}
window.cancelUserInlineAction = function(){
  state.activeResetUserId = '';
  state.activeDeleteUserId = '';
  renderUsers();
}
window.confirmResetUserPassword = async function(id){
  const input = document.getElementById('resetPassword_' + id);
  const password = input?.value.trim() || '';
  if(!password){ toast('اكتب كلمة المرور الجديدة'); input?.focus(); return; }
  try{
    await api('/users/' + encodeURIComponent(id) + '/reset-password', {method:'POST', body:{password}});
    state.activeResetUserId = '';
    toast('تم تحديث كلمة المرور');
    await renderUsers();
  }catch(err){ toast(err.message || 'تعذر تحديث كلمة المرور'); }
}
window.openDeleteUser = function(id){
  state.activeDeleteUserId = id;
  state.activeResetUserId = '';
  renderUsers();
}
window.confirmDeleteUser = async function(id){
  try{
    await api('/users/' + encodeURIComponent(id), {method:'DELETE'});
    state.activeDeleteUserId = '';
    document.querySelector(`[data-user-id="${CSS.escape(id)}"]`)?.remove();
    toast('تم حذف المستخدم من قاعدة البيانات');
    await renderUsers();
  }catch(err){ toast(err.message || 'تعذر حذف المستخدم'); }
}
window.toggleUserStatus = async function(id, status){
  try{ await api('/users/' + encodeURIComponent(id) + '/status', {method:'POST', body:{status}}); toast(status === 'active' ? 'تم تفعيل المستخدم' : 'تم تعطيل المستخدم'); await renderUsers(); }
  catch(err){ toast(err.message || 'تعذر تحديث المستخدم'); }
}
window.toggleManagedUserPermission = async function(id, enabled){
  try{
    await api('/users/' + encodeURIComponent(id) + '/managed-permission', {method:'POST', body:{enabled}});
    toast(enabled ? 'تم منح صلاحية منشئ ختمات متحكم' : 'تم إلغاء صلاحية منشئ الختمات المتحكم');
    await renderUsers();
  }catch(err){ toast(err.message || 'تعذر تحديث صلاحية الختمات المُدارة'); }
}


function setupHome(){
  const hero = document.querySelector('.hero.grid-2');
  const heroCopy = document.querySelector('.hero-copy');
  const heroCard = document.querySelector('.hero-card');
  const features = document.querySelector('.features');

  // Features section has 2 cards after Zakat removal; force 2-column grid
  if(features) features.style.gridTemplateColumns = 'repeat(2, 1fr)';

  if(!state.user){
    // Anonymous: centre the hero, hide stats card
    if(hero){ hero.style.gridTemplateColumns = '1fr'; hero.style.textAlign = 'center'; hero.style.justifyItems = 'center'; }
    if(heroCopy){ heroCopy.style.maxWidth = '860px'; heroCopy.style.marginInline = 'auto'; }
    hero?.querySelectorAll('p').forEach(p => { p.style.marginInline = 'auto'; });
    if(heroCard) heroCard.style.display = 'none';
    return;
  }

  // Restore hero layout for logged-in users
  if(hero){ hero.style.gridTemplateColumns = ''; hero.style.textAlign = ''; hero.style.justifyItems = ''; }
  if(heroCopy){ heroCopy.style.maxWidth = ''; heroCopy.style.marginInline = ''; }
  hero?.querySelectorAll('p').forEach(p => { p.style.marginInline = ''; });
  if(heroCard){ heroCard.style.display = ''; heroCard.classList.remove('hidden'); }

  const isOwner = state.user.role === 'owner';

  if(!isOwner){
    // Non-owner managed creator: stats from managed khatmas
    const data = state.managedKhatmas;
    const total = data.length;
    const completed = data.filter(k => managedProgress(k).pct === 100).length;
    const open = data.filter(k => managedKhatmaStatus(k).key === 'active').length;
    const avg = total ? Math.round(data.reduce((s,k)=>s+managedProgress(k).pct,0)/total) : 0;
    document.getElementById('statKhatmas').textContent = total;
    document.getElementById('statDone').textContent = completed;
    document.getElementById('statOpen').textContent = open;
    document.getElementById('homeProgress').textContent = avg + '%';
    document.querySelector('.progress-ring')?.style.setProperty('--pct', avg + '%');
    return;
  }

  // Owner: stats from regular khatmas
  const total = state.khatmas.length;
  const completed = state.khatmas.filter(k => progress(k).pct === 100).length;
  const open = state.khatmas.filter(k => khatmaStatus(k).key === 'active').length;
  const avg = total ? Math.round(state.khatmas.reduce((s,k)=>s+progress(k).pct,0)/total) : 0;
  document.getElementById('statKhatmas').textContent = total;
  document.getElementById('statDone').textContent = completed;
  document.getElementById('statOpen').textContent = open;
  document.getElementById('homeProgress').textContent = avg + '%';
  document.querySelector('.progress-ring')?.style.setProperty('--pct', avg + '%');
}
function renderCustomUnitsPicker(section, division){
  const metaMap = {juz:{total:30,label:'الجزء'}, hizb:{total:60,label:'الحزب'}, quarter:{total:240,label:'الربع'}};
  const meta = metaMap[division] || metaMap.juz;
  const minW = meta.total > 60 ? 64 : meta.total > 30 ? 80 : 90;
  const items = Array.from({length:meta.total}, (_,i) => {
    const n = i + 1;
    return `<label class="unit-pick-label"><input type="checkbox" name="selectedUnit" value="${n}" checked />${meta.label} ${n}</label>`;
  }).join('');
  section.innerHTML = `<div class="custom-units-picker"><div class="sheet-head"><h4>اختر الأجزاء المتاحة للحجز</h4><span id="pickerCount">${meta.total} محدد</span></div><div class="custom-units-toolbar"><button class="btn ghost compact-btn" type="button" id="selectAllUnits">تحديد الكل</button><button class="btn ghost compact-btn" type="button" id="clearAllUnits">إلغاء الكل</button></div><div class="custom-units-grid" style="grid-template-columns:repeat(auto-fill,minmax(${minW}px,1fr))">${items}</div></div>`;
  const updateCount = () => {
    const count = section.querySelectorAll('input[name="selectedUnit"]:checked').length;
    const counter = section.querySelector('#pickerCount');
    if(counter) counter.textContent = count + ' محدد';
  };
  section.querySelector('#selectAllUnits')?.addEventListener('click', () => { section.querySelectorAll('input[name="selectedUnit"]').forEach(cb=>cb.checked=true); updateCount(); });
  section.querySelector('#clearAllUnits')?.addEventListener('click', () => { section.querySelectorAll('input[name="selectedUnit"]').forEach(cb=>cb.checked=false); updateCount(); });
  section.querySelectorAll('input[name="selectedUnit"]').forEach(cb => cb.addEventListener('change', updateCount));
}
function setupCreate(){
  const form = document.getElementById('createForm');
  if(!state.user){
    form.outerHTML = `<article class="feature-card empty-state"><h3>تسجيل الدخول مطلوب</h3><p>إنشاء الختمات مخصص للحسابات التي يضيفها المالك.</p><a class="btn primary" href="#/login">تسجيل الدخول</a></article>`;
    return;
  }
  const templateBtn = document.getElementById('loadKhatmaTemplate');
  const previewBtn = document.getElementById('previewKhatmaMessage');
  const dateInput = form.querySelector('[name="khatmaDate"]');
  fillDefaultCoordinatorName(form);
  splitCoordinatorPhoneIntoFields(form, '');
  templateBtn?.addEventListener('click', ()=>openKhatmaTemplatesDialog(form));
  dateInput?.addEventListener('change', ()=>updateDateFields(form));
  previewBtn?.addEventListener('click', ()=>previewCreateMessage(form));
  const selectionModeSelect = form.querySelector('[name="selectionMode"]');
  const divisionSelect = form.querySelector('[name="division"]');
  const customSection = document.getElementById('customUnitsSection');
  function syncCustomPicker(){ const isCustom = selectionModeSelect?.value === 'custom'; if(customSection){ customSection.hidden = !isCustom; if(isCustom) renderCustomUnitsPicker(customSection, divisionSelect?.value || 'juz'); } }
  selectionModeSelect?.addEventListener('change', syncCustomPicker);
  divisionSelect?.addEventListener('change', syncCustomPicker);
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    delete data.selectedUnit;
    prepareCoordinatorFields(e.currentTarget, data);
    data.ownerKey = getOwnerKey();
    if(data.selectionMode === 'custom'){ const checked = e.currentTarget.querySelectorAll('input[name="selectedUnit"]:checked'); const selectedUnits = Array.from(checked).map(cb=>Number(cb.value)); if(!selectedUnits.length){ toast('يجب اختيار جزء واحد على الأقل'); return; } data.selectedUnits = selectedUnits; }
    try{
      const res = await api('/khatmas', {method:'POST', body:data});
      sessionStorage.setItem('admin_code_' + res.khatma.id, res.adminCode);
      state.khatmas.unshift({...res.khatma, adminCode: res.adminCode});
      toast('تم حفظ الختمة');
      location.hash = '#/khatma/' + res.khatma.id + '/manage';
    }catch(err){ console.error(err); toast(err.message || 'تعذر حفظ الختمة'); }
  });
}
const KHATMA_TEMPLATE_FIELDS = [
  'title', 'weekNumber', 'khatmaType', 'khatmaDate', 'hijriDate', 'gregorianDate', 'expiresAt',
  'division', 'selectionMode', 'coordinatorName', 'quoteBy', 'quoteSource', 'quoteText', 'dedication', 'notes'
];
function khatmaTemplateDataFromForm(form){
  const data = {};
  KHATMA_TEMPLATE_FIELDS.forEach(name => {
    const el = form.querySelector(`[name="${name}"]`);
    if(el) data[name] = el.value || '';
  });
  data.coordinatorWhatsapp = normalizeLocalPhone(form.querySelector('[name="coordinatorWhatsappLocal"]')?.value || '');
  if((data.selectionMode || '') === 'custom'){
    data.selectedUnits = selectedManagedUnitNumbers(form);
  }
  return data;
}
function applyKhatmaTemplateData(form, data={}){
  KHATMA_TEMPLATE_FIELDS.forEach(name => {
    const el = form.querySelector(`[name="${name}"]`);
    if(el && data[name] !== undefined && data[name] !== null) el.value = data[name];
  });
  const phone = form.querySelector('[name="coordinatorWhatsappLocal"]');
  if(phone && data.coordinatorWhatsapp !== undefined) phone.value = normalizeLocalPhone(data.coordinatorWhatsapp || '');

  const division = form.querySelector('[name="division"]');
  const selectionMode = form.querySelector('[name="selectionMode"]');
  division?.dispatchEvent(new Event('change', {bubbles:true}));
  selectionMode?.dispatchEvent(new Event('change', {bubbles:true}));

  if(Array.isArray(data.selectedUnits) && data.selectedUnits.length){
    const selected = new Set(data.selectedUnits.map(Number));
    form.querySelectorAll('input[name="selectedUnit"]').forEach(cb => {
      cb.checked = selected.has(Number(cb.value));
      cb.dispatchEvent(new Event('change', {bubbles:true}));
    });
    const counter = form.querySelector('#pickerCount');
    if(counter) counter.textContent = selected.size + ' محدد';
  }
  if(data.khatmaDate && (!data.hijriDate || !data.gregorianDate)) updateDateFields(form);
  syncManagedAssignments(form);
  toast('تم تحميل بيانات القالب');
}
async function openKhatmaTemplatesDialog(form){
  if(!state.user){ toast('تسجيل الدخول مطلوب'); return; }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal-card template-modal-card" role="dialog" aria-modal="true">
    <div class="sheet-head"><h3>قوالب الختمات</h3><span>محفوظة في قاعدة البيانات</span></div>
    <p>اختر قالبًا محفوظًا لتحميل بياناته، أو احفظ بيانات النموذج الحالي كقالب جديد.</p>
    <div class="template-save-row">
      <input id="newTemplateName" placeholder="اسم القالب الجديد" autocomplete="off" />
      <button class="btn primary compact-btn" id="saveCurrentTemplate" type="button">حفظ الحالي كقالب</button>
    </div>
    <div id="templatesList" class="template-list"><article class="feature-card empty-state"><h3>جاري التحميل...</h3></article></div>
    <div class="modal-actions"><button class="btn ghost" id="closeTemplatesDialog" type="button">إغلاق</button></div>
  </div>`;
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector('#templatesList');
  let templates = [];
  const close = () => backdrop.remove();
  const renderTemplates = () => {
    list.innerHTML = templates.length ? templates.map(t => `<article class="owner-row template-row" data-template-id="${escapeHtml(t.id)}">
      <div class="owner-row-main">
        <strong class="owner-row-title">${escapeHtml(t.name)}</strong>
        <span class="owner-row-meta">${escapeHtml((t.updatedAt || t.createdAt || '').slice(0,10))}</span>
      </div>
      <div class="owner-row-actions">
        <button class="btn primary compact-btn" type="button" data-template-load="${escapeHtml(t.id)}">تحميل</button>
        <button class="btn ghost danger-btn compact-btn" type="button" data-template-delete="${escapeHtml(t.id)}">حذف</button>
      </div>
    </article>`).join('') : `<article class="feature-card empty-state"><h3>لا توجد قوالب محفوظة</h3><p>املأ النموذج ثم احفظه كقالب لاستخدامه لاحقًا.</p></article>`;
  };
  async function loadTemplates(){
    list.innerHTML = `<article class="feature-card empty-state"><h3>جاري تحميل القوالب...</h3></article>`;
    try{
      const res = await api('/khatma-templates');
      templates = res.templates || [];
      renderTemplates();
    }catch(err){
      list.innerHTML = `<article class="feature-card empty-state"><h3>تعذر تحميل القوالب</h3><p>${escapeHtml(err.message || '')}</p></article>`;
    }
  }
  backdrop.querySelector('#closeTemplatesDialog')?.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if(e.target === backdrop) close(); });
  backdrop.querySelector('#saveCurrentTemplate')?.addEventListener('click', async () => {
    const input = backdrop.querySelector('#newTemplateName');
    const name = input?.value.trim() || '';
    if(!name){ toast('اكتب اسم القالب'); input?.focus(); return; }
    try{
      const res = await api('/khatma-templates', {method:'POST', body:{name, data:khatmaTemplateDataFromForm(form)}});
      templates.unshift(res.template);
      input.value = '';
      renderTemplates();
      toast('تم حفظ القالب');
    }catch(err){ toast(err.message || 'تعذر حفظ القالب'); }
  });
  list.addEventListener('click', async event => {
    const loadBtn = event.target.closest('[data-template-load]');
    const deleteBtn = event.target.closest('[data-template-delete]');
    if(loadBtn){
      const template = templates.find(t => t.id === loadBtn.dataset.templateLoad);
      if(template){ applyKhatmaTemplateData(form, template.data || {}); close(); }
      return;
    }
    if(deleteBtn){
      const template = templates.find(t => t.id === deleteBtn.dataset.templateDelete);
      if(!template) return;
      const ok = await showConfirmModal({title:'حذف القالب', message:`حذف قالب "${template.name}"؟`, confirmText:'حذف', danger:true});
      if(!ok) return;
      try{
        await api('/khatma-templates/' + encodeURIComponent(template.id), {method:'DELETE'});
        templates = templates.filter(t => t.id !== template.id);
        renderTemplates();
        toast('تم حذف القالب');
      }catch(err){ toast(err.message || 'تعذر حذف القالب'); }
    }
  });
  loadTemplates();
}
function previewCreateMessage(form){
  const data = Object.fromEntries(new FormData(form).entries());
  const draft = {
    id: 'preview',
    title: data.title || 'ختمة القرآن',
    weekNumber: data.weekNumber || '-',
    khatmaType: data.khatmaType || 'monthly',
    hijriDate: data.hijriDate || '',
    gregorianDate: data.gregorianDate || '',
    dedication: data.dedication || '',
    quoteBy: data.quoteBy || '',
    quoteText: data.quoteText || '',
    quoteSource: data.quoteSource || '',
    notes: data.notes || ''
  };
  const box = document.getElementById('createPreviewBox');
  if(!box) return;
  box.hidden = false;
  box.innerHTML = `<div class="sheet-head"><h3>معاينة رسالة المشاركة</h3><span>قبل الحفظ</span></div><div class="message-preview">${escapeHtml(buildWhatsAppMessage(draft)).replace(/#\/khatma\/preview/g, '#/khatma/بعد-الحفظ')}</div>`;
  box.scrollIntoView({behavior:'smooth', block:'nearest'});
}
function setupKhatmas(){
  const list = document.getElementById('khatmaList');
  if(!state.khatmas.length){
    list.classList.remove('khatma-rows-list', 'khatma-rows-list-v3', 'khatma-rows-list-v32');
    list.innerHTML = `<article class="feature-card empty-state"><h3>لا توجد ختمات أنشأتها بعد</h3><p>ابدأ بإنشاء ختمة جديدة.</p><a class="btn primary" href="#/create">إنشاء ختمة</a></article>`;
    return;
  }
  list.classList.add('khatma-rows-list', 'khatma-rows-list-v3', 'khatma-rows-list-v32');
  const toolbar = `<div class="khatma-list-toolbar v32 glass">
    <div class="khatma-list-toolbar-title"><h3>قائمة الختمات</h3><p>${state.khatmas.length} ختمة محفوظة</p></div>
    <div class="icon-action-group v32">
      <button class="icon-action v32" type="button" onclick="exportKhatmasCsv()" title="تصدير ملف CSV يفتح في Excel وNumbers وGoogle Sheets"><span aria-hidden="true">⇩</span><strong>CSV / Excel</strong></button>
      <button class="icon-action v32" type="button" onclick="printKhatmasList()" title="طباعة أو حفظ PDF"><span aria-hidden="true">⎙</span><strong>طباعة / PDF</strong></button>
    </div>
  </div>`;
  const rows = state.khatmas.map(k => khatmaListRowHtml(k)).join('');
  list.innerHTML = toolbar + rows;
}
function khatmaListRowHtml(k){
  const p = progress(k); const status = khatmaStatus(k);
  const meta = [k.hijriDate || '', k.gregorianDate || ''].filter(Boolean).join(' - ') || 'لا يوجد تاريخ محدد';
  return `<article class="khatma-list-row v32 glass">
    <div class="khatma-list-main v32">
      <div class="khatma-list-content v32">
        <div class="khatma-list-badges v32">
          <span class="mini-pill v32">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : 'ختمة')}</span>
          <span class="mini-pill v32 status ${status.className}">${status.label}</span>
        </div>
        <div class="khatma-list-titleline v32">
          <h3>${escapeHtml(k.title)}</h3>
          <p>${escapeHtml(meta)}</p>
        </div>
      </div>
      <div class="khatma-list-side v32">
        <div class="khatma-list-progress v32"><strong>${p.pct}%</strong><span>${p.completed} مكتمل · ${p.reserved} محجوز / جاري</span></div>
        <div class="khatma-list-actions v32">
          <a class="mini-icon-btn primary v32" href="#/khatma/${k.id}" title="فتح"><span aria-hidden="true">↗</span><strong>فتح</strong></a>
          <a class="mini-icon-btn v32" href="#/khatma/${k.id}/manage" title="إدارة"><span aria-hidden="true">⚙</span><strong>إدارة</strong></a>
        </div>
      </div>
    </div>
  </article>`;
}

window.openAdminFromList = (id) => { location.hash = '#/khatma/' + id + '/manage'; };

function managedUnitMeta(division){
  if(division === 'hizb') return {total:60,label:'الحزب'};
  if(division === 'quarter') return {total:240,label:'الربع'};
  return {total:30,label:'الجزء'};
}
function managedProgress(k){
  const completed = (k.units || []).filter(u=>u.status==='completed').length;
  const active = (k.units || []).filter(u=>u.status==='assigned' || u.status==='reading').length;
  return {completed, active, pct: k.units?.length ? Math.round((completed / k.units.length) * 100) : 0};
}
function khatmaFallbackLabel(){ return state.user?.role === 'owner' ? 'ختمة مُدارة' : 'ختمة'; }
function managedKhatmaStatus(k){
  const p = managedProgress(k);
  if(k.status === 'closed') return {key:'closed', label:'مغلقة بواسطة المنشئ', className:'closed'};
  if(p.pct === 100) return {key:'completed', label:'مكتملة', className:'done'};
  if(isExpired(k)) return {key:'expired', label:'انتهت مدة الختمة', className:'closed'};
  return {key:'active', label: state.user?.role === 'owner' ? 'الختمة المُدارة جارية' : 'الختمة جارية', className:''};
}
function managedStatusLabel(status){
  return ({available:'غير معيّن', assigned:'مُعيّن للقارئ', reading:'جاري القراءة', completed:'تمت القراءة'}[status] || 'غير معيّن');
}
function managedRandomCode(){
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
}
function managedParticipantRows(){
  return Array.from(document.querySelectorAll('[data-managed-participant-row]')).map(row => ({
    id: row.dataset.participantId || '',
    readerProfileId: row.dataset.readerProfileId || '',
    groupId: row.dataset.groupId || '',
    name: row.querySelector('[data-participant-name]')?.value.trim() || '',
    phone: normalizeLocalPhone(row.querySelector('[data-participant-phone]')?.value || ''),
    accessCode: row.querySelector('[data-participant-code]')?.value.replace(/\D/g,'') || '',
    notes: row.querySelector('[data-participant-notes]')?.value.trim() || '',
    startJuz: Number(row.querySelector('[data-start-juz]')?.value || 0) || null,
    partsCount: Number(row.querySelector('[data-parts-count]')?.value || 0) || null
  })).filter(p => p.name || p.phone || p.accessCode || p.notes);
}
function managedParticipantOptions(participants, selected=''){
  const clean = participants.filter(p => p.name && p.accessCode);
  return `<option value="">اختر القارئ</option>` + clean.map(p => {
    // Use accessCode as value — simpler, works for both create and update flows
    const isSelected = String(selected) === String(p.accessCode) ||
                       String(selected) === String(p.readerProfileId || '') ||
                       String(selected) === String(p.id || '');
    return `<option value="${escapeHtml(p.accessCode)}" data-reader-id="${escapeHtml(p.readerProfileId || p.id || '')}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.name)}${p.phone ? ' - ' + escapeHtml(p.phone) : ''}</option>`;
  }).join('');
}
function applyAssignmentsToGrid(form, assignments){
  if(!assignments || !Object.keys(assignments).length) return;
  const grid = form.querySelector('#managedAssignmentsGrid, [data-managed-assignments-grid]');
  if(!grid) return;
  grid.querySelectorAll('[data-managed-unit-assignment]').forEach(select => {
    const code = String(assignments[Number(select.dataset.managedUnitAssignment)] || '');
    if(!code) return;
    // Try exact value match first (value = accessCode now)
    if(Array.from(select.options).some(o => o.value === code)){
      select.value = code;
    }
  });
  syncManagedAssignmentCounter(form);
}
function managedParticipantRowHtml(p={}, index=0){
  const readerProfileId = p.readerProfileId || (p.createdByUserId ? p.id : '');
  // Always preserve the participant's existing ID so the backend can match it
  // and avoid re-generating a new ID (which would unassign their units).
  const participantId = p.id || '';
  return `<div class="managed-table-row" data-managed-participant-row data-participant-id="${escapeHtml(participantId)}" data-reader-profile-id="${escapeHtml(readerProfileId)}" data-group-id="${escapeHtml(p.groupId || '')}">
    <label>الاسم<input data-participant-name value="${escapeHtml(p.name || p.participantName || '')}" placeholder="اسم القارئ" /></label>
    <label>الجوال<input data-participant-phone value="${escapeHtml(normalizeLocalPhone(p.phone || ''))}" inputmode="tel" placeholder="05XXXXXXXX" /></label>
    <label>الكود<input data-participant-code value="${escapeHtml(p.accessCode || managedRandomCode())}" inputmode="numeric" maxlength="10" placeholder="4-10 أرقام" /></label>
    <label>ملاحظات<input data-participant-notes value="${escapeHtml(p.notes || '')}" placeholder="اختياري" /></label>
    <input type="hidden" data-start-juz value="${escapeHtml(String(p.startJuz || ''))}" />
    <input type="hidden" data-parts-count value="${escapeHtml(String(p.partsCount || ''))}" />
    <button class="btn ghost danger-btn compact-btn" type="button" data-remove-managed-participant="${index}">حذف</button>
  </div>`;
}
function renderManagedParticipantRows(container, participants){
  const list = participants.length ? participants : [{accessCode: managedRandomCode()}];
  container.innerHTML = list.map(managedParticipantRowHtml).join('');
}
function selectedManagedUnitNumbers(form){
  const division = form.querySelector('[name="division"]')?.value || 'juz';
  const meta = managedUnitMeta(division);
  const selectionMode = form.querySelector('[name="selectionMode"]')?.value || 'all';
  if(selectionMode !== 'custom') return Array.from({length:meta.total}, (_,i)=>i+1);
  const selected = Array.from(form.querySelectorAll('input[name="selectedUnit"]:checked')).map(cb=>Number(cb.value));
  return selected.length ? selected : [];
}
function currentManagedAssignments(container){
  const out = {};
  container?.querySelectorAll('[data-managed-unit-assignment]').forEach(select => { out[select.dataset.managedUnitAssignment] = select.value; });
  return out;
}
function syncManagedAssignments(form, existingAssignments={}){
  const grid = form.querySelector('#managedAssignmentsGrid, [data-managed-assignments-grid]');
  const count = form.querySelector('#managedAssignmentCount, [data-managed-assignment-count]');
  if(!grid) return;
  const previous = {...existingAssignments, ...currentManagedAssignments(grid)};
  const participants = managedParticipantRows();
  const division = form.querySelector('[name="division"]')?.value || 'juz';
  const meta = managedUnitMeta(division);
  const unitNumbers = selectedManagedUnitNumbers(form);
  grid.innerHTML = unitNumbers.map(num => `<label class="managed-assignment-item">${meta.label} ${num}<select data-managed-unit-assignment="${num}">${managedParticipantOptions(participants, previous[num] || '')}</select></label>`).join('');
  const assigned = unitNumbers.filter(num => grid.querySelector(`[data-managed-unit-assignment="${num}"]`)?.value).length;
  if(count) count.textContent = `${assigned} تعيين من ${unitNumbers.length}`;
  grid.querySelectorAll('select').forEach(select => select.addEventListener('change', () => syncManagedAssignmentCounter(form)));
}
function syncManagedAssignmentCounter(form){
  const grid = form.querySelector('#managedAssignmentsGrid, [data-managed-assignments-grid]');
  const count = form.querySelector('#managedAssignmentCount, [data-managed-assignment-count]');
  if(!grid || !count) return;
  const selects = Array.from(grid.querySelectorAll('[data-managed-unit-assignment]'));
  count.textContent = `${selects.filter(s=>s.value).length} تعيين من ${selects.length}`;
}
function setupManagedEditor(form, khatma=null){
  fillDefaultCoordinatorName(form);
  splitCoordinatorPhoneIntoFields(form, khatma?.coordinatorWhatsapp || '');
  const participantsBox = form.querySelector('#managedParticipantsRows, [data-managed-participants-rows]');
  const customSection = form.querySelector('#managedCustomUnitsSection, [data-managed-custom-units-section]');
  const divisionSelect = form.querySelector('[name="division"]');
  const selectionModeSelect = form.querySelector('[name="selectionMode"]');
  const initialAssignments = {};
  const participantById = {};
  (khatma?.participants || []).forEach(p => { if(p.id) participantById[p.id] = p; });
  (khatma?.units || []).forEach(unit => {
    if(unit.participantId){
      const p = participantById[unit.participantId];
      initialAssignments[unit.number] = p?.accessCode || unit.participantId;
    }
  });
  if(participantsBox) renderManagedParticipantRows(participantsBox, khatma?.participants || []);
  function syncCustom(){
    const isCustom = selectionModeSelect?.value === 'custom';
    if(customSection){
      customSection.hidden = !isCustom;
      if(isCustom){
        renderCustomUnitsPicker(customSection, divisionSelect?.value || 'juz');
        if(khatma?.selectionMode === 'custom'){
          const selected = new Set((khatma.units || []).map(u=>u.number));
          customSection.querySelectorAll('input[name="selectedUnit"]').forEach(cb => cb.checked = selected.has(Number(cb.value)));
        }
        customSection.querySelectorAll('input[name="selectedUnit"]').forEach(cb => cb.addEventListener('change', () => syncManagedAssignments(form, initialAssignments)));
      }
    }
    syncManagedAssignments(form, initialAssignments);
  }
  participantsBox?.addEventListener('input', () => syncManagedAssignments(form, initialAssignments));
  participantsBox?.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-managed-participant]');
    if(remove){
      const row = remove.closest('[data-managed-participant-row]');
      row?.remove();
      if(!participantsBox.querySelector('[data-managed-participant-row]')) renderManagedParticipantRows(participantsBox, [{accessCode: managedRandomCode()}]);
      syncManagedAssignments(form, initialAssignments);
    }
  });
  form.querySelector('#addManagedParticipant, [data-add-managed-participant]')?.addEventListener('click', () => {
    participantsBox?.insertAdjacentHTML('beforeend', managedParticipantRowHtml({accessCode: managedRandomCode()}, participantsBox.children.length));
    syncManagedAssignments(form, initialAssignments);
  });
  form.querySelector('#generateManagedCodes, [data-generate-managed-codes]')?.addEventListener('click', () => {
    participantsBox?.querySelectorAll('[data-participant-code]').forEach(input => { input.value = managedRandomCode(); });
    syncManagedAssignments(form, initialAssignments);
  });
  divisionSelect?.addEventListener('change', syncCustom);
  selectionModeSelect?.addEventListener('change', syncCustom);
  form.querySelector('[name="khatmaDate"]')?.addEventListener('change', ()=>updateDateFields(form));
  syncCustom();
}
function managedEditorPayload(form){
  const data = Object.fromEntries(new FormData(form).entries());
  delete data.selectedUnit;
  prepareCoordinatorFields(form, data);
  data.participants = managedParticipantRows();
  if(data.selectionMode === 'custom'){
    data.selectedUnits = selectedManagedUnitNumbers(form);
    if(!data.selectedUnits.length) throw new Error('يجب اختيار وحدة واحدة على الأقل');
  }
  const assignments = {};
  form.querySelectorAll('[data-managed-unit-assignment]').forEach(select => {
    assignments[select.dataset.managedUnitAssignment] = select.value;
  });
  data.unitAssignments = assignments;
  return data;
}
function csvEscape(value){ return '"' + String(value ?? '').replace(/"/g, '""') + '"'; }
function managedTemplateCsv(){
  return '\ufeff' + ['name,phone,accessCode,start_juz,parts_count,unitNumbers,notes', ['اسم قارئ تجريبي','05XXXXXXXX',managedRandomCode(),'27','7','',''].map(csvEscape).join(',')].join('\n');
}
function parseCsvRows(text){
  const rows = [];
  let row = [], value = '', inQuotes = false;
  for(let i=0;i<String(text||'').length;i++){
    const ch = text[i], next = text[i+1];
    if(ch === '"' && inQuotes && next === '"'){ value += '"'; i++; }
    else if(ch === '"'){ inQuotes = !inQuotes; }
    else if(ch === ',' && !inQuotes){ row.push(value); value = ''; }
    else if((ch === '\n' || ch === '\r') && !inQuotes){ if(ch === '\r' && next === '\n') i++; row.push(value); if(row.some(x=>x.trim())) rows.push(row); row=[]; value=''; }
    else value += ch;
  }
  row.push(value); if(row.some(x=>x.trim())) rows.push(row);
  if(!rows.length) return [];
  const headers = rows.shift().map(h=>h.trim().replace(/^\ufeff/,''));
  return rows.map(cols => Object.fromEntries(headers.map((h,i)=>[h, cols[i] || ''])));
}
function unitNumberList(value=''){
  return String(value || '').split(/[;,،\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
}
function juzSequence(startJuz, partsCount){
  const start = Number(startJuz);
  const count = Number(partsCount || 1);
  if(!Number.isInteger(start) || start < 1 || start > 30 || !Number.isInteger(count) || count < 1) return [];
  return Array.from({length: count}, (_, i) => ((start - 1 + i) % 30) + 1);
}
function getHijriParts(date){
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',{year:'numeric',month:'numeric',day:'numeric'}).formatToParts(d);
  return {year:Number(parts.find(p=>p.type==='year').value),month:Number(parts.find(p=>p.type==='month').value),day:Number(parts.find(p=>p.type==='day').value)};
}
function hijriMonthName(m){
  return ['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'][m-1]||'';
}
function hijriMonthEndDate(date){
  const d=new Date(date instanceof Date?date:new Date(date));
  d.setHours(12,0,0,0);
  const {year:y,month:m}=getHijriParts(d);
  for(let i=0;i<35;i++){d.setDate(d.getDate()+1);const n=getHijriParts(d);if(n.year!==y||n.month!==m){d.setDate(d.getDate()-1);return new Date(d);}}
  return new Date(d);
}
function getHijriMonthAtOffset(startDate,offset){
  if(!startDate) return {year:0,month:1,name:''};
  const sh=getHijriParts(new Date(startDate));
  const total=(sh.month-1)+offset;
  const year=sh.year+Math.floor(total/12);
  const month=(total%12)+1;
  return {year,month,name:hijriMonthName(month)};
}
function computeRotationJuz(startJuz, partsCount, periodIndex){
  const total = 30;
  const start = Number(startJuz); const count = Number(partsCount || 0); const period = Number(periodIndex || 0);
  if(!Number.isInteger(start) || start < 1 || start > 30 || !Number.isInteger(count) || count < 1) return [];
  const offset = period * count;
  return Array.from({length: count}, (_, i) => ((start - 1 + offset + i) % total) + 1);
}
function computeCurrentPeriodEnd(rotationStartDate, rotationType){
  if(!rotationStartDate || !rotationType || rotationType === 'none') return null;
  if(rotationType === 'monthly') return hijriMonthEndDate(new Date());
  if(rotationType === 'weekly'){
    const start = new Date(rotationStartDate);
    const idx = Math.floor((Date.now() - start) / (7 * 86400000));
    const d = new Date(start.getTime() + (idx + 1) * 7 * 86400000);
    d.setDate(d.getDate() - 1);
    return d;
  }
  if(rotationType === 'yearly'){
    const start = new Date(rotationStartDate);
    const idx = computeCurrentPeriodIndex(rotationStartDate, 'yearly');
    return new Date(start.getTime() + (idx + 1) * 365 * 86400000);
  }
  return null;
}
function computeCurrentPeriodIndex(rotationStartDate, rotationType){
  if(!rotationStartDate) return 0;
  const start = new Date(rotationStartDate);
  const now = new Date();
  if(now <= start) return 0;
  if(rotationType === 'monthly'){
    const sh = getHijriParts(start);
    const nh = getHijriParts(now);
    return Math.max(0, (nh.year - sh.year) * 12 + (nh.month - sh.month));
  }
  if(rotationType === 'weekly') return Math.floor((now - start) / (7 * 86400000));
  if(rotationType === 'yearly'){
    const sh = getHijriParts(start);
    const nh = getHijriParts(now);
    return Math.max(0, nh.year - sh.year);
  }
  return 0;
}
function rotationPeriodsFromDuration(rotationType, durationYears){
  const y = Number(durationYears) || 5;
  if(rotationType === 'weekly') return y * 52;
  if(rotationType === 'monthly') return y * 12;
  if(rotationType === 'yearly') return y;
  return y * 12;
}
function generateRotationPlan(startJuz, partsCount, rotationStartDate, rotationType, periods, durationYears){
  const n = periods || rotationPeriodsFromDuration(rotationType, durationYears || 5);
  return Array.from({length: n}, (_, i) => ({
    period: i + 1,
    juz: computeRotationJuz(startJuz, partsCount, i)
  }));
}
function formatPeriodEnd(rotationStartDate, rotationType){
  const end = computeCurrentPeriodEnd(rotationStartDate, rotationType);
  if(!end) return '';
  // Always return Gregorian date with remaining-days suffix
  const dateStr = end.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {day:'numeric', month:'long', year:'numeric'}).replace('،','').trim();
  const msLeft = end.getTime() + 86400000 - Date.now(); // include the end-day itself
  const daysLeft = Math.ceil(msLeft / 86400000);
  if(daysLeft > 0) return `${dateStr} · متبقي ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'}`;
  return dateStr;
}
// ── Date-only helpers (timezone-safe) ────────────────────────────────────────
// "YYYY-MM-DD" strings must be treated as local calendar dates, not UTC midnight.
// new Date("2026-06-08") parses as 00:00 UTC which is wrong for UTC+N timezones.

/** Parse a "YYYY-MM-DD" (or ISO datetime) value as midnight in the LOCAL timezone. */
function parseDateOnlyLocal(value){
  if(!value) return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local midnight
}

/** Midnight of the given date (or today) in local time. */
function startOfLocalDay(date){
  const d = date ? new Date(date) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** True if the date-string represents today or a past date (local calendar). */
function hasDateStarted(dateValue){
  if(!dateValue) return true;
  const target = parseDateOnlyLocal(dateValue);
  if(!target) return true;
  return target <= startOfLocalDay();
}

/**
 * Full calendar days from today (local) until dateValue.
 * Returns 0 if today, 1 if tomorrow, negative if already past.
 */
function daysUntilDate(dateValue){
  const target = parseDateOnlyLocal(dateValue);
  if(!target) return 0;
  return Math.round((target - startOfLocalDay()) / 86400000);
}
// ─────────────────────────────────────────────────────────────────────────────

function khatmaHasStarted(rotationStart){
  if(!rotationStart) return true; // no start date → treat as already started
  return hasDateStarted(rotationStart);
}
function currentHijriPeriodLabel(rotationStartDate, rotationType){
  if(rotationType === 'monthly'){
    const {year, month} = getHijriParts(new Date());
    return `${hijriMonthName(month)} ${year} هـ`;
  }
  if(rotationType === 'weekly'){
    const idx = computeCurrentPeriodIndex(rotationStartDate, 'weekly');
    return `الأسبوع ${idx + 1}`;
  }
  return '';
}
function csvRowsToManagedData(rows){
  const participants = [];
  const assignments = {};
  rows.forEach(row => {
    const name = row.name || row['اسم القارئ'] || row.reader || '';
    const phone = normalizeLocalPhone(row.phone || row['رقم الجوال'] || '');
    const rawCode = String(row.accessCode || row.code || row['الكود'] || '').replace(/\D/g,'').slice(0,10);
    const accessCode = (rawCode.length >= 4 && rawCode.length <= 10) ? rawCode : managedRandomCode();
    const notes = row.notes || row['ملاحظات'] || '';
    const country = String(row.country || row['الدولة'] || '').trim();
    const startJuz = Number(row.start_juz || row.startJuz || row['بداية الجزء'] || 0) || null;
    const partsCount = Number(row.parts_count || row.partsCount || row['عدد الأجزاء'] || 0) || null;
    if(!name && !phone && !accessCode) return;
    const reader = {name, phone, accessCode, notes, country, startJuz, partsCount};
    participants.push(reader);
    const explicitUnits = unitNumberList(row.unitNumbers || row.units || row['الأجزاء'] || '');
    const generatedUnits = explicitUnits.length ? explicitUnits : juzSequence(startJuz, partsCount);
    generatedUnits.forEach(num => { assignments[num] = reader.accessCode; });
  });
  return {participants, assignments};
}
async function importManagedCsvIntoForm(file, form){
  const text = await file.text();
  const {participants, assignments} = csvRowsToManagedData(parseCsvRows(text));
  if(!participants.length){ toast('ملف CSV لا يحتوي قراء'); return; }
  const box = form.querySelector('#managedParticipantsRows, [data-managed-participants-rows]');
  renderManagedParticipantRows(box, participants);
  syncManagedAssignments(form, assignments);
  toast('تم استيراد القراء والتعيينات من CSV');
}
async function setupManagedReaders(){
  const root = document.getElementById('managedReadersView');
  if(!canUseManagedKhatmas()){ root.innerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3><p>هذه الصفحة للمالك أو منشئ الختمات المتحكم فقط.</p></article>`; return; }
  // Patch page-head eyebrow for non-owners
  if(state.user?.role !== 'owner'){
    const eyebrow = document.querySelector('.page-head .eyebrow');
    if(eyebrow && eyebrow.textContent.includes('مُدارة')) eyebrow.textContent = 'القراء';
  }

  let groups = [];
  try{ const res = await api('/managed-reader-groups'); groups = res.groups || []; }catch(err){ toast(err.message || 'تعذر تحميل المجموعات'); }
  state.managedReaderGroups = groups;
  await refreshManagedReaders();

  const groupById = Object.fromEntries(groups.map(g => [g.id, g]));
  const readersByGroup = {};
  const ungrouped = [];
  state.managedReaders.forEach(r => {
    if(r.groupId){ (readersByGroup[r.groupId] = readersByGroup[r.groupId] || []).push(r); }
    else ungrouped.push(r);
  });

  const rotationLabel = t => t === 'weekly' ? 'أسبوعي' : t === 'monthly' ? 'شهري' : t === 'yearly' ? 'سنوي' : 'بلا تدوير';
  const groupOptionsHtml = groups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');

  const groupsHtml = groups.map(g => {
    const shareBtn = state.user?.role === 'owner'
      ? `<button class="mini-icon-btn v32" onclick="window.openShareReaderGroup('${escapeJs(g.id)}')" title="مشاركة"><span aria-hidden="true">⇌</span><strong>مشاركة</strong></button>`
      : '';
    const sharedBadge = g.shared_creator_group_id ? `<span class="mini-pill v32" style="background:rgba(15,95,69,.13);color:var(--primary)">مشارك</span>` : '';
    return `<article class="khatma-list-row v32 glass">
      <div class="khatma-list-main v32">
        <div class="khatma-list-content v32">
          <div class="khatma-list-badges v32">
            <span class="mini-pill v32">${escapeHtml(rotationLabel(g.rotation_type))}</span>
            ${sharedBadge}
          </div>
          <div class="khatma-list-titleline v32">
            <h3>${escapeHtml(g.name)}</h3>
            <p>${g.readerCount || 0} قارئ${g.rotation_start_date ? ' · بدأ ' + escapeHtml(g.rotation_start_date.slice(0,10)) : ''}</p>
          </div>
        </div>
        <div class="khatma-list-side v32">
          <div class="khatma-list-actions v32">
            <a class="mini-icon-btn primary v32" href="#/reader-group/${escapeHtml(g.id)}" title="عرض"><span aria-hidden="true">↗</span><strong>عرض</strong></a>
            <a class="mini-icon-btn v32" href="#/reader-group/${escapeHtml(g.id)}/manage" title="إدارة"><span aria-hidden="true">⚙</span><strong>إدارة</strong></a>
            ${shareBtn}
          </div>
        </div>
      </div>
    </article>`;
  }).join('');

  root.innerHTML = `
    <input id="readersCsvFile" type="file" accept=".csv,text/csv" hidden />

    <div class="admin-panel premium-admin-panel" style="margin-bottom:20px">
      <div class="sheet-head"><h3>إنشاء مجموعة جديدة</h3><span>منظّم القراء</span></div>
      <form id="createGroupForm">
        <div class="form-grid">
          <label>اسم المجموعة<input id="groupName" required placeholder="مثال: مجموعة القراء 1" /></label>
          <label>نوع التدوير<select id="groupRotationType">
            <option value="weekly">أسبوعي</option><option value="monthly" selected>شهري</option>
            <option value="yearly">سنوي</option><option value="none">بلا تدوير</option>
          </select></label>
          <label>مدة الخطة<select id="groupDurationYears">${rotationDurationOptions(5)}</select></label>
          <label>تاريخ بدء الدورة الأولى<input id="groupRotationStart" type="date" /></label>
          <label>ملاحظات<input id="groupNotes" placeholder="اختياري" /></label>
        </div>
        <button class="btn primary compact-btn" type="submit" style="margin-top:10px">إنشاء المجموعة</button>
      </form>
    </div>

    ${groups.length ? groupsHtml : '<article class="feature-card empty-state"><h3>لا توجد مجموعات بعد</h3><p>أنشئ مجموعة لتنظيم قرائك وربطهم بالختمات المُدارة.</p></article>'}

    ${ungrouped.length ? `<article class="inline-panel action-sheet" style="margin-top:16px">
      <div class="sheet-head"><h3>قراء بلا مجموعة</h3><span>${ungrouped.length} قارئ</span></div>
      <div class="managed-table">${ungrouped.map(r => readerRowHtml(r)).join('')}</div>
    </article>` : ''}

    <div id="addReaderPanel" class="admin-panel premium-admin-panel" style="margin-top:20px;display:none">
      <div class="sheet-head"><h3 id="addReaderPanelTitle">إضافة / تعديل قارئ</h3></div>
      <form id="managedReaderForm">
        <div class="form-grid">
          <label>اسم القارئ<input name="name" required /></label>
          <label>رقم الجوال<input name="phone" inputmode="tel" placeholder="05XXXXXXXX" /></label>
          <label>الكود (4-10 أرقام)<input name="accessCode" inputmode="numeric" maxlength="10" value="${managedRandomCode()}" /></label>
          <label>الدولة<select name="country">
            <option value="">— اختياري —</option>
            <option value="السعودية">السعودية</option>
            <option value="البحرين">البحرين</option>
            <option value="الكويت">الكويت</option>
            <option value="عُمان">عُمان</option>
            <option value="اليمن">اليمن</option>
            <option value="العراق">العراق</option>
            <option value="إيران">إيران</option>
            <option value="قطر">قطر</option>
            <option value="الإمارات">الإمارات</option>
            <option value="الأردن">الأردن</option>
            <option value="أخرى">أخرى</option>
          </select></label>
          <label id="serialCodeFieldLabel" style="display:none">الرقم التسلسلي<input name="serialCode" readonly placeholder="يُولَّد تلقائيًا" style="opacity:0.65;cursor:default" /></label>
          <label>المجموعة<select name="groupId"><option value="">بلا مجموعة</option>${groupOptionsHtml}</select></label>
          <label>بداية الجزء<input name="startJuz" type="number" min="1" max="30" placeholder="مثال: 4" /></label>
          <label>عدد الأجزاء / دورة<input name="partsCount" type="number" min="1" max="30" placeholder="مثال: 4" /></label>
          <label class="full">ملاحظات<input name="notes" /></label>
        </div>
        <div class="compact-actions" style="margin-top:10px">
          <button class="btn primary compact-btn" type="submit">حفظ القارئ</button>
          <button class="btn ghost compact-btn" type="button" onclick="window.closeAddReaderPanel()">إلغاء</button>
          <button class="btn ghost compact-btn" type="button" id="downloadReadersTemplate">قالب CSV</button>
        </div>
      </form>
    </div>`;

  document.getElementById('createGroupForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('groupName')?.value.trim() || '';
    if(!name){ toast('اسم المجموعة مطلوب'); return; }
    try{
      await api('/managed-reader-groups', {method:'POST', body:{
        name, rotationType: document.getElementById('groupRotationType')?.value || 'monthly',
        rotationDurationYears: Number(document.getElementById('groupDurationYears')?.value || 5),
        rotationStartDate: document.getElementById('groupRotationStart')?.value || '',
        notes: document.getElementById('groupNotes')?.value.trim() || ''
      }});
      toast('تم إنشاء المجموعة'); state.editGroupId = ''; setupManagedReaders();
    }catch(err){ toast(err.message || 'تعذر إنشاء المجموعة'); }
  });

  document.getElementById('managedReaderForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    data.phone = normalizeLocalPhone(data.phone || '');
    delete data.serialCode; // auto-generated, never user-supplied
    if(form.dataset.readerId) data.id = form.dataset.readerId;
    try{
      await api('/managed-readers', {method:'POST', body:{readers:[data], groupId: data.groupId || ''}});
      toast('تم حفظ القارئ'); form.dataset.readerId = ''; window.closeAddReaderPanel(); setupManagedReaders();
    }catch(err){ toast(err.message || 'تعذر حفظ القارئ'); }
  });

  document.getElementById('downloadReadersTemplate')?.addEventListener('click',()=>downloadTextFile('managed-readers-template.csv', managedTemplateCsvExtended(), 'text/csv;charset=utf-8'));

  document.getElementById('readersCsvFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]; if(!file) return;
    const gId = e.target.dataset.groupId || '';
    const {participants} = csvRowsToManagedData(parseCsvRows(await file.text()));
    if(!participants.length){ toast('ملف CSV لا يحتوي قراء'); e.target.value=''; return; }
    const body = {readers: participants}; if(gId) body.groupId = gId;
    try{ await api('/managed-readers', {method:'POST', body}); toast('تم استيراد القراء'); setupManagedReaders(); }
    catch(err){ toast(err.message || 'تعذر استيراد القراء'); }
    e.target.value = '';
  });

  // Bind edit group form submits
  groups.forEach(g => {
    document.getElementById(`editGroupForm_${g.id}`)?.addEventListener('submit', async e => {
      e.preventDefault();
      const name = document.getElementById(`gName_${g.id}`)?.value.trim() || '';
      if(!name){ toast('اسم المجموعة مطلوب'); return; }
      try{
        await api('/managed-reader-groups/' + encodeURIComponent(g.id), {method:'POST', body:{
          name, rotationType: document.getElementById(`gType_${g.id}`)?.value || 'monthly',
          rotationStartDate: document.getElementById(`gStart_${g.id}`)?.value || '',
          notes: document.getElementById(`gNotes_${g.id}`)?.value.trim() || ''
        }});
        toast('تم تحديث المجموعة'); state.editGroupId = ''; setupManagedReaders();
      }catch(err){ toast(err.message || 'تعذر تحديث المجموعة'); }
    });
  });
}
function readerRowHtml(r, groupId){
  const editCall = groupId
    ? `window.openEditReaderInGroup('${escapeJs(r.id)}')`
    : `fillManagedReader('${escapeJs(r.id)}')`;
  // Store data on row for group-context edit
  const rData = escapeHtml(JSON.stringify({name:r.name||'',phone:r.phone||'',accessCode:r.accessCode||'',country:r.country||'',serialCode:r.serialCode||'',startJuz:r.startJuz||'',partsCount:r.partsCount||'',notes:r.notes||''}));
  const sharedBadge = r.sharedCreatorGroupId ? `<span class="mini-pill v32" style="background:rgba(15,95,69,.13);color:var(--primary);font-size:11px;margin-right:4px">مشارك</span>` : '';
  const shareBtn = state.user?.role === 'owner' ? `<button class="btn ghost compact-btn" onclick="window.openShareReader('${escapeJs(r.id)}')">مشاركة</button>` : '';
  return `<div class="owner-row" data-reader-row-id="${escapeHtml(r.id)}" data-reader-data='${rData}'><div class="owner-row-main"><strong class="owner-row-title">${escapeHtml(r.name)}${sharedBadge}</strong><span class="owner-row-meta">${r.serialCode ? escapeHtml(r.serialCode) + ' · ' : ''}${escapeHtml(normalizeLocalPhone(r.phone||'')||'بلا جوال')} · كود: ${escapeHtml(r.accessCode)}${r.country ? ' · ' + escapeHtml(r.country) : ''}${r.startJuz ? ' · ج' + r.startJuz + '×' + r.partsCount : ''}${r.ownerName ? ' · ' + escapeHtml(r.ownerName) : ''}</span></div><div class="owner-row-actions"><button class="btn ghost compact-btn" onclick="${editCall}">تعديل</button>${shareBtn}<button class="btn ghost danger-btn compact-btn" onclick="deleteManagedReader('${escapeJs(r.id)}')">حذف</button></div></div>`;
}
window.openEditReaderInGroup = function(readerId){
  // Find reader data from DOM row
  const row = document.querySelector(`[data-reader-row-id="${CSS.escape(readerId)}"]`);
  let r = {id: readerId};
  try{ if(row?.dataset.readerData) r = {...r, ...JSON.parse(row.dataset.readerData.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'"))}; }catch{}
  const panel = document.getElementById('addReaderInline');
  if(!panel) return;
  panel.hidden = false;
  const form = document.getElementById('addReaderGroupForm'); if(!form) return;
  form.dataset.readerId = readerId;
  ['name','phone','accessCode','country','startJuz','partsCount','notes'].forEach(f => {
    const el = form.querySelector(`[name="${f}"]`);
    if(el) el.value = f === 'phone' ? normalizeLocalPhone(r[f]||'') : (r[f]||'');
  });
  // Show serial code as read-only if available
  const scInput2 = form.querySelector('[name="serialCode"]');
  if(scInput2){ scInput2.value = r.serialCode || ''; const scLbl = scInput2.closest('label'); if(scLbl) scLbl.style.display = r.serialCode ? '' : 'none'; }
  panel.scrollIntoView({behavior:'smooth',block:'center'});
};
window.openShareReader = async function(readerId){
  // إزالة أي panel مفتوح مسبقاً
  document.querySelectorAll('[id^="shareReaderPanel_"]').forEach(el => el.remove());
  const row = document.querySelector(`[data-reader-row-id="${CSS.escape(readerId)}"]`);
  if(!row) return;
  const container = document.createElement('div');
  container.id = 'shareReaderPanel_' + readerId;
  row.after(container);
  container.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:6px 0">جاري تحميل المجموعات…</p>';
  try {
    const res = await api('/managed-creator-groups');
    const creatorGroups = res.groups || [];
    const readerObj = (state.managedReaders || []).find(r => r.id === readerId) || {};
    const currentShared = readerObj.sharedCreatorGroupId || '';
    const opts = creatorGroups.map(cg => `<option value="${escapeHtml(cg.id)}" ${currentShared === cg.id ? 'selected' : ''}>${escapeHtml(cg.name)}</option>`).join('');
    container.innerHTML = `<div class="inline-panel action-sheet" style="margin:4px 0 8px"><div class="sheet-head"><h4>مشاركة القارئ مع منشئين</h4><span>الوصول المشترك</span></div>
      <label style="display:block;margin-bottom:8px">المجموعة<select id="shareReaderSelect_${escapeHtml(readerId)}" style="width:100%;margin-top:4px">
        <option value="">— بلا مشاركة —</option>${opts}
      </select></label>
      <div class="compact-actions">
        <button class="btn primary compact-btn" id="confirmShareReaderBtn_${escapeHtml(readerId)}">حفظ</button>
        <button class="btn ghost compact-btn" id="cancelShareReaderBtn_${escapeHtml(readerId)}">إلغاء</button>
      </div></div>`;
    document.getElementById(`cancelShareReaderBtn_${readerId}`)?.addEventListener('click', ()=>{ container.remove(); });
    document.getElementById(`confirmShareReaderBtn_${readerId}`)?.addEventListener('click', async ()=>{
      const selGroupId = document.getElementById(`shareReaderSelect_${readerId}`)?.value || '';
      try {
        await api('/managed-readers/' + encodeURIComponent(readerId) + '/share', {method:'POST', body:{groupId: selGroupId || null}});
        const idx = (state.managedReaders || []).findIndex(r => r.id === readerId);
        if(idx >= 0) state.managedReaders[idx] = {...state.managedReaders[idx], sharedCreatorGroupId: selGroupId || ''};
        toast(selGroupId ? 'تمت المشاركة مع المجموعة' : 'تم إلغاء المشاركة');
        container.remove();
        setupManagedReaders();
      } catch(err){ toast(err.message || 'تعذرت المشاركة'); }
    });
  } catch(err){ container.innerHTML = `<p style="color:var(--danger);padding:6px 0">${escapeHtml(err.message || 'تعذر تحميل المجموعات')}</p>`; }
};
window.openAddReaderToGroup = function(groupId){
  const panel = document.getElementById('addReaderPanel'); if(!panel) return;
  panel.style.display = 'block';
  const form = document.getElementById('managedReaderForm'); if(!form) return;
  form.dataset.readerId = '';
  form.reset();
  form.querySelector('[name="accessCode"]').value = managedRandomCode();
  const scLabel = document.getElementById('serialCodeFieldLabel'); if(scLabel) scLabel.style.display = 'none';
  if(groupId){ const sel = form.querySelector('[name="groupId"]'); if(sel) sel.value = groupId; }
  document.getElementById('addReaderPanelTitle').textContent = 'إضافة قارئ';
  panel.scrollIntoView({behavior:'smooth', block:'center'});
};
window.closeAddReaderPanel = function(){
  const panel = document.getElementById('addReaderPanel'); if(panel) panel.style.display = 'none';
};
window.openEditGroup = function(id){
  state.editGroupId = state.editGroupId === id ? '' : id;
  setupManagedReaders();
};
window.closeEditGroup = function(){
  state.editGroupId = ''; setupManagedReaders();
};
window.uploadGroupCsv = function(groupId){
  const input = document.getElementById('readersCsvFile'); if(!input) return;
  input.dataset.groupId = groupId; input.click();
};
window.exportGroupCsv = function(groupId){
  const readers = state.managedReaders.filter(r => r.groupId === groupId);
  if(!readers.length){ toast('لا يوجد قراء في هذه المجموعة'); return; }
  const rows = readers.map(r => ({name:r.name, phone:normalizeLocalPhone(r.phone||''), accessCode:r.accessCode, start_juz:r.startJuz||'', parts_count:r.partsCount||'', notes:r.notes||''}));
  downloadTextFile('readers-group.csv', rowsToCsv(rows), 'text/csv;charset=utf-8');
};
window.deleteReaderGroup = async function(id){
  if(!confirm('حذف المجموعة؟ ستُفكّ ارتباطات القراء بها، لكنهم لن يُحذفوا.')) return;
  try{ await api('/managed-reader-groups/' + encodeURIComponent(id), {method:'DELETE'}); toast('تم حذف المجموعة'); setupManagedReaders(); }
  catch(err){ toast(err.message || 'تعذر حذف المجموعة'); }
};
window.filterReadersByGroup = function(groupId){ state.activeReadersGroupId = groupId; setupManagedReaders(); };
function rotationDurationOptions(selected=5){
  return Array.from({length:15},(_,i)=>i+1).map(y=>`<option value="${y}" ${Number(selected)===y?'selected':''}>${y} ${y===1?'سنة':'سنوات'}</option>`).join('');
}
function managedTemplateCsvExtended(){
  return '﻿' + ['name,phone,accessCode,country,start_juz,parts_count,unitNumbers,notes',
    ['اسم قارئ تجريبي','05XXXXXXXX',managedRandomCode(),'السعودية','1','1','','ملاحظة اختيارية'].map(csvEscape).join(',')].join('\n');
}
window.fillManagedReader = function(id){
  const r = state.managedReaders.find(x=>x.id===id); if(!r) return;
  const panel = document.getElementById('addReaderPanel'); if(panel) panel.style.display = '';
  const form = document.getElementById('managedReaderForm'); if(!form) return;
  form.dataset.readerId = r.id;
  form.querySelector('[name="name"]').value = r.name || '';
  form.querySelector('[name="phone"]').value = normalizeLocalPhone(r.phone || '');
  form.querySelector('[name="accessCode"]').value = r.accessCode || '';
  form.querySelector('[name="notes"]').value = r.notes || '';
  const cSel = form.querySelector('[name="country"]'); if(cSel) cSel.value = r.country || '';
  const scInput = form.querySelector('[name="serialCode"]'); if(scInput) scInput.value = r.serialCode || '';
  const scLabel = document.getElementById('serialCodeFieldLabel');
  if(scLabel) scLabel.style.display = r.serialCode ? '' : 'none';
  document.getElementById('addReaderPanelTitle').textContent = 'تعديل قارئ';
  const gSel = form.querySelector('[name="groupId"]'); if(gSel) gSel.value = r.groupId || '';
  const sj = form.querySelector('[name="startJuz"]'); if(sj) sj.value = r.startJuz || '';
  const pc = form.querySelector('[name="partsCount"]'); if(pc) pc.value = r.partsCount || '';
  form.scrollIntoView({behavior:'smooth', block:'center'});
}
window.deleteManagedReader = async function(id){
  try{ await api('/managed-readers/' + encodeURIComponent(id), {method:'DELETE'}); toast('تم حذف القارئ'); setupManagedReaders(); }
  catch(err){ toast(err.message || 'تعذر حذف القارئ'); }
}
async function setupReaderLogin(){
  const view = document.getElementById('readerLoginView');
  const savedIdentity = localStorage.getItem('reader_portal_identity') || '';

  view.innerHTML = `
    <section class="page-head">
      <span class="eyebrow">بوابة القراء</span>
      <h1>لوحة القارئ</h1>
      <p>أدخل كودك أو رقم جوالك أو اسمك لعرض جميع ختماتك وأجزائك المخصصة.</p>
    </section>
    <section class="form-card glass" style="max-width:560px;margin-inline:auto;margin-bottom:24px">
      <form id="readerPortalForm">
        <label style="margin-top:0">الكود أو رقم الجوال أو الاسم
          <input id="readerPortalIdentity" autocomplete="off" inputmode="text"
            placeholder="مثال: 1234 أو 05XXXXXXXX أو اسم القارئ"
            value="${escapeHtml(savedIdentity)}" style="margin-top:6px" />
        </label>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn primary" type="submit" id="readerPortalBtn" style="flex:1">عرض ختماتي</button>
          <button class="btn ghost" type="button" id="readerPortalClear" style="padding:14px 16px">مسح</button>
        </div>
      </form>
    </section>
    <div id="readerPortalResult"></div>`;

  document.getElementById('readerPortalClear')?.addEventListener('click', () => {
    localStorage.removeItem('reader_portal_identity');
    document.getElementById('readerPortalIdentity').value = '';
    document.getElementById('readerPortalResult').innerHTML = '';
  });

  async function doLookup(identity) {
    const btn = document.getElementById('readerPortalBtn');
    const result = document.getElementById('readerPortalResult');
    if(btn){ btn.disabled = true; btn.textContent = 'جاري البحث...'; }
    try{
      const res = await api('/reader-portal', {method:'POST', body:{identity}});
      localStorage.setItem('reader_portal_identity', identity);
      const khatmas = res.khatmas || [];
      if(!khatmas.length){
        result.innerHTML = `<article class="feature-card empty-state"><h3>لم يتم العثور على نتائج</h3><p>تأكد من الكود أو رقم الجوال أو الاسم وأعد المحاولة.</p></article>`;
        return;
      }

      // Cumulative statistics (across all khatmas)
      const allUnits = khatmas.flatMap(k => k.units || []);
      const totalDone = allUnits.filter(u=>u.status==='completed').length;
      const totalAssigned = allUnits.filter(u=>u.status!=='available').length;
      const totalPct = totalAssigned ? Math.round(totalDone/totalAssigned*100) : 0;
      const profile = res.readerProfile || null;
      const readerName = profile?.name || khatmas[0]?.participants?.find(p=>p.name)?.name || '';

      // ── Welcome header ─────────────────────────────────────────────
      const welcomeHtml = readerName ? `
        <div class="inline-panel action-sheet" style="margin-bottom:14px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <span style="color:var(--muted);font-size:12px;display:block;margin-bottom:2px">مرحبًا بك</span>
            <strong style="font-size:16px">${escapeHtml(readerName)}</strong>
            ${(profile?.serialCode || profile?.country) ? `<span style="color:var(--muted);font-size:12px;margin-top:3px;display:block">${[profile.serialCode, profile.country].filter(Boolean).map(escapeHtml).join(' · ')}</span>` : ''}
          </div>
          <button class="btn ghost compact-btn" id="readerLogoutBtn">تسجيل الخروج</button>
        </div>` : '';

      // ── Cumulative stats block ─────────────────────────────────────
      const statsHtml = `
        <section class="khatma-detail glass" style="margin-top:8px">
          <div class="sheet-head"><h3>إحصائياتك التجميعية</h3><span>منذ أول ختمة</span></div>
          <div class="mini-stats">
            <div><strong>${khatmas.length}</strong><span>ختمة شاركت فيها</span></div>
            <div><strong>${totalDone}</strong><span>جزء أكملته</span></div>
            <div><strong>${totalPct}%</strong><span>نسبة الإنجاز الكلية</span></div>
          </div>
        </section>`;

      // ── Bind logout ───────────────────────────────────────────────
      function bindLogout(){
        document.getElementById('readerLogoutBtn')?.addEventListener('click', () => {
          localStorage.removeItem('reader_portal_identity');
          Object.keys(localStorage).filter(k=>k.startsWith('managed_identity_')).forEach(k=>localStorage.removeItem(k));
          document.getElementById('readerPortalIdentity').value = '';
          result.innerHTML = '';
          toast('تم تسجيل الخروج');
        });
      }

      // ── Bind "تمت القراءة" buttons with confirm ───────────────────
      function bindCompleteActions(){
        result.querySelectorAll('[data-portal-action="complete"]').forEach(btn2 => {
          btn2.addEventListener('click', async () => {
            const khatmaId = btn2.dataset.khatma;
            const unitNum  = btn2.dataset.unit;
            const unitLabel = btn2.dataset.unitLabel || ('الجزء رقم ' + unitNum);
            const id2      = btn2.dataset.identity;
            const confirmed = await showConfirmModal({
              title: 'تأكيد إتمام القراءة',
              message: `هل فعلًا أتممت قراءة ${unitLabel}؟`,
              confirmLabel: 'نعم، أتممت القراءة',
              cancelLabel: 'إلغاء'
            });
            if(!confirmed) return;
            try{
              await api(`/managed-khatmas/${encodeURIComponent(khatmaId)}/units/${unitNum}/complete`, {method:'POST', body:{identity:id2}});
              toast('تمت القراءة بنجاح');
              await doLookup(identity);
            }catch(err){ toast(err.message||'تعذر التحديث'); }
          });
        });
      }

      // ── Render one khatma's unit cards ────────────────────────────
      function renderKhatmaUnits(k){
        const displayUnits = (k.units || []);
        // rotationStart: used for rotation period calculations (period index, period label, period end)
        const rotationStart = k.rotationStartDate || k.khatmaDate || k.createdAt || '';
        // khatmaStartRef: used ONLY to decide if the khatma has started.
        // khatmaDate takes priority because it is the admin-set start date and is always
        // updated when the khatma is edited. rotationStartDate may reflect an older group
        // rotation cycle that differs from the khatma's actual start date.
        const khatmaStartRef = k.khatmaDate || k.rotationStartDate || k.createdAt || '';
        const started = khatmaHasStarted(khatmaStartRef);

        // Khatma hasn't started yet → show a clear notice instead of units
        if(!started){
          const startDate = parseDateOnlyLocal(khatmaStartRef);
          const startDateStr = startDate.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {day:'numeric', month:'long', year:'numeric'}).replace('،','').trim();
          const daysUntil = daysUntilDate(khatmaStartRef);
          const daysStr = daysUntil === 1 ? 'يوم واحد' : `${daysUntil} أيام`;
          return `
            <article class="form-card glass" style="margin-bottom:18px">
              <h3 style="margin:0 0 14px;font-size:18px">${escapeHtml(k.title)}</h3>
              <div class="inline-panel action-sheet" style="text-align:center;padding:24px 16px">
                <p style="margin:0 0 6px;font-size:16px;font-weight:700">الختمة لم تبدأ بعد.</p>
                <p style="margin:0;color:var(--muted);font-size:14px">تبدأ في: ${startDateStr}${daysUntil > 0 ? ' · متبقي ' + daysStr : ''}</p>
              </div>
            </article>`;
        }

        const periodLabel = (k.khatmaType === 'monthly' || k.khatmaType === 'weekly')
          ? (currentHijriPeriodLabel(rotationStart, k.khatmaType) || '')
          : '';
        const status = managedKhatmaStatus(k);
        const done = displayUnits.filter(u=>u.status==='completed').length;
        const total = displayUnits.length;
        const allDone = total > 0 && done === total;
        const periodEndStr = formatPeriodEnd(rotationStart, k.khatmaType);
        return `
          <article class="form-card glass" style="margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap;gap:8px">
              <div>
                <h3 style="margin:0;font-size:18px">${escapeHtml(k.title)}</h3>
                <span style="color:var(--muted);font-size:13px">${periodLabel ? 'الفترة: ' + escapeHtml(periodLabel) + ' · ' : ''}${done}/${total} مكتمل${periodEndStr ? ' · ينتهي: ' + escapeHtml(periodEndStr) : ''}</span>
              </div>
              <span class="badge ${allDone ? 'done' : status.className}">${allDone ? '✓ مكتمل' : status.label}</span>
            </div>
            <div class="units-grid" style="grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px;margin-bottom:0">
              ${displayUnits.map(unit => {
                const lbl = {assigned:'مُعيّن',reading:'جاري القراءة',completed:'تمت القراءة'}[unit.status]||'متاح';
                const canComplete = unit.status === 'assigned' || unit.status === 'reading';
                return `<article class="unit ${unit.status}">
                  <strong style="font-size:13px">${escapeHtml(unit.label)}</strong>
                  <small><span class="status-dot" style="font-size:11px">${lbl}</span></small>
                  ${canComplete ? `<div class="unit-actions"><button class="btn primary" style="font-size:12px;padding:7px" data-portal-action="complete" data-khatma="${escapeHtml(k.id)}" data-unit="${unit.number}" data-unit-label="${escapeHtml(unit.label)}" data-identity="${escapeHtml(identity)}">تمت القراءة</button></div>` : ''}
                </article>`;
              }).join('') || '<p style="color:var(--muted);grid-column:1/-1;font-size:13px">لا توجد أجزاء مُعيّنة لك في هذه الختمة.</p>'}
            </div>
          </article>`;
      }

      // ── Single khatma: go directly to dedicated page ──────────────
      if(khatmas.length === 1){
        location.hash = '#/reader-khatma/' + khatmas[0].id;
        return;
      }

      // ── Multiple khatmas: list with links to dedicated pages ───────
      function renderKhatmaList(){
        const listHtml = khatmas.map(k => {
          const status = managedKhatmaStatus(k);
          const units = k.units || [];
          const done  = units.filter(u=>u.status==='completed').length;
          const total = units.length;
          const allDone = total > 0 && done === total;
          return `
            <article class="form-card glass" style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <div>
                  <h3 style="margin:0;font-size:17px">${escapeHtml(k.title)}</h3>
                  <span style="color:var(--muted);font-size:13px">${done}/${total} مكتمل${k.hijriDate ? ' · ' + escapeHtml(k.hijriDate) : ''}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="badge ${allDone ? 'done' : status.className}">${allDone ? '✓ مكتمل' : status.label}</span>
                  <a class="btn ghost compact-btn" href="#/reader-khatma/${escapeHtml(k.id)}">عرض أجزائي →</a>
                </div>
              </div>
            </article>`;
        }).join('');
        result.innerHTML = welcomeHtml + listHtml + statsHtml;
        bindLogout();
      }

      renderKhatmaList();

    }catch(err){
      result.innerHTML = `<article class="feature-card empty-state"><h3>${escapeHtml(err.message||'تعذر البحث')}</h3></article>`;
    }finally{ if(btn){ btn.disabled=false; btn.textContent='عرض ختماتي'; } }
  }

  const form = document.getElementById('readerPortalForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const identity = document.getElementById('readerPortalIdentity')?.value.trim() || '';
    if(!identity){ toast('أدخل الكود أو رقم الجوال أو اسمك أولًا'); return; }
    doLookup(identity);
  });

  if(savedIdentity) doLookup(savedIdentity);
}
window.openReaderKhatma = function(khatmaId, identity){
  localStorage.setItem('managed_identity_' + khatmaId, identity);
  sessionStorage.setItem('managed_identity_' + khatmaId, identity);
  location.hash = '#/managed-khatma/' + khatmaId;
};

async function setupReaderKhatma(khatmaId){
  const view = document.getElementById('readerKhatmaView');
  const identity = localStorage.getItem('reader_portal_identity') || '';
  if(!identity){ location.hash = '#/reader-login'; return; }
  if(!khatmaId){ view.innerHTML = `<article class="feature-card empty-state"><h3>معرف الختمة غير صحيح</h3><a class="btn primary" href="#/reader-login">← ختماتي</a></article>`; return; }

  view.innerHTML = `<article class="feature-card empty-state"><h3>جاري التحميل...</h3></article>`;
  try{
    const res = await api('/reader-portal', {method:'POST', body:{identity}});
    const khatmas = res.khatmas || [];
    const profile = res.readerProfile || null;
    const khatma = khatmas.find(k => k.id === khatmaId);
    if(!khatma){
      view.innerHTML = `
        <section class="page-head"><span class="eyebrow">بوابة القراء</span><h1>الختمة غير موجودة</h1></section>
        <article class="feature-card empty-state">
          <h3>لم يتم العثور على هذه الختمة ضمن ختماتك</h3>
          <a class="btn primary" href="#/reader-login">← ختماتي</a>
        </article>`;
      return;
    }
    const readerName = profile?.name || khatma.participants?.find(p=>p.name)?.name || '';
    const rotationStart = khatma.rotationStartDate || khatma.khatmaDate || khatma.createdAt || '';
    const khatmaStartRef = khatma.khatmaDate || khatma.rotationStartDate || khatma.createdAt || '';
    const started = khatmaHasStarted(khatmaStartRef);

    let unitsHtml;
    if(!started){
      const startDate = parseDateOnlyLocal(khatmaStartRef);
      const startDateStr = startDate.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'long',year:'numeric'}).replace('،','').trim();
      const daysUntil = daysUntilDate(khatmaStartRef);
      unitsHtml = `
        <div class="inline-panel action-sheet" style="text-align:center;padding:24px 16px">
          <p style="margin:0 0 6px;font-size:16px;font-weight:700">الختمة لم تبدأ بعد.</p>
          <p style="margin:0;color:var(--muted);font-size:14px">تبدأ في: ${startDateStr}${daysUntil > 0 ? ' · متبقي ' + (daysUntil===1?'يوم واحد':daysUntil+' أيام') : ''}</p>
        </div>`;
    } else {
      const displayUnits = khatma.units || [];
      const periodLabel = (khatma.khatmaType==='monthly'||khatma.khatmaType==='weekly')
        ? (currentHijriPeriodLabel(rotationStart, khatma.khatmaType)||'') : '';
      const done = displayUnits.filter(u=>u.status==='completed').length;
      const total = displayUnits.length;
      const periodEndStr = formatPeriodEnd(rotationStart, khatma.khatmaType);
      unitsHtml = `
        <p style="color:var(--muted);font-size:13px;margin:0 0 12px">${periodLabel ? 'الفترة: '+escapeHtml(periodLabel)+' · ' : ''}${done}/${total} مكتمل${periodEndStr?' · ينتهي: '+escapeHtml(periodEndStr):''}</p>
        <div class="units-grid" style="grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px">
          ${displayUnits.map(unit => {
            const lbl = {assigned:'مُعيّن',reading:'جاري القراءة',completed:'تمت القراءة'}[unit.status]||'متاح';
            const canComplete = unit.status==='assigned'||unit.status==='reading';
            return `<article class="unit ${unit.status}">
              <strong style="font-size:13px">${escapeHtml(unit.label)}</strong>
              <small><span class="status-dot" style="font-size:11px">${lbl}</span></small>
              ${canComplete?`<div class="unit-actions"><button class="btn primary" style="font-size:12px;padding:7px" data-portal-action="complete" data-khatma="${escapeHtml(khatma.id)}" data-unit="${unit.number}" data-unit-label="${escapeHtml(unit.label)}" data-identity="${escapeHtml(identity)}">تمت القراءة</button></div>`:''}
            </article>`;
          }).join('')||'<p style="color:var(--muted);grid-column:1/-1;font-size:13px">لا توجد أجزاء مُعيّنة لك في هذه الختمة.</p>'}
        </div>`;
    }

    view.innerHTML = `
      <section class="page-head">
        <span class="eyebrow">بوابة القراء</span>
        <h1>${escapeHtml(khatma.title)}</h1>
        ${readerName ? `<p>${escapeHtml(readerName)}${profile?.serialCode?' · '+escapeHtml(profile.serialCode):''}${profile?.country?' · '+escapeHtml(profile.country):''}</p>` : ''}
      </section>
      <div style="margin-bottom:16px;display:flex;gap:10px;align-items:center">
        <a class="btn ghost compact-btn" href="#/reader-login">← ختماتي</a>
        <button class="btn ghost compact-btn" id="readerKhatmaLogoutBtn" type="button">تسجيل الخروج</button>
      </div>
      <div class="form-card glass">${unitsHtml}</div>`;

    // Logout button
    view.querySelector('#readerKhatmaLogoutBtn')?.addEventListener('click', () => {
      localStorage.removeItem('reader_portal_identity');
      Object.keys(localStorage).filter(k => k.startsWith('managed_identity_')).forEach(k => localStorage.removeItem(k));
      location.hash = '#/reader-login';
    });

    // Bind تمت القراءة buttons
    view.querySelectorAll('[data-portal-action="complete"]').forEach(btn2 => {
      btn2.addEventListener('click', async () => {
        const kid = btn2.dataset.khatma;
        const unitNum = btn2.dataset.unit;
        const unitLabel = btn2.dataset.unitLabel||('الجزء رقم '+unitNum);
        const id2 = btn2.dataset.identity;
        const confirmed = await showConfirmModal({
          title:'تأكيد إتمام القراءة',
          message:`هل فعلًا أتممت قراءة ${unitLabel}؟`,
          confirmLabel:'نعم، أتممت القراءة', cancelLabel:'إلغاء'
        });
        if(!confirmed) return;
        try{
          await api(`/managed-khatmas/${encodeURIComponent(kid)}/units/${unitNum}/complete`,{method:'POST',body:{identity:id2}});
          toast('تمت القراءة بنجاح');
          setupReaderKhatma(khatmaId);
        }catch(err){ toast(err.message||'تعذر التحديث'); }
      });
    });

  }catch(err){
    view.innerHTML = `<article class="feature-card empty-state"><h3>${escapeHtml(err.message||'تعذر التحميل')}</h3><a class="btn primary" href="#/reader-login">← ختماتي</a></article>`;
  }
}

window.openShareReaderGroup = async function(groupId){
  let container = document.getElementById('shareReaderGroupPanel_' + groupId);
  if(!container){
    // يبحث عن بطاقة المجموعة ويضيف panel تحتها
    const btn = document.querySelector(`button[onclick="window.openShareReaderGroup('${groupId}')"]`);
    if(!btn) return;
    const article = btn.closest('article');
    if(!article) return;
    container = document.createElement('div');
    container.id = 'shareReaderGroupPanel_' + groupId;
    article.after(container);
  }
  container.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px 0">جاري تحميل المجموعات…</p>';
  try {
    const res = await api('/managed-creator-groups');
    const creatorGroups = res.groups || [];
    const currentGroup = (state.managedReaderGroups || []).find(g => g.id === groupId) || {};
    const currentShared = currentGroup.shared_creator_group_id || '';
    const opts = creatorGroups.map(cg => `<option value="${escapeHtml(cg.id)}" ${currentShared === cg.id ? 'selected' : ''}>${escapeHtml(cg.name)}</option>`).join('');
    container.innerHTML = `<div class="inline-panel action-sheet" style="margin-bottom:10px"><div class="sheet-head"><h4>مشاركة المجموعة مع منشئين</h4><span>الوصول المشترك</span></div>
      <label style="display:block;margin-bottom:8px">المجموعة<select id="shareRGSelect_${escapeHtml(groupId)}" style="width:100%;margin-top:4px">
        <option value="">— بلا مشاركة —</option>${opts}
      </select></label>
      <div class="compact-actions">
        <button class="btn primary compact-btn" id="confirmShareRGBtn_${escapeHtml(groupId)}">حفظ</button>
        <button class="btn ghost compact-btn" id="cancelShareRGBtn_${escapeHtml(groupId)}">إلغاء</button>
      </div></div>`;
    document.getElementById(`cancelShareRGBtn_${groupId}`)?.addEventListener('click', ()=>{ container.remove(); });
    document.getElementById(`confirmShareRGBtn_${groupId}`)?.addEventListener('click', async ()=>{
      const selGroupId = document.getElementById(`shareRGSelect_${groupId}`)?.value || '';
      try {
        await api('/managed-reader-groups/' + encodeURIComponent(groupId) + '/share', {method:'POST', body:{groupId: selGroupId || null}});
        toast(selGroupId ? 'تمت المشاركة مع المجموعة' : 'تم إلغاء المشاركة');
        container.remove();
        setupManagedReaders();
      } catch(err){ toast(err.message || 'تعذرت المشاركة'); }
    });
  } catch(err){ container.innerHTML = `<p style="color:var(--danger);padding:8px 0">${escapeHtml(err.message || 'تعذر تحميل المجموعات')}</p>`; }
};

async function setupReaderGroup(id){
  const view = document.getElementById('readerGroupView');
  const hash = location.hash || '';
  const manageMode = hash.endsWith('/manage');
  if(!canUseManagedKhatmas()){ view.innerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3></article>`; return; }

  let group = null, readers = [];
  try{
    const [gRes, rRes] = await Promise.all([
      api('/managed-reader-groups'),
      api('/managed-readers?groupId=' + encodeURIComponent(id))
    ]);
    group = (gRes.groups || []).find(g => g.id === id);
    readers = rRes.readers || [];
  }catch(err){ view.innerHTML = `<article class="feature-card empty-state"><h3>تعذر تحميل المجموعة</h3><p>${escapeHtml(err.message)}</p></article>`; return; }
  if(!group){ view.innerHTML = `<article class="feature-card empty-state"><h3>المجموعة غير موجودة</h3><a class="btn primary" href="#/managed-readers">الرجوع</a></article>`; return; }
  state.currentReaderGroup = group;
  state.currentGroupReaders = readers;

  const rotationTypeLabel = {'weekly':'أسبوعي','monthly':'شهري','yearly':'سنوي','none':'بلا تدوير'};
  const periodIndex = computeCurrentPeriodIndex(group.rotation_start_date || '', group.rotation_type || 'monthly');
  const typeLabel = group.rotation_type === 'weekly' ? 'أسبوع' : group.rotation_type === 'monthly' ? 'شهر' : 'سنة';

  if(manageMode){
    view.innerHTML = `
      <section class="page-head">
        <span class="eyebrow">إدارة المجموعة</span>
        <h1>${escapeHtml(group.name)}</h1>
        <div class="status-line"><a class="btn ghost compact-btn" href="#/reader-group/${escapeHtml(id)}">← عرض</a><button class="btn ghost compact-btn" type="button" onclick="printReaderGroup('${escapeJs(id)}')">طباعة / PDF</button></div>
      </section>
      <section class="form-card glass">
        <div class="sheet-head"><h3>بيانات المجموعة</h3></div>
        <form id="editGroupMainForm">
          <div class="form-grid">
            <label>اسم المجموعة<input id="egName" value="${escapeHtml(group.name)}" required /></label>
            <label>نوع التدوير<select id="egType">
              <option value="weekly" ${group.rotation_type==='weekly'?'selected':''}>أسبوعي</option>
              <option value="monthly" ${group.rotation_type==='monthly'?'selected':''}>شهري</option>
              <option value="yearly" ${group.rotation_type==='yearly'?'selected':''}>سنوي</option>
              <option value="none" ${group.rotation_type==='none'?'selected':''}>بلا تدوير</option>
            </select></label>
            <label>مدة الخطة<select id="egDuration">${rotationDurationOptions(group.rotation_duration_years||group.rotationDurationYears||5)}</select></label>
            <label>تاريخ بدء الدورة الأولى<input id="egStart" type="date" value="${escapeHtml((group.rotation_start_date||'').slice(0,10))}" /></label>
            <label>ملاحظات<input id="egNotes" value="${escapeHtml(group.notes||'')}" /></label>
          </div>
          <div class="compact-actions" style="margin-top:12px">
            <button class="btn primary compact-btn" type="submit">حفظ التغييرات</button>
            <button class="btn ghost danger-btn compact-btn" type="button" id="deleteGroupBtn">حذف المجموعة</button>
          </div>
        </form>
        <div class="sheet-head" style="margin-top:20px"><h3>قراء المجموعة (${readers.length})</h3>
          <div class="compact-actions">
            <button class="btn ghost compact-btn" id="addReaderBtn">+ إضافة قارئ</button>
            <button class="btn ghost compact-btn" id="importGroupCsvBtn">رفع CSV</button>
            <button class="btn ghost compact-btn" id="exportGroupCsvBtn2">تصدير CSV</button>
          </div>
        </div>
        <input id="groupCsvFileInput" type="file" accept=".csv,text/csv" hidden />
        <div id="addReaderInline" hidden class="inline-panel action-sheet" style="margin-bottom:12px">
          <form id="addReaderGroupForm">
            <div class="form-grid">
              <label>الاسم<input name="name" required /></label>
              <label>الجوال<input name="phone" inputmode="tel" /></label>
              <label>الكود (4-10 أرقام)<input name="accessCode" inputmode="numeric" maxlength="10" value="${managedRandomCode()}" /></label>
              <label>الدولة<select name="country"><option value="">— اختياري —</option><option value="السعودية">السعودية</option><option value="البحرين">البحرين</option><option value="الكويت">الكويت</option><option value="عُمان">عُمان</option><option value="اليمن">اليمن</option><option value="العراق">العراق</option><option value="إيران">إيران</option><option value="قطر">قطر</option><option value="الإمارات">الإمارات</option><option value="الأردن">الأردن</option><option value="أخرى">أخرى</option></select></label>
              <label>بداية الجزء<input name="startJuz" type="number" min="1" max="30" /></label>
              <label>عدد الأجزاء / دورة<input name="partsCount" type="number" min="1" max="30" /></label>
              <label class="full">ملاحظات<input name="notes" /></label>
            </div>
            <div class="compact-actions" style="margin-top:8px">
              <button class="btn primary compact-btn" type="submit">حفظ</button>
              <button class="btn ghost compact-btn" type="button" onclick="document.getElementById('addReaderInline').hidden=true">إلغاء</button>
            </div>
          </form>
        </div>
        <div class="managed-table" id="groupReadersList">
          ${readers.map(r => readerRowHtml(r, id)).join('') || '<article class="feature-card empty-state"><h3>لا يوجد قراء</h3></article>'}
        </div>
      </section>`;

    document.getElementById('editGroupMainForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      try{
        await api('/managed-reader-groups/' + encodeURIComponent(id), {method:'POST', body:{
          name: document.getElementById('egName').value.trim(),
          rotationType: document.getElementById('egType').value,
          rotationDurationYears: Number(document.getElementById('egDuration')?.value || 5),
          rotationStartDate: document.getElementById('egStart').value,
          notes: document.getElementById('egNotes').value.trim()
        }});
        toast('تم تحديث المجموعة'); setupReaderGroup(id);
      }catch(err){ toast(err.message || 'تعذر التحديث'); }
    });
    document.getElementById('deleteGroupBtn')?.addEventListener('click', async () => {
      if(!confirm('حذف المجموعة؟ لن يُحذف القراء.')) return;
      try{ await api('/managed-reader-groups/' + encodeURIComponent(id), {method:'DELETE'}); toast('تم الحذف'); location.hash = '#/managed-readers'; }
      catch(err){ toast(err.message || 'تعذر الحذف'); }
    });
    document.getElementById('addReaderBtn')?.addEventListener('click', () => { document.getElementById('addReaderInline').hidden = false; });
    document.getElementById('addReaderGroupForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      data.phone = normalizeLocalPhone(data.phone || '');
      try{ await api('/managed-readers', {method:'POST', body:{readers:[data], groupId: id}}); toast('تم إضافة القارئ'); setupReaderGroup(id); }
      catch(err){ toast(err.message || 'تعذر الإضافة'); }
    });
    document.getElementById('exportGroupCsvBtn2')?.addEventListener('click', () => {
      if(!readers.length){ toast('لا يوجد قراء'); return; }
      downloadTextFile('readers-group.csv', rowsToCsv(readers.map(r => ({name:r.name, phone:normalizeLocalPhone(r.phone||''), accessCode:r.accessCode, start_juz:r.startJuz||'', parts_count:r.partsCount||'', notes:r.notes||''}))), 'text/csv;charset=utf-8');
    });
    document.getElementById('importGroupCsvBtn')?.addEventListener('click', () => document.getElementById('groupCsvFileInput').click());
    document.getElementById('groupCsvFileInput')?.addEventListener('change', async e => {
      const file = e.target.files?.[0]; if(!file) return;
      const {participants} = csvRowsToManagedData(parseCsvRows(await file.text()));
      if(!participants.length){ toast('ملف CSV لا يحتوي قراء'); e.target.value=''; return; }
      try{ await api('/managed-readers', {method:'POST', body:{readers:participants, groupId:id}}); toast('تم استيراد القراء'); setupReaderGroup(id); }
      catch(err){ toast(err.message || 'تعذر الاستيراد'); }
      e.target.value = '';
    });
    return;
  }

  // View mode
  const readersWithJuz = readers.map(r => ({
    ...r,
    currentJuz: (r.startJuz && r.partsCount) ? computeRotationJuz(r.startJuz, r.partsCount, periodIndex) : []
  }));
  const futureRows = Array.from({length: 5}, (_, i) => {
    const p = periodIndex + i;
    const rowLabel = group.rotation_type === 'monthly'
      ? (() => { const hm = getHijriMonthAtOffset(group.rotation_start_date || '', p); return `${hm.name} ${hm.year} هـ`; })()
      : group.rotation_type === 'weekly'
        ? (() => { const s = new Date(group.rotation_start_date||''); const ws = new Date(s.getTime()+p*7*86400000); const we = new Date(s.getTime()+(p+1)*7*86400000-86400000); const fmt = d=>d.toLocaleDateString('ar-SA-u-ca-gregory',{day:'numeric',month:'numeric'}); return `أسبوع ${p+1} (${fmt(ws)}–${fmt(we)})`; })()
        : `${typeLabel} ${p+1}`;
    return `<tr style="${i===0?'font-weight:700;background:var(--primary-soft)':''}">
      <td>${rowLabel}${i===0?' ← الحالية':i===1?' (التالية)':''}</td>
      ${readers.map(r => {
        const juz = (r.startJuz && r.partsCount) ? computeRotationJuz(r.startJuz, r.partsCount, p) : [];
        return `<td>${juz.length ? 'ج' + juz.join('، ج') : '—'}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  view.innerHTML = `
    <section class="page-head">
      <span class="eyebrow">مجموعة قراء</span>
      <h1>${escapeHtml(group.name)}</h1>
      <p>${escapeHtml(rotationTypeLabel[group.rotation_type]||'')} · ${readers.length} قارئ · ${currentHijriPeriodLabel(group.rotation_start_date, group.rotation_type) || 'الدورة ' + (periodIndex+1)}</p>
      <div class="status-line">
        <a class="btn ghost compact-btn" href="#/reader-group/${escapeHtml(id)}/manage">⚙ إدارة المجموعة</a>
        <a class="btn ghost compact-btn" href="#/managed-readers">← كل المجموعات</a>
        <button class="btn ghost compact-btn" type="button" onclick="printReaderGroup('${escapeJs(id)}')">طباعة / PDF</button>
      </div>
    </section>
    <section class="khatma-detail glass">
      <div class="mini-stats">
        <div><strong>${readers.length}</strong><span>إجمالي القراء</span></div>
        <div><strong>${currentHijriPeriodLabel(group.rotation_start_date, group.rotation_type) || (periodIndex+1)}</strong><span>الدورة الحالية</span></div>
        <div><strong>${formatPeriodEnd(group.rotation_start_date, group.rotation_type) || '—'}</strong><span>نهاية الدورة</span></div>
      </div>
    </section>
    <section class="form-card glass" style="margin-top:16px">
      <div class="sheet-head"><h3>القراء وأجزاءهم الحالية</h3><span>${currentHijriPeriodLabel(group.rotation_start_date, group.rotation_type) || 'الدورة ' + (periodIndex+1)}</span></div>
      <div class="managed-table">
        ${readersWithJuz.map(r => `<div class="owner-row">
          <div class="owner-row-main">
            <strong class="owner-row-title">${escapeHtml(r.name)}</strong>
            <span class="owner-row-meta">${r.currentJuz.length ? '<span style="color:var(--primary);font-weight:900">ج' + r.currentJuz.join('، ج') + '</span>' : '<span style="color:var(--muted)">بلا تدوير محدد</span>'}${r.phone ? ' · ' + escapeHtml(normalizeLocalPhone(r.phone)) : ''} · كود: ${escapeHtml(r.accessCode)}</span>
          </div>
        </div>`).join('') || '<article class="feature-card empty-state"><h3>لا يوجد قراء</h3></article>'}
      </div>
    </section>
    ${readers.some(r=>r.startJuz&&r.partsCount) ? (()=>{
      const totalPeriods = rotationPeriodsFromDuration(group.rotation_type || 'monthly', group.rotation_duration_years || group.rotationDurationYears || 5);
      const readersWithRot = readers.filter(r=>r.startJuz&&r.partsCount);
      return `<section class="form-card glass" style="margin-top:16px">
        <div class="sheet-head"><h3>خطة التدوير الكاملة</h3><span>${totalPeriods} ${typeLabel} · ${group.rotation_duration_years||5} سنوات</span></div>
        <div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead style="position:sticky;top:0;z-index:1"><tr style="background:var(--card)"><th style="padding:8px;text-align:right;border-bottom:2px solid var(--line)">الدورة</th>${readersWithRot.map(r=>`<th style="padding:8px;text-align:right;border-bottom:2px solid var(--line)">${escapeHtml(r.name)}</th>`).join('')}</tr></thead>
          <tbody>${Array.from({length:Math.min(totalPeriods,200)},(_,i)=>{
            const p=i;
            const isCurrent = p===periodIndex;
            const rowLabel = group.rotation_type==='monthly'
              ? (()=>{const hm=getHijriMonthAtOffset(group.rotation_start_date||'',p);return `${hm.name} ${hm.year} هـ`;})()
              : group.rotation_type==='weekly'
                ? (()=>{const s=new Date(group.rotation_start_date||'');const ws=new Date(s.getTime()+p*7*86400000);const we=new Date(s.getTime()+(p+1)*7*86400000-86400000);const fmt=d=>d.toLocaleDateString('ar-SA-u-ca-gregory',{day:'numeric',month:'numeric'});return `أسبوع ${p+1} (${fmt(ws)}–${fmt(we)})`;})()
                : `${typeLabel} ${p+1}`;
            return `<tr style="border-top:1px solid var(--line)${isCurrent?';background:var(--primary-soft);font-weight:700':''}"><td style="padding:7px 8px">${rowLabel}${isCurrent?' ← الحالية':''}</td>${readersWithRot.map(r=>{const j=computeRotationJuz(r.startJuz,r.partsCount,p);return `<td style="padding:7px 8px">ج${j.join('، ج')}</td>`;}).join('')}</tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`;
    })() : ''}`;
}

async function setupManagedMonitor(){
  const view = document.getElementById('managedMonitorView');
  if(!canUseManagedKhatmas()){ view.innerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3></article>`; return; }
  view.innerHTML = `<section class="page-head"><span class="eyebrow">مراقبة التقدم</span><h1>لوحة متابعة الختمات المُدارة</h1><div class="status-line"><button class="btn ghost compact-btn" type="button" onclick="printMonitorReport()">طباعة / PDF</button></div></section><article class="feature-card empty-state"><h3>جاري التحميل...</h3></article>`;

  let khatmas = [];
  try{
    const res = await api('/managed-khatmas');
    khatmas = res.khatmas || [];
  }catch(err){ view.innerHTML += `<article class="feature-card empty-state"><h3>تعذر التحميل</h3><p>${escapeHtml(err.message)}</p></article>`; return; }

  if(!khatmas.length){ view.innerHTML = `<section class="page-head"><span class="eyebrow">مراقبة التقدم</span><h1>لوحة متابعة الختمات المُدارة</h1><div class="status-line"><button class="btn ghost compact-btn" type="button" onclick="printMonitorReport()">طباعة / PDF</button></div></section><article class="feature-card empty-state"><h3>لا توجد ختمات مُدارة بعد</h3><a class="btn primary" href="#/managed-create">إنشاء ختمة مُدارة</a></article>`; return; }

  const totalCompleted = khatmas.reduce((s,k)=>(k.units||[]).filter(u=>u.status==='completed').length+s,0);
  const totalUnits = khatmas.reduce((s,k)=>(k.units||[]).length+s,0);
  const totalAvailable = khatmas.reduce((s,k)=>(k.units||[]).filter(u=>u.status==='available').length+s,0);
  const overallPct = totalUnits ? Math.round(totalCompleted/totalUnits*100) : 0;

  // Best readers — aggregate by participant name across all khatmas
  const readerStats = new Map();
  for (const k of khatmas) {
    for (const u of (k.units || [])) {
      if (!u.participantName) continue;
      const s = readerStats.get(u.participantName) || {name: u.participantName, completed: 0, total: 0};
      s.total++;
      if (u.status === 'completed') s.completed++;
      readerStats.set(u.participantName, s);
    }
  }
  const topReaders = [...readerStats.values()].sort((a,b)=>b.completed-a.completed).slice(0,5);

  // Most active khatmas — by reading+completed count
  const activeKhatmas = [...khatmas].sort((a,b)=>{
    const aA = (a.units||[]).filter(u=>u.status==='reading'||u.status==='completed').length;
    const bA = (b.units||[]).filter(u=>u.status==='reading'||u.status==='completed').length;
    return bA - aA;
  }).slice(0,3);

  // Current Hijri period stats (monthly khatmas matching current month)
  const {year: cHY, month: cHM} = getHijriParts(new Date());
  const periodKhatmas = khatmas.filter(k => {
    if (!k.rotationStartDate || k.khatmaType !== 'monthly') return false;
    const {year: sY, month: sM} = getHijriParts(new Date(k.rotationStartDate));
    const idx = Math.max(0, (cHY - sY) * 12 + (cHM - sM));
    return idx >= 0;
  });
  const periodCompleted = periodKhatmas.reduce((s,k)=>(k.units||[]).filter(u=>u.status==='completed').length+s,0);
  const periodTotal = periodKhatmas.reduce((s,k)=>(k.units||[]).length+s,0);
  const periodPct = periodTotal ? Math.round(periodCompleted/periodTotal*100) : 0;

  // "أفضل القراء" موجود في الداشبورد — لا نكرره هنا
  const topReadersHtml = '';

  const activeKhatmasHtml = activeKhatmas.length ? `
    <section class="khatma-detail glass" style="margin-bottom:20px">
      <div class="sheet-head"><h3>أكثر الختمات نشاطًا</h3><span>حسب عدد الأجزاء النشطة والمكتملة</span></div>
      <div class="managed-table">
        ${activeKhatmas.map(k=>{
          const active = (k.units||[]).filter(u=>u.status==='reading'||u.status==='completed').length;
          const p = managedProgress(k);
          return `<div class="owner-row">
            <div class="owner-row-main">
              <strong class="owner-row-title">${escapeHtml(k.title)}</strong>
              <span class="owner-row-meta">${active} جزء نشط · ${p.pct}% مكتمل</span>
            </div>
            <div class="owner-row-actions"><a class="mini-icon-btn v32" href="#/managed-khatma/${escapeHtml(k.id)}/manage">إدارة</a></div>
          </div>`;
        }).join('')}
      </div>
    </section>` : '';

  const periodHtml = periodKhatmas.length ? `
    <section class="khatma-detail glass" style="margin-bottom:20px">
      <div class="sheet-head"><h3>إحصائيات الفترة الحالية</h3><span>${hijriMonthName(cHM)} ${cHY} هـ</span></div>
      <div class="mini-stats">
        <div><strong>${periodKhatmas.length}</strong><span>ختمة شهرية</span></div>
        <div><strong>${periodPct}%</strong><span>إنجاز الفترة</span></div>
        <div><strong>${periodCompleted}/${periodTotal}</strong><span>وحدة مكتملة</span></div>
      </div>
    </section>` : '';

  const cardsHtml = khatmas.map(k => {
    const p = managedProgress(k);
    const status = managedKhatmaStatus(k);
    const rotationType = k.khatmaType || 'monthly';
    const rotationStart = k.rotationStartDate || k.khatmaDate || k.createdAt || '';
    const periodIndex = computeCurrentPeriodIndex(rotationStart, rotationType);
    const participants = (k.participants || []);

    const participantRows = participants.length
      ? participants.map(part => {
          const myUnits = (k.units||[]).filter(u => u.participantId === part.id || u.participantName === part.name);
          const done = myUnits.filter(u=>u.status==='completed').length;
          const total = myUnits.length;
          const pct = total ? Math.round(done/total*100) : 0;
          const currentJuz = (part.startJuz && part.partsCount) ? computeRotationJuz(part.startJuz, part.partsCount, periodIndex) : [];
          return `<div class="owner-row">
            <div class="owner-row-main">
              <strong class="owner-row-title">${escapeHtml(part.name||'—')}</strong>
              <span class="owner-row-meta">${pct}% مكتمل (${done}/${total})${currentJuz.length ? ' · ج' + currentJuz.join('، ج') : ''}</span>
            </div>
            <div class="owner-row-actions">
              <span class="mini-pill v32 status ${pct===100?'done':''}">${pct}%</span>
            </div>
          </div>`;
        }).join('')
      : '<p style="color:var(--muted);padding:8px 0;margin:0">لا يوجد مشاركون بعد.</p>';

    return `<article class="khatma-list-row v32 glass" style="margin-bottom:12px">
      <div class="khatma-list-main v32" style="flex-wrap:wrap;gap:12px">
        <div class="khatma-list-content v32" style="flex:1">
          <div class="khatma-list-badges v32">
            <span class="mini-pill v32">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : khatmaFallbackLabel())}</span>
            <span class="mini-pill v32 status ${status.className}">${status.label}</span>
          </div>
          <div class="khatma-list-titleline v32"><h3>${escapeHtml(k.title)}</h3><p>${escapeHtml(k.hijriDate||'')}${k.gregorianDate?' - '+escapeHtml(k.gregorianDate):''}</p></div>
          <div style="margin-top:8px;background:var(--line);border-radius:99px;height:6px;overflow:hidden">
            <div style="width:${p.pct}%;background:var(--primary);height:100%;border-radius:99px;transition:.3s"></div>
          </div>
          <p style="margin:4px 0 0;color:var(--muted);font-size:13px">${p.pct}% · ${p.completed} مكتمل · ${p.active} جاري · ${currentHijriPeriodLabel(rotationStart, rotationType) || 'دورة ' + (periodIndex+1)}${formatPeriodEnd(rotationStart, rotationType) ? ' · ينتهي: ' + formatPeriodEnd(rotationStart, rotationType) : ''}</p>
        </div>
        <div class="khatma-list-side v32">
          <div class="khatma-list-actions v32">
            <a class="mini-icon-btn v32" href="#/managed-khatma/${escapeHtml(k.id)}/manage">⚙ إدارة</a>
          </div>
        </div>
      </div>
      ${participants.length ? `<details style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">
        <summary style="cursor:pointer;font-weight:700;color:var(--primary)">تفاصيل القراء (${participants.length})</summary>
        <div class="managed-table" style="margin-top:8px">${participantRows}</div>
      </details>` : ''}
    </article>`;
  }).join('');

  view.innerHTML = `
    <section class="page-head">
      <span class="eyebrow">مراقبة التقدم</span>
      <h1>لوحة متابعة الختمات المُدارة</h1>
      <p>نظرة شاملة على تقدم القراء والتدوير في جميع الختمات.</p>
      <div class="status-line"><button class="btn ghost compact-btn" type="button" onclick="printMonitorReport()">طباعة / PDF</button></div>
    </section>
    <section class="khatma-detail glass" style="margin-bottom:20px">
      <div class="mini-stats">
        <div><strong>${khatmas.length}</strong><span>ختمة مُدارة</span></div>
        <div><strong>${overallPct}%</strong><span>الإنجاز الإجمالي</span></div>
        <div><strong>${totalCompleted}/${totalUnits}</strong><span>وحدة مكتملة</span></div>
        <div><strong>${totalAvailable}</strong><span>وحدة لم تُبدأ</span></div>
      </div>
    </section>
    ${periodHtml}${topReadersHtml}${activeKhatmasHtml}
    <div class="sheet-head" style="margin-bottom:12px"><h3>تفاصيل الختمات</h3><span>${khatmas.length} ختمة</span></div>
    <div class="khatma-rows-list khatma-rows-list-v3 khatma-rows-list-v32">${cardsHtml}</div>`;
}

async function setupReports(){
  const view = document.getElementById('reportsView');
  if(!canUseManagedKhatmas()){ view.innerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3></article>`; return; }
  view.innerHTML = `<article class="feature-card empty-state"><h3>جاري تحميل التقارير...</h3></article>`;

  let khatmas = [], groups = [];
  try{
    const [kRes, gRes] = await Promise.all([api('/managed-khatmas'), api('/managed-reader-groups')]);
    khatmas = kRes.khatmas || [];
    groups = gRes.groups || [];
  }catch(err){
    view.innerHTML = `<article class="feature-card empty-state"><h3>تعذر تحميل التقارير</h3><p>${escapeHtml(err.message || '')}</p></article>`;
    return;
  }

  const detailed = await Promise.all(khatmas.map(async k => {
    try{ const res = await api('/managed-khatmas/' + encodeURIComponent(k.id) + '/admin'); return res.khatma || k; }
    catch{ return k; }
  }));
  state.managedKhatmas = detailed;

  const khatmaOptions = detailed.map(k => `<option value="${escapeHtml(k.id)}">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber + ' - ' + k.title : k.title)}</option>`).join('');
  const groupOptions = groups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${g.readerCount || 0})</option>`).join('');
  view.innerHTML = `
    <section class="form-card glass report-section">
      <div class="sheet-head"><h3>تقرير الختمة</h3><span>${detailed.length} ختمة</span></div>
      <div class="report-controls">
        <label>اختر الختمة<select id="reportKhatmaSelect">${khatmaOptions || '<option value="">لا توجد ختمات</option>'}</select></label>
        <button class="btn primary compact-btn" id="showKhatmaReport" type="button">عرض</button>
        <button class="btn ghost compact-btn" id="exportKhatmaReport" type="button">تصدير CSV</button>
      </div>
      <div id="khatmaReportResult" class="report-output"></div>
    </section>
    <section class="form-card glass report-section">
      <div class="sheet-head"><h3>تقرير المجموعة</h3><span>${groups.length} مجموعة</span></div>
      <div class="report-controls">
        <label>اختر مجموعة القراء<select id="reportGroupSelect">${groupOptions || '<option value="">لا توجد مجموعات</option>'}</select></label>
        <button class="btn primary compact-btn" id="showGroupReport" type="button">عرض</button>
        <button class="btn ghost compact-btn" id="exportGroupReport" type="button">تصدير CSV</button>
      </div>
      <div id="groupReportResult" class="report-output"></div>
    </section>
    <section class="form-card glass report-section">
      <div class="sheet-head"><h3>المتأخرون</h3><span>أكثر من أسبوع</span></div>
      <div class="compact-actions"><button class="btn ghost compact-btn" id="exportLateReport" type="button">تصدير CSV</button></div>
      <div id="lateReportResult" class="report-output"></div>
    </section>
    <section class="form-card glass report-section">
      <div class="sheet-head"><h3>المكتملون</h3><span>قراء أتموا جميع وحداتهم</span></div>
      <div class="compact-actions"><button class="btn ghost compact-btn" id="exportCompletedReport" type="button">تصدير CSV</button></div>
      <div id="completedReportResult" class="report-output"></div>
    </section>`;

  let currentKhatmaRows = [], currentGroupRows = [];
  const lateRows = staleManagedUnitRows(detailed);
  const completedRows = completedManagedReaderRows(detailed);
  const renderKhatmaReport = () => {
    const id = document.getElementById('reportKhatmaSelect')?.value || '';
    const k = detailed.find(x => x.id === id);
    currentKhatmaRows = k ? managedKhatmaUnitExportRows(k).map(addHijriReportMonth) : [];
    document.getElementById('khatmaReportResult').innerHTML = k ? reportTableHtml(currentKhatmaRows, 'لا توجد وحدات في هذه الختمة') : '<p class="empty-report">اختر ختمة لعرض التقرير.</p>';
  };
  const renderGroupReport = async () => {
    const id = document.getElementById('reportGroupSelect')?.value || '';
    const group = groups.find(g => g.id === id);
    if(!group){ document.getElementById('groupReportResult').innerHTML = '<p class="empty-report">اختر مجموعة لعرض التقرير.</p>'; currentGroupRows = []; return; }
    document.getElementById('groupReportResult').innerHTML = '<p class="empty-report">جاري التحميل...</p>';
    try{
      const res = await api('/managed-readers?groupId=' + encodeURIComponent(id));
      currentGroupRows = groupReportRows(group, res.readers || []);
      document.getElementById('groupReportResult').innerHTML = reportTableHtml(currentGroupRows, 'لا يوجد قراء في هذه المجموعة');
    }catch(err){
      currentGroupRows = [];
      document.getElementById('groupReportResult').innerHTML = `<p class="empty-report">${escapeHtml(err.message || 'تعذر التحميل')}</p>`;
    }
  };

  document.getElementById('showKhatmaReport')?.addEventListener('click', renderKhatmaReport);
  document.getElementById('showGroupReport')?.addEventListener('click', renderGroupReport);
  document.getElementById('exportKhatmaReport')?.addEventListener('click', () => exportReportRows('khatma-report.csv', currentKhatmaRows));
  document.getElementById('exportGroupReport')?.addEventListener('click', () => exportReportRows('reader-group-report.csv', currentGroupRows));
  document.getElementById('exportLateReport')?.addEventListener('click', () => exportReportRows('late-readers-report.csv', lateRows));
  document.getElementById('exportCompletedReport')?.addEventListener('click', () => exportReportRows('completed-readers-report.csv', completedRows));
  document.getElementById('lateReportResult').innerHTML = reportTableHtml(lateRows, 'لا يوجد متأخرون حسب معيار الأسبوع.');
  document.getElementById('completedReportResult').innerHTML = reportTableHtml(completedRows, 'لا يوجد قراء مكتملون حاليًا.');
  renderKhatmaReport();
  if(groups.length) renderGroupReport();
}
function currentHijriReportMonth(){
  const h = getHijriParts(new Date());
  return `${hijriMonthName(h.month)} ${h.year} هـ`;
}
function addHijriReportMonth(row){
  return {'الشهر الهجري': currentHijriReportMonth(), ...row};
}
function reportTableHtml(rows, emptyText){
  if(!rows.length) return `<p class="empty-report">${escapeHtml(emptyText)}</p>`;
  const headers = Object.keys(rows[0]);
  return `<div class="report-table-wrap"><table class="report-table"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function exportReportRows(filename, rows){
  if(!rows.length){ toast('لا توجد بيانات للتصدير'); return; }
  downloadTextFile(filename, rowsToCsv(rows), 'text/csv;charset=utf-8');
}
function staleManagedUnitRows(khatmas){
  const cutoff = Date.now() - 7 * 86400000;
  return khatmas.flatMap(k => (k.units || [])
    .filter(u => (u.status === 'assigned' || u.status === 'available') && new Date(u.updatedAt || k.createdAt || Date.now()).getTime() < cutoff)
    .map(u => addHijriReportMonth({
      'الختمة': k.title || '',
      'رقم الختمة': k.weekNumber || '',
      'الوحدة': u.label || u.number || '',
      'القارئ': u.participantName || 'بدون قارئ',
      'الحالة': managedStatusLabel(u.status),
      'منذ': (u.updatedAt || k.createdAt || '').slice(0,10)
    })));
}
function completedManagedReaderRows(khatmas){
  const rows = [];
  khatmas.forEach(k => {
    const participants = (k.participants || []).filter(p => p.name);
    if(participants.length){
      participants.forEach(p => {
        const units = (k.units || []).filter(u => u.participantId === p.id || u.participantName === p.name);
        if(units.length && units.every(u => u.status === 'completed')){
          rows.push(addHijriReportMonth({'الختمة': k.title || '', 'رقم الختمة': k.weekNumber || '', 'القارئ': p.name, 'الوحدات المكتملة': units.length}));
        }
      });
      return;
    }
    const byName = new Map();
    (k.units || []).forEach(u => {
      if(!u.participantName) return;
      const list = byName.get(u.participantName) || [];
      list.push(u);
      byName.set(u.participantName, list);
    });
    byName.forEach((units, name) => {
      if(units.length && units.every(u => u.status === 'completed')){
        rows.push(addHijriReportMonth({'الختمة': k.title || '', 'رقم الختمة': k.weekNumber || '', 'القارئ': name, 'الوحدات المكتملة': units.length}));
      }
    });
  });
  return rows;
}
function groupReportRows(group, readers){
  const periodIndex = computeCurrentPeriodIndex(group.rotation_start_date || '', group.rotation_type || 'monthly');
  return readers.map(r => {
    const currentJuz = (r.startJuz && r.partsCount) ? computeRotationJuz(r.startJuz, r.partsCount, periodIndex) : [];
    return addHijriReportMonth({
      'المجموعة': group.name || '',
      'القارئ': r.name || '',
      'الجوال': normalizeLocalPhone(r.phone || ''),
      'الكود': r.accessCode || '',
      'بداية الجزء': r.startJuz || '',
      'عدد الأجزاء': r.partsCount || '',
      'أجزاء الدورة الحالية': currentJuz.length ? 'ج' + currentJuz.join('، ج') : '',
      'ملاحظات': r.notes || ''
    });
  });
}

/* ─── Dashboard ─────────────────────────────────────────────── */
function dashMonthLabel(ym){
  if(!ym) return '';
  const [,m] = ym.split('-');
  const names=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return names[(parseInt(m)||1)-1] || ym;
}

function donutSvg(slices, size=170){
  const total = slices.reduce((s,sl)=>s+(sl.value||0),0);
  if(!total) return `<div class="chart-empty">لا توجد بيانات</div>`;
  const cx=size/2, cy=size/2, R=size*0.40, r=size*0.26;
  let angle=-Math.PI/2;
  const paths = slices.filter(sl=>sl.value>0).map(sl=>{
    const sweep=(sl.value/total)*2*Math.PI;
    if(sweep<0.005) return '';
    const end=angle+sweep, large=sweep>Math.PI?1:0;
    const p=`M${(cx+R*Math.cos(angle)).toFixed(2)} ${(cy+R*Math.sin(angle)).toFixed(2)} A${R} ${R} 0 ${large} 1 ${(cx+R*Math.cos(end)).toFixed(2)} ${(cy+R*Math.sin(end)).toFixed(2)} L${(cx+r*Math.cos(end)).toFixed(2)} ${(cy+r*Math.sin(end)).toFixed(2)} A${r} ${r} 0 ${large} 0 ${(cx+r*Math.cos(angle)).toFixed(2)} ${(cy+r*Math.sin(angle)).toFixed(2)}Z`;
    angle=end;
    return `<path d="${p}" fill="${sl.color}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}
    <text x="${cx}" y="${cy-5}" text-anchor="middle" font-size="26" font-weight="900" fill="currentColor">${total}</text>
    <text x="${cx}" y="${cy+14}" text-anchor="middle" font-size="11" fill="var(--muted)">الإجمالي</text></svg>`;
}

function donutLegend(slices){
  return `<div class="dash-donut-legend">${slices.map(sl=>`
    <div class="dash-legend-item">
      <span class="dash-legend-dot" style="background:${sl.color}"></span>
      <span>${escapeHtml(sl.label)}</span>
      <span class="dash-legend-val">${sl.value}</span>
    </div>`).join('')}</div>`;
}

function barChartSvg(data){
  if(!data||!data.length) return `<div class="chart-empty">لا توجد بيانات بعد</div>`;
  const W=480, H=160, padB=28, padT=22;
  const chartH=H-padB-padT;
  const maxVal=Math.max(...data.map(d=>d.count),1);
  const step=W/data.length;
  const bw=Math.min(46,step*0.62);
  const bars=data.map((d,i)=>{
    const bh=maxVal?(d.count/maxVal)*chartH:0;
    const x=(i*step+step/2).toFixed(1);
    const y=(padT+chartH-bh).toFixed(1);
    return `<rect x="${(i*step+step/2-bw/2).toFixed(1)}" y="${y}" width="${bw}" height="${bh.toFixed(1)}" rx="6" fill="var(--primary)" opacity="0.84"/>
      ${d.count?`<text x="${x}" y="${(parseFloat(y)-6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="900" fill="var(--primary)">${d.count}</text>`:''}
      <text x="${x}" y="${H-4}" text-anchor="middle" font-size="10" fill="var(--muted)">${escapeHtml(dashMonthLabel(d.month))}</text>`;
  }).join('');
  return `<div class="chart-bar-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="overflow:visible;direction:ltr">${bars}</svg></div>`;
}

function topReadersHtml(readers){
  if(!readers||!readers.length) return `<p class="empty-report">لا توجد بيانات بعد — ستظهر هنا بعد إكمال أجزاء</p>`;
  const max=readers[0].count||1;
  return `<div class="top-readers-list">${readers.map((r,i)=>`
    <div class="top-reader-row">
      <div class="top-reader-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div>
      <div class="top-reader-info">
        <div class="top-reader-name">${escapeHtml(r.name)}</div>
        <div class="top-reader-bar-wrap"><div class="top-reader-bar" style="width:${Math.round(100*r.count/max)}%"></div></div>
      </div>
      <div class="top-reader-count">${r.count} <span>وحدة</span></div>
    </div>`).join('')}</div>`;
}

async function setupDashboard(){
  const view = document.getElementById('dashboardView');
  if(!canUseManagedKhatmas()){ view.innerHTML=`<article class="feature-card empty-state"><h3>غير مصرح</h3></article>`; return; }
  view.innerHTML=`<article class="feature-card empty-state"><h3>جاري تحميل الإحصائيات...</h3></article>`;

  let stats;
  try{ stats = await api('/dashboard-stats'); }
  catch(err){ view.innerHTML=`<article class="feature-card empty-state"><h3>تعذر تحميل الإحصائيات</h3><p>${escapeHtml(err.message)}</p></article>`; return; }

  const {khatmas:k, units:u, readers, groups, topReaders, byMonth} = stats;
  const unitPct = u.total ? Math.round(100*u.completed/u.total) : 0;

  const khatmaSlices=[
    {label:'نشطة',   value:k.active,   color:'var(--primary)'},
    {label:'مؤرشفة', value:k.archived, color:'var(--gold)'},
  ];
  const unitSlices=[
    {label:'مكتملة',  value:u.completed, color:'var(--primary)'},
    {label:'جاري',   value:u.reading+u.assigned, color:'var(--gold)'},
    {label:'متاحة',  value:u.available,  color:'var(--muted)'},
  ];
  const khatmaByType=[
    {label:'أسبوعية', value:k.weekly,  color:'var(--primary)'},
    {label:'شهرية',  value:k.monthly, color:'var(--gold)'},
    {label:'سنوية',  value:k.yearly,  color:'var(--muted)'},
  ];

  view.innerHTML=`
    <!-- Global Search -->
    <section class="form-card glass dash-search-section">
      <div class="sheet-head"><h3>البحث الشامل عن قارئ</h3><span>بالاسم أو الجوال أو الكود</span></div>
      <div class="dash-search-box">
        <input id="globalSearchInput" class="dash-search-input" placeholder="اكتب اسم القارئ أو رقم الجوال أو الكود التسلسلي..." autocomplete="off" inputmode="text" />
      </div>
      <div id="globalSearchResults" class="search-results-wrap"></div>
    </section>

    <!-- Summary Cards -->
    <div class="dash-summary-grid">
      <div class="dash-stat-card glass">
        <div class="stat-icon">📖</div>
        <div class="stat-value">${k.total}</div>
        <div class="stat-label">ختمة مُدارة</div>
        <div class="stat-sub">${k.active} نشطة · ${k.archived} مؤرشفة</div>
      </div>
      <div class="dash-stat-card glass">
        <div class="stat-icon">✅</div>
        <div class="stat-value">${u.completed}</div>
        <div class="stat-label">وحدة مكتملة</div>
        <div class="stat-sub">${unitPct}% من ${u.total} وحدة إجمالاً</div>
      </div>
      <div class="dash-stat-card glass">
        <div class="stat-icon">👤</div>
        <div class="stat-value">${readers.total}</div>
        <div class="stat-label">قارئ مسجّل</div>
        <div class="stat-sub">${groups.total} مجموعة قراء</div>
      </div>
      <div class="dash-stat-card glass">
        <div class="stat-icon">⏳</div>
        <div class="stat-value">${u.reading+u.assigned}</div>
        <div class="stat-label">وحدة تحت الإنجاز</div>
        <div class="stat-sub">${u.available} وحدة متاحة</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="dash-charts-row">
      <div class="form-card glass">
        <div class="sheet-head"><h3>حالة الختمات</h3><span>${k.total} ختمة</span></div>
        <div class="dash-donut-wrap">
          ${donutSvg(khatmaSlices)}
          ${donutLegend(khatmaSlices)}
        </div>
      </div>
      <div class="form-card glass">
        <div class="sheet-head"><h3>حالة الوحدات</h3><span>${unitPct}% إنجاز</span></div>
        <div class="dash-donut-wrap">
          ${donutSvg(unitSlices)}
          ${donutLegend(unitSlices)}
        </div>
      </div>
      <div class="form-card glass">
        <div class="sheet-head"><h3>نوع الختمات</h3></div>
        <div class="dash-donut-wrap">
          ${donutSvg(khatmaByType)}
          ${donutLegend(khatmaByType)}
        </div>
      </div>
    </div>

    <!-- Monthly Bar Chart -->
    <div class="form-card glass" style="margin-top:16px">
      <div class="sheet-head"><h3>الإنجاز الشهري</h3><span>آخر 6 أشهر</span></div>
      ${barChartSvg(byMonth)}
    </div>

    <!-- Top Readers -->
    <div class="form-card glass" style="margin-top:16px">
      <div class="sheet-head"><h3>أعلى القراء إنجازاً</h3><span>الوحدات المكتملة</span></div>
      ${topReadersHtml(topReaders)}
    </div>`;

  // Wire search
  const input  = view.querySelector('#globalSearchInput');
  const results= view.querySelector('#globalSearchResults');
  let timer=null;
  input?.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q=input.value.trim();
    if(!q||q.length<2){ results.innerHTML=''; return; }
    results.innerHTML='<div class="search-loading">جاري البحث...</div>';
    timer=setTimeout(async()=>{
      try{
        const res=await api('/reader-global-search?q='+encodeURIComponent(q));
        const all=[...res.readers||[], ...res.participants||[]];
        if(!all.length){ results.innerHTML=`<div class="search-empty">لا نتائج لـ "${escapeHtml(q)}"</div>`; return; }
        results.innerHTML=`<div class="search-results-header">${all.length} نتيجة</div>`+all.map(r=>`
          <div class="search-result-item">
            <span class="search-result-badge ${r.type==='reader'?'reader-badge':'participant-badge'}">${r.type==='reader'?'قارئ':'مشارك'}</span>
            <div class="search-result-main">
              <strong>${escapeHtml(r.name||'—')}</strong>
              <span class="search-result-meta">
                ${r.type==='reader'?`مجموعة: ${escapeHtml(r.groupName||'—')}`:
                  `ختمة: ${escapeHtml(r.khatmaTitle||'—')} ${r.weekNumber?'('+r.weekNumber+')':''}`}
                 · كود: ${escapeHtml(r.accessCode||'—')}
                ${r.serialCode?' · '+escapeHtml(r.serialCode):''}
                ${r.phone?' · '+escapeHtml(normalizeLocalPhone(r.phone)):''}
                ${r.startJuz?' · ج'+escapeHtml(String(r.startJuz)):''}
              </span>
            </div>
            ${r.type==='reader'&&r.groupId?`<a class="btn ghost compact-btn" href="#/reader-group/${escapeHtml(r.groupId)}">المجموعة</a>`:''}
            ${r.type==='participant'&&r.khatmaId?`<a class="btn ghost compact-btn" href="#/managed-khatma/${escapeHtml(r.khatmaId)}/manage">الختمة</a>`:''}
          </div>`).join('');
      }catch(err){ results.innerHTML=`<div class="search-error">${escapeHtml(err.message||'خطأ')}</div>`; }
    }, 350);
  });
}

function setupManagedKhatmas(){
  const list = document.getElementById('managedKhatmaList');
  if(!canUseManagedKhatmas()){
    list.innerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3><p>هذه الصفحة للمالك أو منشئ الختمات المتحكم فقط.</p></article>`;
    return;
  }
  const isOwner = state.user?.role === 'owner';
  // Patch page-head eyebrow for non-owners
  if(!isOwner){
    const eyebrow = document.querySelector('.page-head .eyebrow');
    if(eyebrow && eyebrow.textContent.includes('مُدارة')) eyebrow.textContent = 'الختمات';
  }
  refreshManagedKhatmas().then(() => {
    if(!state.managedKhatmas.length){
      list.classList.remove('khatma-rows-list', 'khatma-rows-list-v3', 'khatma-rows-list-v32');
      const emptyTitle = isOwner ? 'لا توجد ختمات مُدارة بعد' : 'لا توجد ختمات بعد';
      const emptyBody = isOwner ? 'ابدأ بإنشاء ختمة مُدارة وتعيين القراء على الأجزاء.' : 'ابدأ بإنشاء ختمة وتعيين القراء على الأجزاء.';
      const emptyBtn = isOwner ? 'إنشاء ختمة مُدارة' : 'إنشاء ختمة';
      list.innerHTML = `<article class="feature-card empty-state"><h3>${emptyTitle}</h3><p>${emptyBody}</p><a class="btn primary" href="#/managed-create">${emptyBtn}</a></article>`;
      return;
    }
    list.classList.add('khatma-rows-list', 'khatma-rows-list-v3', 'khatma-rows-list-v32');
    const listTitle = isOwner ? 'قائمة الختمات المُدارة' : 'قائمة الختمات';
    const createTitle = isOwner ? 'إنشاء ختمة مُدارة' : 'إنشاء ختمة';
    const toolbar = `<div class="khatma-list-toolbar v32 glass">
      <div class="khatma-list-toolbar-title"><h3>${listTitle}</h3><p>${state.managedKhatmas.length} ختمة محفوظة</p></div>
      <div class="icon-action-group v32">
        <a class="icon-action v32" href="#/managed-create" title="${createTitle}"><span aria-hidden="true">+</span><strong>إنشاء</strong></a>
        <button class="icon-action v32" type="button" onclick="exportManagedKhatmasCsv()" title="تصدير ملف CSV"><span aria-hidden="true">⇩</span><strong>CSV / Excel</strong></button>
        <button class="icon-action v32" type="button" onclick="printManagedKhatmasList()" title="طباعة أو حفظ PDF"><span aria-hidden="true">⎙</span><strong>طباعة / PDF</strong></button>
      </div>
    </div>`;
    list.innerHTML = toolbar + state.managedKhatmas.map(managedKhatmaListRowHtml).join('');
  });
}
function managedKhatmaListRowHtml(k){
  const p = managedProgress(k); const status = managedKhatmaStatus(k);
  const meta = [k.hijriDate || '', k.gregorianDate || ''].filter(Boolean).join(' - ') || 'لا يوجد تاريخ محدد';
  return `<article class="khatma-list-row v32 glass">
    <div class="khatma-list-main v32">
      <div class="khatma-list-content v32">
        <div class="khatma-list-badges v32">
          <span class="mini-pill v32">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : khatmaFallbackLabel())}</span>
          <span class="mini-pill v32 status ${status.className}">${status.label}</span>
          ${k.sharedCreatorGroupId ? `<span class="mini-pill v32" style="background:rgba(15,95,69,.13);color:var(--primary)">مشارك</span>` : ''}
        </div>
        <div class="khatma-list-titleline v32"><h3>${escapeHtml(k.title)}</h3><p>${escapeHtml(meta)}</p></div>
      </div>
      <div class="khatma-list-side v32">
        <div class="khatma-list-progress v32"><strong>${p.pct}%</strong><span>${p.completed} مكتمل · ${p.active} مُعيّن / جاري</span></div>
        <div class="khatma-list-actions v32">
          <a class="mini-icon-btn primary v32" href="#/managed-khatma/${k.id}" title="فتح"><span aria-hidden="true">↗</span><strong>فتح</strong></a>
          <a class="mini-icon-btn v32" href="#/managed-khatma/${k.id}/manage" title="إدارة"><span aria-hidden="true">⚙</span><strong>إدارة</strong></a>
        </div>
      </div>
    </div>
  </article>`;
}
async function setupManagedCreate(){
  const form = document.getElementById('managedCreateForm');
  if(!canUseManagedKhatmas()){
    form.outerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3><p>إنشاء الختمات المُدارة مخصص للمالك أو منشئ الختمات المتحكم.</p></article>`;
    return;
  }
  const isOwner = state.user?.role === 'owner';
  // Patch page-head eyebrow and submit button for non-owners
  if(!isOwner){
    const eyebrow = document.querySelector('.page-head .eyebrow');
    if(eyebrow && eyebrow.textContent.includes('مُدارة')) eyebrow.textContent = 'ختمة';
    const submitBtn = form.querySelector('button[type="submit"]');
    if(submitBtn && submitBtn.textContent.includes('مُدارة')) submitBtn.textContent = 'حفظ الختمة';
  }

  // Register critical listeners BEFORE async operations
  document.getElementById('loadManagedKhatmaTemplate')?.addEventListener('click', ()=>openKhatmaTemplatesDialog(form));
  document.getElementById('exportManagedTemplate')?.remove();
  document.getElementById('importManagedCsv')?.remove();
  document.getElementById('managedCsvFile')?.remove();
  document.getElementById('previewManagedKhatmaMessage')?.addEventListener('click', () => {
    const data = Object.fromEntries(new FormData(form).entries());
    const draft = {id:'managed-preview', title:data.title || 'ختمة مُدارة', weekNumber:data.weekNumber || '-', khatmaType:data.khatmaType || 'monthly', hijriDate:data.hijriDate || '', gregorianDate:data.gregorianDate || '', dedication:data.dedication || '', quoteBy:data.quoteBy || '', quoteText:data.quoteText || '', quoteSource:data.quoteSource || '', notes:data.notes || ''};
    const box = document.getElementById('managedCreatePreviewBox');
    if(box){ box.hidden = false; box.innerHTML = `<div class="sheet-head"><h3>معاينة رسالة المشاركة</h3><span>قبل الحفظ</span></div><div class="message-preview">${escapeHtml(buildManagedWhatsAppMessage(draft)).replace(/#\/managed-khatma\/managed-preview/g, '#/managed-khatma/بعد-الحفظ')}</div>`; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try{
      const data = managedEditorPayload(form);
      const res = await api('/managed-khatmas', {method:'POST', body:data});
      state.managedKhatmas.unshift(res.khatma);
      toast(isOwner ? 'تم حفظ الختمة المُدارة' : 'تم حفظ الختمة');
      location.hash = '#/managed-khatma/' + res.khatma.id + '/manage';
    }catch(err){ toast(err.message || (isOwner ? 'تعذر حفظ الختمة المُدارة' : 'تعذر حفظ الختمة')); }
  });

  // Auto-fill week number with next available
  const weekNumInput = form.querySelector('[name="weekNumber"]');
  if(weekNumInput && !weekNumInput.value){
    const nums = (state.managedKhatmas || []).map(k=>parseInt(k.weekNumber)).filter(n=>!isNaN(n)&&n>0);
    weekNumInput.value = nums.length ? Math.max(...nums) + 1 : 1;
  }

  // Load groups for group selector
  let groups = [];
  try{ const res = await api('/managed-reader-groups'); groups = res.groups || []; }catch{}

  // Inject group selector before participants panel
  const participantsPanel = form.querySelector('.managed-participants-panel');
  if(participantsPanel){
    const groupSelectorHtml = `<section class="inline-panel action-sheet" id="groupSelectorSection" style="margin-bottom:16px">
      <div class="sheet-head"><h3>اختيار مجموعة القراء</h3><span>اختياري</span></div>
      <p style="color:var(--muted);margin:0 0 10px">اختر مجموعة قراء جاهزة لتعبئة المشاركين تلقائيًا حسب التدوير الحالي.</p>
      <label>مجموعة القراء
        <select id="managedGroupSelector">
          <option value="">— بلا مجموعة (إدخال يدوي) —</option>
          ${groups.map(g => `<option value="${escapeHtml(g.id)}" data-rotation-type="${escapeHtml(g.rotation_type || 'monthly')}" data-rotation-start="${escapeHtml(g.rotation_start_date || '')}">${escapeHtml(g.name)} (${g.readerCount || 0} قارئ)</option>`).join('')}
        </select>
      </label>
      <p id="groupRotationInfo" style="color:var(--primary);font-weight:700;margin-top:8px;display:none"></p>
    </section>`;
    participantsPanel.insertAdjacentHTML('beforebegin', groupSelectorHtml);
  }

  // Load readers into state for group selector use, but don't auto-fill participants
  await refreshManagedReaders();
  syncManagedAssignments(form);
  setupManagedEditor(form, {participants: []});

  // Group selector change handler
  document.getElementById('managedGroupSelector')?.addEventListener('change', async e => {
    const groupId = e.target.value;
    const selected = e.target.selectedOptions[0];
    const rotationType = selected?.dataset.rotationType || 'monthly';
    const rotationStart = selected?.dataset.rotationStart || '';
    const infoEl = document.getElementById('groupRotationInfo');

    if(!groupId){
      if(infoEl) infoEl.style.display = 'none';
      renderManagedParticipantRows(document.getElementById('managedParticipantsRows'), []);
      syncManagedAssignments(form, {});
      return;
    }
    try{
      const res = await api('/managed-readers?groupId=' + encodeURIComponent(groupId));
      const readers = res.readers || [];
      if(!readers.length){ toast('المجموعة لا تحتوي قراء'); return; }

      const periodIndex = computeCurrentPeriodIndex(rotationStart, rotationType);
      const typeLabel = rotationType === 'weekly' ? 'أسبوع' : rotationType === 'monthly' ? 'شهر' : rotationType === 'yearly' ? 'سنة' : 'دورة';
      if(infoEl){ infoEl.style.display = 'block'; infoEl.textContent = `الدورة الحالية: ${currentHijriPeriodLabel(rotationStart, rotationType) || (periodIndex + 1)}${formatPeriodEnd(rotationStart, rotationType) ? ' · ينتهي: ' + formatPeriodEnd(rotationStart, rotationType) : ''} · كل قارئ يرى أجزاءه المحسوبة تلقائيًا`; }

      // Map assignments: juzNumber → accessCode
      const assignments = {};
      readers.forEach(r => {
        const juz = (r.startJuz && r.partsCount) ? computeRotationJuz(r.startJuz, r.partsCount, periodIndex) : [];
        juz.forEach(n => { assignments[n] = r.accessCode; });
      });

      renderManagedParticipantRows(document.getElementById('managedParticipantsRows'), readers);

      // Set custom selection to cover exactly the assigned juz
      const allJuz = [...new Set(Object.keys(assignments).map(Number))].sort((a,b)=>a-b);
      if(allJuz.length){
        const selMode = form.querySelector('[name="selectionMode"]');
        const customSection = document.getElementById('managedCustomUnitsSection');
        if(selMode) selMode.value = 'custom';
        if(customSection){
          customSection.hidden = false;
          renderCustomUnitsPicker(customSection, form.querySelector('[name="division"]')?.value || 'juz');
          customSection.querySelectorAll('input[name="selectedUnit"]').forEach(cb => {
            cb.checked = true; // Show all units; group-covered ones are pre-assigned, uncovered ones stay available for manual assignment
          });
        }
      }

      let gInput = form.querySelector('input[name="groupId"]');
      if(!gInput){ gInput = document.createElement('input'); gInput.type='hidden'; gInput.name='groupId'; form.appendChild(gInput); }
      gInput.value = groupId;
      let rsInput = form.querySelector('input[name="rotationStartDate"]');
      if(!rsInput){ rsInput = document.createElement('input'); rsInput.type='hidden'; rsInput.name='rotationStartDate'; form.appendChild(rsInput); }
      rsInput.value = rotationStart;

      // After rendering rows, sync assignments using accessCode matching
      syncManagedAssignments(form, assignments);
      // setTimeout ensures DOM is settled before forcing assignment values
      setTimeout(() => { applyAssignmentsToGrid(form, assignments); }, 0);
      toast(`تم تحميل ${readers.length} قارئ · ${allJuz.length} جزء معيّن تلقائيًا`);
    }catch(err){ toast(err.message || 'تعذر تحميل قراء المجموعة'); }
  });

}
async function setupManagedKhatma(id, manageMode=false){
  state.currentManagedManageMode = manageMode;
  const includeAdmin = manageMode && canUseManagedKhatmas();
  if(includeAdmin){
    await refreshManagedOne(id, true);
  }else{
    const savedIdentity = getManagedIdentity(id) || '';
    if(savedIdentity){
      try{ await verifyManagedKhatmaIdentity(id, savedIdentity); }
      catch(err){ sessionStorage.removeItem(managedIdentityKey(id)); await refreshManagedOne(id, false); }
    }else{
      await refreshManagedOne(id, false);
    }
  }
  const k = state.managedKhatmas.find(x=>x.id===id);
  const view = document.getElementById('managedKhatmaView');
  if(!k){ view.innerHTML = `<section class="page-head"><h1>${state.user?.role === 'owner' ? 'الختمة المُدارة غير موجودة' : 'الختمة غير موجودة'}</h1><a class="btn primary" href="#/managed-khatmas">الرجوع</a></section>`; return; }
  const isAdmin = includeAdmin && canManageManagedKhatma(k);
  const p = managedProgress(k); const status = managedKhatmaStatus(k); const message = buildManagedWhatsAppMessage(k);
  const manageBadge = manageMode ? '<span class="badge">صفحة إدارة</span>' : '';
  const adminBlock = manageMode ? (isAdmin ? managedAdminPanelHtml(k) : `<div class="admin-panel inline-admin-access"><h3>غير مصرح</h3><p>لا تملك صلاحية إدارة هذه الختمة المُدارة.</p></div>`) : '';
  const shareBlock = manageMode && isAdmin ? `<div class="hero-actions khatma-share-actions"><button class="btn primary compact-btn" id="copyManagedMessage">نسخ رسالة الواتساب</button><button class="btn ghost compact-btn" id="shareManagedWhatsApp">مشاركة واتساب</button></div><div class="message-preview">${escapeHtml(message)}</div>` : '';
  const viewerName = (k.participants || []).find(x => x.name)?.name || '';
  const isVerifiedPublic = !includeAdmin && !manageMode && Boolean(viewerName);
  if(!manageMode && !isVerifiedPublic){
    if(canManageManagedKhatma(k)){ location.hash = '#/managed-khatma/' + id + '/manage'; return; }
    view.innerHTML = `<section class="page-head"><span class="eyebrow">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : khatmaFallbackLabel())}</span><h1>${escapeHtml(k.title)}</h1><p>${escapeHtml(k.hijriDate || '')} - ${escapeHtml(k.gregorianDate || '')}</p><div class="status-line"><span class="badge ${status.className}">${status.label}</span></div></section><section class="khatma-detail glass"><div class="countdown-card ${countdownClass(k)}" data-countdown-for="${k.id}">${countdownHtml(k)}</div><form id="managedVerifyForm" class="inline-panel action-sheet"><div class="sheet-head"><h3>التحقق من بيانات القارئ</h3><span>خصوصية الأجزاء</span></div><p>أدخل الكود أو رقم الجوال أو الاسم الكامل للاطلاع على أجزائك فقط.</p><label>الكود أو الجوال أو الاسم<input id="managedVerifyIdentity" autocomplete="off" placeholder="الكود أو 05XXXXXXXX أو الاسم" /></label><button class="btn primary wide" type="submit">عرض أجزائي</button></form></section>`;
    document.getElementById('managedVerifyForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const input = document.getElementById('managedVerifyIdentity');
      const identity = input?.value.trim() || '';
      if(!identity){ toast('أدخل رقم الجوال أو الكود أولًا'); input?.focus(); return; }
      try{ await verifyManagedKhatmaIdentity(k.id, identity); toast('تم التحقق'); setupManagedKhatma(k.id, false); }
      catch(err){ toast(err.message || 'تعذر التحقق من البيانات'); input?.focus(); }
    });
    return;
  }
  const filteredUnits = filterManagedUnits(k.units || []);
  const emptyUnits = filteredUnits.length ? '' : '<article class="feature-card empty-state"><h3>لا توجد نتائج</h3><p>غيّر الفلتر أو البحث لعرض الأجزاء.</p></article>';
  const viewerBlock = isVerifiedPublic ? `<div class="inline-panel action-sheet"><div class="sheet-head"><h3>${escapeHtml(viewerName)}</h3><span>أجزاؤك في هذه الختمة</span></div><p>يمكنك تحديث حالة الأجزاء المخصصة لك فقط.</p></div>` : '';
  const toolsBlock = isAdmin ? managedKhatmaToolsHtml(k) : '';
  const rotStart = k.rotationStartDate || k.khatmaDate || k.createdAt || '';
  const periodEndDisplay = rotStart ? formatPeriodEnd(rotStart, k.khatmaType) : '';
  const periodLabelDisplay = rotStart ? currentHijriPeriodLabel(rotStart, k.khatmaType) : '';
  const periodStatHtml = periodEndDisplay ? `<div><strong>${periodLabelDisplay || '—'}</strong><span>الدورة الحالية</span></div><div><strong>${periodEndDisplay}</strong><span>نهاية الدورة</span></div>` : '';
  view.innerHTML = `<section class="page-head"><span class="eyebrow">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : khatmaFallbackLabel())}</span><h1>${escapeHtml(k.title)}</h1><p>${escapeHtml(k.hijriDate || '')} - ${escapeHtml(k.gregorianDate || '')}</p><div class="status-line"><span class="badge ${status.className}">${status.label}</span>${manageBadge}</div></section><section class="khatma-detail glass"><div class="mini-stats"><div><strong>${p.pct}%</strong><span>الإنجاز</span></div><div><strong>${p.completed}</strong><span>مكتمل</span></div><div><strong>${p.active}</strong><span>مُعيّن / جاري</span></div>${periodStatHtml}</div><div class="countdown-card ${countdownClass(k)}" data-countdown-for="${k.id}">${countdownHtml(k)}</div>${viewerBlock}${shareBlock}${toolsBlock}${adminBlock}</section><section class="unit-toolbar glass"><label>تصفية الأجزاء<select id="managedUnitStatusFilter"><option value="all">الكل</option><option value="available">غير معيّن</option><option value="assigned">مُعيّن</option><option value="reading">جاري القراءة</option><option value="completed">تمت القراءة</option></select></label><label>بحث<input id="managedUnitSearchInput" placeholder="ابحث في أجزائك" /></label></section><section class="units-grid">${filteredUnits.map(unit => managedUnitCardHtml(k, unit, isAdmin)).join('')}${emptyUnits}</section>`;
  document.getElementById('copyManagedMessage')?.addEventListener('click', ()=>copyText(message));
  document.getElementById('shareManagedWhatsApp')?.addEventListener('click', ()=> window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank'));
  const filterSelect = document.getElementById('managedUnitStatusFilter');
  const searchInput = document.getElementById('managedUnitSearchInput');
  if(filterSelect){ filterSelect.value = state.activeManagedUnitFilter; filterSelect.addEventListener('change', e=>{ state.activeManagedUnitFilter = e.target.value; setupManagedKhatma(k.id, manageMode); }); }
  if(searchInput){ searchInput.value = state.activeManagedUnitSearch; searchInput.addEventListener('change', e=>{ state.activeManagedUnitSearch = e.target.value; setupManagedKhatma(k.id, manageMode); }); }
  view.querySelectorAll('[data-managed-action]').forEach(btn => btn.addEventListener('click', event => { event.stopPropagation(); handleManagedUnitAction(k.id, Number(btn.dataset.unit), btn.dataset.managedAction, isAdmin); }));
  view.querySelectorAll('[data-managed-identity]').forEach(input => input.addEventListener('keydown', event => { if(event.key === 'Enter'){ event.preventDefault(); const [unit, action] = input.dataset.managedIdentity.split(':'); handleManagedUnitAction(k.id, Number(unit), action, false); } }));
  if(isAdmin) bindManagedAdminActions(k);
}
function filterManagedUnits(units){
  const filter = state.activeManagedUnitFilter || 'all';
  const q = (state.activeManagedUnitSearch || '').trim().toLowerCase();
  return units.filter(unit => {
    const byStatus = filter === 'all' || unit.status === filter;
    const hay = `${unit.label || ''} ${unit.number || ''} ${unit.participantName || ''}`.toLowerCase();
    return byStatus && (!q || hay.includes(q));
  });
}
function managedUnitCardHtml(k, unit, isAdmin){
  const openKey = `${k.id}:${unit.number}`;
  const isOpen = state.activeManagedUnitKey.startsWith(openKey + ':');
  const action = isOpen ? state.activeManagedUnitKey.split(':')[2] : '';
  const name = escapeHtml(unit.participantName || '');
  const title = `<strong>${escapeHtml(unit.label)}</strong><small><span class="status-dot">${managedStatusLabel(unit.status)}${name ? ': ' + name : ''}</span></small>`;
  const identityPanel = isOpen ? `<div class="unit-inline"><input data-managed-identity="${unit.number}:${action}" placeholder="رقم الجوال أو الكود المكون من 10 أرقام" autocomplete="off" inputmode="numeric" /><div class="unit-actions two"><button class="btn primary" data-managed-action="${action}" data-unit="${unit.number}">تأكيد</button><button class="btn ghost" data-managed-action="cancel" data-unit="${unit.number}">إلغاء</button></div></div>` : '';
  if(unit.status === 'available') return `<article class="unit available" data-unit="${unit.number}">${title}<small>يتم تعيين القارئ من صفحة الإدارة.</small></article>`;
  const reset = isAdmin ? `<button class="btn ghost" data-managed-action="available" data-unit="${unit.number}">إعادة إتاحة</button>` : '';
  const reading = `<button class="btn ghost" data-managed-action="reading-open" data-unit="${unit.number}">جاري القراءة</button>`;
  const complete = `<button class="btn primary" data-managed-action="complete-open" data-unit="${unit.number}">تمت القراءة</button>`;
  const directReading = `<button class="btn ghost" data-managed-action="reading" data-unit="${unit.number}">جاري القراءة</button>`;
  const directComplete = `<button class="btn primary" data-managed-action="complete" data-unit="${unit.number}">تمت القراءة</button>`;
  const actions = isAdmin ? `<div class="unit-actions three">${directReading}${directComplete}${reset}</div>` : `<div class="unit-actions two">${reading}${complete}</div>`;
  return `<article class="unit ${unit.status}" data-unit="${unit.number}">${title}${actions}${identityPanel}</article>`;
}
function canManageManagedKhatma(k){ return !!(state.user && (state.user.role === 'owner' || state.user.managedKhatmaCreator)); }
async function handleManagedUnitAction(khatmaId, num, action, isAdmin){
  if(action === 'cancel'){ state.activeManagedUnitKey = ''; setupManagedKhatma(khatmaId, state.currentManagedManageMode); return; }
  const savedIdentity = getManagedIdentity(khatmaId) || '';
  if(!isAdmin && (action === 'reading-open' || action === 'complete-open')){
    if(savedIdentity){
      action = action === 'reading-open' ? 'reading' : 'complete';
    }else{
    state.activeManagedUnitKey = `${khatmaId}:${num}:${action === 'reading-open' ? 'reading' : 'complete'}`;
    setupManagedKhatma(khatmaId, state.currentManagedManageMode);
    setTimeout(()=>document.querySelector(`[data-managed-identity="${num}:${action === 'reading-open' ? 'reading' : 'complete'}"]`)?.focus(), 80);
    return;
    }
  }
  const body = {};
  if(!isAdmin && (action === 'reading' || action === 'complete')){
    const input = document.querySelector(`[data-managed-identity="${num}:${action}"]`);
    const identity = savedIdentity || input?.value.trim() || '';
    if(!identity){ toast('أدخل رقم الجوال أو الكود أولًا'); input?.focus(); return; }
    body.identity = identity;
  }
  try{
    const apiAction = action === 'available' ? 'available' : action;
    const res = await api(`/managed-khatmas/${encodeURIComponent(khatmaId)}/units/${num}/${apiAction}`, {method:'POST', body});
    if(res.khatma) upsertManagedKhatma(res.khatma);
    state.activeManagedUnitKey = '';
    toast(action === 'reading' ? 'تم تحديث الحالة إلى جاري القراءة' : action === 'complete' ? 'تم تسجيل القراءة' : 'تمت إعادة إتاحة الجزء');
    if(isAdmin || !res.khatma) await refreshManagedOne(khatmaId, state.currentManagedManageMode && canUseManagedKhatmas());
    setupManagedKhatma(khatmaId, state.currentManagedManageMode);
  }catch(err){ toast(err.message || 'تعذر تنفيذ الإجراء'); }
}
function rotationMonitorHtml(k){
  const participants = (k.participants || []).filter(p => p.startJuz && p.partsCount);
  if(!participants.length) return '';
  const rotationType = k.khatmaType || 'monthly';
  const rotationStartDate = k.rotationStartDate || k.khatmaDate || k.createdAt || '';
  const currentPeriod = computeCurrentPeriodIndex(rotationStartDate, rotationType);
  const periodEndLabel = formatPeriodEnd(rotationStartDate, rotationType);
  const currentLabel = currentHijriPeriodLabel(rotationStartDate, rotationType) || `الدورة ${currentPeriod + 1}`;
  const futurePeriods = 4;
  const periodRows = Array.from({length: futurePeriods + 1}, (_, i) => {
    const p = currentPeriod + i;
    let rowLabel, rowMeta;
    if(rotationType === 'monthly'){
      const hm = getHijriMonthAtOffset(rotationStartDate, p);
      rowLabel = `${hm.name} ${hm.year} هـ`;
      rowMeta = i === 0 ? `<span style="color:var(--muted);font-size:12px">ينتهي: ${periodEndLabel}</span> &nbsp;` : '';
    } else if(rotationType === 'weekly'){
      const s = new Date(rotationStartDate || Date.now());
      const ws = new Date(s.getTime() + p * 7 * 86400000);
      const we = new Date(s.getTime() + (p + 1) * 7 * 86400000 - 86400000);
      const fmt = d => d.toLocaleDateString('ar-SA-u-ca-gregory', {day:'numeric', month:'numeric'});
      rowLabel = `أسبوع ${p + 1}`;
      rowMeta = `<span style="color:var(--muted);font-size:12px">${fmt(ws)} – ${fmt(we)}</span> &nbsp;`;
    } else {
      rowLabel = `دورة ${p + 1}`;
      rowMeta = '';
    }
    return `<div class="owner-row" style="${i===0?'background:var(--primary-soft);':''}">
      <div class="owner-row-main">
        <strong class="owner-row-title">${rowLabel}${i===0?' (الحالية)':i===1?' (التالية)':''}</strong>
        <span class="owner-row-meta">${rowMeta}${participants.map(part => {
          const juz = computeRotationJuz(part.startJuz, part.partsCount, p);
          return `${escapeHtml(part.name||'قارئ')}: ج${juz.join('، ج')}`;
        }).join(' &nbsp;|&nbsp; ')}</span>
      </div>
    </div>`;
  }).join('');
  return `<div class="inline-panel action-sheet" style="margin-top:14px">
    <div class="sheet-head"><h4>خطة التدوير</h4><span>${currentLabel}${periodEndLabel ? ' · ينتهي: ' + periodEndLabel : ''}</span></div>
    <div class="managed-table">${periodRows}</div>
  </div>`;
}
function managedAdminPanelHtml(k){
  const deleteConfirm = state.activeDeleteManagedKhatmaId === k.id ? `<div class="inline-panel danger-inline admin-danger-card action-sheet"><div class="sheet-head"><h4>حذف الختمة المُدارة</h4><span>تأكيد نهائي</span></div><p>هذا الإجراء حذف جذري من قاعدة البيانات. اكتب كلمة <strong>حذف</strong> للتأكيد.</p><label class="inline-label">تأكيد الحذف<input id="deleteManagedKhatmaConfirmText" placeholder="اكتب حذف" autocomplete="off" /></label><div class="compact-actions"><button class="btn danger-btn compact-btn" id="confirmDeleteManagedKhatmaAdmin">حذف الختمة نهائيًا</button><button class="btn ghost compact-btn" id="cancelDeleteManagedKhatmaAdmin">إلغاء</button></div></div>` : '';
  const updateForm = state.activeUpdateManagedKhatmaId === k.id ? managedUpdateFormHtml(k) : '';
  const duplicateConfirm = state.activeDuplicateManagedKhatmaId === k.id ? `<div class="inline-panel action-sheet"><div class="sheet-head"><h4>نسخ الختمة المُدارة</h4><span>اختر الخيار</span></div><p>هل تريد نسخ القراء أيضًا إلى الختمة الجديدة؟</p><div class="compact-actions"><button class="btn primary compact-btn" id="confirmDuplicateManagedWithReaders">نسخ مع القراء</button><button class="btn ghost compact-btn" id="confirmDuplicateManagedWithoutReaders">نسخ بدون قراء</button><button class="btn ghost compact-btn" id="cancelDuplicateManagedKhatma">إلغاء</button></div></div>` : '';
  const shareKhatmaBtn = state.user?.role === 'owner' ? `<button class="btn ghost compact-btn" id="shareManagedKhatmaBtn">مشاركة مع مجموعة${k.sharedCreatorGroupId ? ' ✓' : ''}</button>` : '';
  return `<div class="admin-panel premium-admin-panel compact-khatma-admin"><div class="sheet-head"><h3>إدارة الختمة المُدارة</h3><span>حساب مصرح</span></div><p>يمكنك تعديل المشاركين، الأكواد، وربط القراء بالأجزاء من هذه اللوحة.</p><div class="admin-actions tidy-admin-actions khatma-admin-actions"><button class="btn ghost compact-btn" id="copyManagedPublicLink">نسخ رابط المشاركة</button><button class="btn ghost compact-btn" id="openUpdateManagedKhatma">تحديث الختمة</button><button class="btn ghost compact-btn" id="toggleCloseManagedKhatma">${k.status === 'closed' ? 'إعادة فتح الختمة' : 'إنهاء / إغلاق الختمة'}</button><button class="btn ghost compact-btn" id="archiveManagedKhatmaBtn">${k.archivedAt ? 'إلغاء الأرشفة' : 'أرشفة الختمة'}</button><button class="btn ghost compact-btn" id="duplicateManagedKhatmaBtn">نسخ الختمة</button>${shareKhatmaBtn}<button class="btn ghost danger-btn compact-btn" id="deleteManagedKhatmaAdmin">حذف الختمة</button></div><div id="shareManagedKhatmaPanel"></div>${rotationMonitorHtml(k)}${updateForm}${duplicateConfirm}${deleteConfirm}</div>`;
}
function managedUpdateFormHtml(k){
  const phoneFields = coordinatorPhoneFieldsHtml(k.coordinatorWhatsapp || '');
  const divisionField = k.selectionMode === 'custom'
    ? `<input type="hidden" name="division" value="${escapeHtml(k.division)}" /><input type="hidden" name="selectionMode" value="custom" /><div class="full" data-managed-custom-units-section></div>`
    : `<label>نوع التقسيم<select name="division"><option value="juz" ${k.division === 'juz' ? 'selected' : ''}>أجزاء - 30</option><option value="hizb" ${k.division === 'hizb' ? 'selected' : ''}>أحزاب - 60</option><option value="quarter" ${k.division === 'quarter' ? 'selected' : ''}>أرباع - 240</option></select></label><input type="hidden" name="selectionMode" value="all" />`;
  return `<form id="updateManagedKhatmaForm" class="inline-panel action-sheet update-khatma-form"><div class="sheet-head"><h4>تحديث بيانات الختمة المُدارة</h4><span>تحديث كامل</span></div><div class="form-grid">
    <label>عنوان الختمة<input name="title" required value="${escapeHtml(k.title || '')}" /></label>
    <label>رقم الختمة<input name="weekNumber" type="number" min="1" value="${escapeHtml(k.weekNumber || '')}" /></label>
    <label>نوع الختمة<select name="khatmaType">${khatmaTypeOptionsHtml(k.khatmaType)}</select></label>
    <label>تاريخ الختمة<input name="khatmaDate" type="date" value="${escapeHtml(k.khatmaDate || '')}" /></label>
    <label>اليوم والتاريخ الهجري<input name="hijriDate" value="${escapeHtml(k.hijriDate || '')}" /></label>
    <label>التاريخ الميلادي<input name="gregorianDate" value="${escapeHtml(k.gregorianDate || '')}" /></label>
    ${k.rotationStartDate ? `<div class="full" style="padding:8px 0"><span style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px">⟳ تاريخ انتهاء الدورة يُحدَّث تلقائيًا · <strong style="color:var(--primary)">${formatPeriodEnd(k.rotationStartDate, k.khatmaType) || '—'}</strong></span></div>` : ''}
    ${divisionField}
    <label>اسم منسق الختمة<input name="coordinatorName" value="${escapeHtml(k.coordinatorName || currentUserDisplayName())}" /></label>
    ${phoneFields}
  </div><section class="inline-panel action-sheet"><div class="sheet-head"><h3>جدول المشاركين</h3><span>تحديث</span></div><div data-managed-participants-rows class="managed-table"></div><div class="compact-actions"><button class="btn ghost compact-btn" type="button" data-add-managed-participant>إضافة مشارك</button><button class="btn ghost compact-btn" type="button" data-generate-managed-codes>توليد الأكواد</button></div></section><section class="inline-panel action-sheet"><div class="sheet-head"><h3>تعيين القراء</h3><span data-managed-assignment-count>0 تعيين</span></div><div data-managed-assignments-grid class="managed-assignments-grid"></div></section><div class="quote-meta-row"><label>القائل<input name="quoteBy" value="${escapeHtml(k.quoteBy || '')}" /></label><label>المصدر<input name="quoteSource" value="${escapeHtml(k.quoteSource || '')}" /></label></div><label>النص<textarea name="quoteText" rows="3">${escapeHtml(k.quoteText || '')}</textarea></label><label>إهداء الختمة<textarea name="dedication" rows="4">${escapeHtml(k.dedication || '')}</textarea></label><label>تنويهات المشاركة<textarea name="notes" rows="4">${escapeHtml(k.notes || '')}</textarea></label><div class="compact-actions"><button class="btn primary compact-btn" type="submit">حفظ التحديث</button><button class="btn ghost compact-btn" type="button" id="cancelUpdateManagedKhatma">إلغاء</button></div></form>`;
}
function bindManagedAdminActions(k){
  document.getElementById('copyManagedPublicLink')?.addEventListener('click', ()=>copyText(location.href.split('#')[0] + '#/managed-khatma/' + k.id));
  document.getElementById('openUpdateManagedKhatma')?.addEventListener('click', ()=>{ state.activeUpdateManagedKhatmaId = k.id; setupManagedKhatma(k.id, true); });
  document.getElementById('cancelUpdateManagedKhatma')?.addEventListener('click', ()=>{ state.activeUpdateManagedKhatmaId = ''; setupManagedKhatma(k.id, true); });
  const updateForm = document.getElementById('updateManagedKhatmaForm');
  if(updateForm){ setupManagedEditor(updateForm, k); updateForm.addEventListener('submit', e=>saveManagedKhatmaUpdate(e, k.id)); }
  document.getElementById('toggleCloseManagedKhatma')?.addEventListener('click', ()=>toggleCloseManagedKhatma(k.id));
  document.getElementById('archiveManagedKhatmaBtn')?.addEventListener('click', ()=>archiveManagedKhatmaAction(k.id, !k.archivedAt));
  document.getElementById('duplicateManagedKhatmaBtn')?.addEventListener('click', ()=>{ state.activeDuplicateManagedKhatmaId = k.id; state.activeDeleteManagedKhatmaId = ''; state.activeUpdateManagedKhatmaId = ''; setupManagedKhatma(k.id, true); });
  document.getElementById('cancelDuplicateManagedKhatma')?.addEventListener('click', ()=>{ state.activeDuplicateManagedKhatmaId = ''; setupManagedKhatma(k.id, true); });
  document.getElementById('confirmDuplicateManagedWithReaders')?.addEventListener('click', ()=>executeDuplicateManagedKhatma(k.id, true));
  document.getElementById('confirmDuplicateManagedWithoutReaders')?.addEventListener('click', ()=>executeDuplicateManagedKhatma(k.id, false));
  document.getElementById('deleteManagedKhatmaAdmin')?.addEventListener('click', ()=>{ state.activeDeleteManagedKhatmaId = k.id; state.activeUpdateManagedKhatmaId = ''; state.activeDuplicateManagedKhatmaId = ''; setupManagedKhatma(k.id, true); });
  document.getElementById('cancelDeleteManagedKhatmaAdmin')?.addEventListener('click', ()=>{ state.activeDeleteManagedKhatmaId = ''; setupManagedKhatma(k.id, true); });
  document.getElementById('confirmDeleteManagedKhatmaAdmin')?.addEventListener('click', ()=>confirmDeleteManagedKhatmaAdmin(k.id));
  document.getElementById('shareManagedKhatmaBtn')?.addEventListener('click', ()=>openShareKhatmaPanel(k));
}
async function openShareKhatmaPanel(k){
  const panel = document.getElementById('shareManagedKhatmaPanel');
  if(!panel) return;
  panel.innerHTML = '<p style="color:var(--muted);font-size:13px">جاري تحميل المجموعات…</p>';
  try {
    const res = await api('/managed-creator-groups');
    const groups = res.groups || [];
    const opts = groups.map(g => `<option value="${escapeHtml(g.id)}" ${k.sharedCreatorGroupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
    panel.innerHTML = `<div class="inline-panel action-sheet" style="margin-top:10px"><div class="sheet-head"><h4>مشاركة الختمة مع مجموعة منشئين</h4><span>الوصول المشترك</span></div>
      <label style="display:block;margin-bottom:8px">المجموعة<select id="shareKhatmaGroupSelect" style="width:100%;margin-top:4px">
        <option value="">— بلا مشاركة —</option>${opts}
      </select></label>
      <div class="compact-actions">
        <button class="btn primary compact-btn" id="confirmShareKhatmaBtn">حفظ</button>
        <button class="btn ghost compact-btn" id="cancelShareKhatmaBtn">إلغاء</button>
      </div></div>`;
    document.getElementById('cancelShareKhatmaBtn')?.addEventListener('click', ()=>{ panel.innerHTML = ''; });
    document.getElementById('confirmShareKhatmaBtn')?.addEventListener('click', async ()=>{
      const groupId = document.getElementById('shareKhatmaGroupSelect')?.value || '';
      try {
        const r = await api('/managed-khatmas/' + encodeURIComponent(k.id) + '/admin/share', {method:'POST', body:{groupId: groupId || null}});
        const idx = state.managedKhatmas.findIndex(x=>x.id===k.id);
        if(idx>=0) state.managedKhatmas[idx] = {...state.managedKhatmas[idx], sharedCreatorGroupId: r.sharedCreatorGroupId || ''};
        toast(groupId ? 'تمت المشاركة مع المجموعة' : 'تم إلغاء المشاركة');
        setupManagedKhatma(k.id, true);
      } catch(err){ toast(err.message || 'تعذرت المشاركة'); }
    });
  } catch(err){ panel.innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message || 'تعذر تحميل المجموعات')}</p>`; }
}
async function saveManagedKhatmaUpdate(event, id){
  event.preventDefault();
  try{
    const data = managedEditorPayload(event.currentTarget);
    const res = await api('/managed-khatmas/' + encodeURIComponent(id) + '/admin/update', {method:'POST', body:data});
    const idx = state.managedKhatmas.findIndex(x=>x.id === id);
    if(idx >= 0) state.managedKhatmas[idx] = res.khatma;
    state.activeUpdateManagedKhatmaId = '';
    toast('تم تحديث الختمة المُدارة');
    setupManagedKhatma(id, true);
  }catch(err){ toast(err.message || 'تعذر تحديث الختمة المُدارة'); }
}
async function toggleCloseManagedKhatma(id){
  try{
    const res = await api('/managed-khatmas/' + encodeURIComponent(id) + '/admin/toggle-close', {method:'POST', body:{}});
    await refreshManagedOne(id, true);
    toast(res.status === 'closed' ? 'تم إغلاق الختمة المُدارة' : 'تم إعادة فتح الختمة المُدارة');
    setupManagedKhatma(id, true);
  }catch(err){ toast(err.message || 'تعذر تحديث الختمة المُدارة'); }
}
async function confirmDeleteManagedKhatmaAdmin(id){
  const confirmInput = document.getElementById('deleteManagedKhatmaConfirmText');
  if(confirmInput && confirmInput.value.trim() !== 'حذف'){ toast('اكتب كلمة حذف للتأكيد'); confirmInput.focus(); return; }
  try{
    await api('/managed-khatmas/' + encodeURIComponent(id) + '/admin/delete', {method:'POST', body:{}});
    state.managedKhatmas = state.managedKhatmas.filter(x=>x.id!==id);
    state.activeDeleteManagedKhatmaId = '';
    toast('تم حذف الختمة المُدارة'); location.hash = '#/managed-khatmas';
  }catch(err){ toast(err.message || 'تعذر حذف الختمة المُدارة'); }
}
async function archiveManagedKhatmaAction(id, doArchive){
  try{
    const action = doArchive ? 'archive' : 'unarchive';
    await api('/managed-khatmas/' + encodeURIComponent(id) + '/admin/' + action, {method:'POST', body:{}});
    await refreshManagedOne(id, true);
    toast(doArchive ? 'تم أرشفة الختمة المُدارة' : 'تم إلغاء أرشفة الختمة المُدارة');
    if(doArchive) location.hash = '#/managed-khatmas';
    else setupManagedKhatma(id, true);
  }catch(err){ toast(err.message || 'تعذر تحديث الختمة المُدارة'); }
}
async function executeDuplicateManagedKhatma(id, withParticipants){
  try{
    const res = await api('/managed-khatmas/' + encodeURIComponent(id) + '/admin/duplicate', {method:'POST', body:{withParticipants}});
    state.activeDuplicateManagedKhatmaId = '';
    if(state.managedKhatmas) state.managedKhatmas.push(res.khatma);
    toast('تم نسخ الختمة المُدارة بنجاح');
    location.hash = '#/managed-khatma/' + res.newId + '/manage';
  }catch(err){ toast(err.message || 'تعذر نسخ الختمة المُدارة'); }
}
async function setupManagedKhatmasArchived(){
  const view = document.getElementById('managedKhatmasArchivedView');
  if(!canUseManagedKhatmas()){ view.innerHTML = `<article class="feature-card empty-state"><h3>غير مصرح</h3></article>`; return; }
  view.innerHTML = `<section class="page-head"><span class="eyebrow">الأرشيف</span><h1>الختمات المؤرشفة</h1></section><article class="feature-card empty-state"><h3>جاري التحميل...</h3></article>`;
  try{
    const res = await api('/managed-khatmas?status=archived');
    const khatmas = res.khatmas || [];
    if(!khatmas.length){
      view.innerHTML = `<section class="page-head"><span class="eyebrow">الأرشيف</span><h1>الختمات المؤرشفة</h1></section><article class="feature-card empty-state"><h3>لا توجد ختمات مؤرشفة</h3><p>الختمات التي تُؤرشفها ستظهر هنا.</p><a class="btn ghost" href="#/managed-khatmas">العودة للقائمة</a></article>`;
      return;
    }
    const rows = khatmas.map(k => {
      const p = managedProgress(k);
      const archivedDate = k.archivedAt ? new Date(k.archivedAt).toLocaleDateString('ar-SA-u-ca-gregory',{day:'numeric',month:'long',year:'numeric'}) : '';
      return `<article class="khatma-list-row v32 glass" style="opacity:0.8;margin-bottom:10px">
        <div class="khatma-list-main v32">
          <div class="khatma-list-content v32">
            <div class="khatma-list-badges v32">
              <span class="mini-pill v32">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : khatmaFallbackLabel())}</span>
              <span class="mini-pill v32 status" style="background:#888;color:#fff">مؤرشفة</span>
            </div>
            <div class="khatma-list-titleline v32"><h3>${escapeHtml(k.title)}</h3><p>${archivedDate ? 'أُرشفت: ' + archivedDate : ''}</p></div>
            <div style="margin-top:8px;background:var(--line);border-radius:99px;height:5px;overflow:hidden"><div style="width:${p.pct}%;background:#888;height:100%;border-radius:99px"></div></div>
            <p style="margin:4px 0 0;color:var(--muted);font-size:13px">${p.pct}% مكتمل</p>
          </div>
          <div class="khatma-list-side v32"><div class="khatma-list-actions v32">
            <a class="mini-icon-btn v32" href="#/managed-khatma/${escapeHtml(k.id)}/manage">فتح</a>
            <button class="mini-icon-btn v32" onclick="archiveManagedKhatmaAction('${escapeJs(k.id)}', false)">إلغاء الأرشفة</button>
          </div></div>
        </div>
      </article>`;
    }).join('');
    view.innerHTML = `<section class="page-head"><span class="eyebrow">الأرشيف</span><h1>الختمات المؤرشفة</h1><p>${khatmas.length} ختمة مؤرشفة</p></section>
      <div style="margin-bottom:12px"><a class="btn ghost compact-btn" href="#/managed-khatmas">← القائمة الرئيسية</a></div>
      <div class="khatma-rows-list khatma-rows-list-v3 khatma-rows-list-v32">${rows}</div>`;
  }catch(err){ view.innerHTML += `<article class="feature-card empty-state"><h3>تعذر التحميل</h3><p>${escapeHtml(err.message)}</p></article>`; }
}
function buildManagedWhatsAppMessage(k){
  return buildWhatsAppMessage(k, {managed:true});
}
function managedKhatmaToolsHtml(k){
  return `<div class="khatma-tools-bar v32"><div class="icon-action-group v32">
    <button class="icon-action v32" type="button" onclick="exportSingleManagedKhatmaCsv('${escapeJs(k.id)}')" title="تصدير ملف CSV"><span aria-hidden="true">⇩</span><strong>CSV / Excel</strong></button>
    <button class="icon-action v32" type="button" onclick="printSingleManagedKhatma('${escapeJs(k.id)}')" title="طباعة الختمة أو حفظ PDF"><span aria-hidden="true">⎙</span><strong>طباعة / PDF</strong></button>
  </div></div>`;
}

async function setupKhatma(id, manageMode=false){
  state.currentManageMode = manageMode;
  await refreshOne(id);
  const k = state.khatmas.find(x=>x.id===id);
  const view = document.getElementById('khatmaView');
  if(!k){ view.innerHTML = `<section class="page-head"><h1>الختمة غير موجودة</h1><a class="btn primary" href="#/khatmas">الرجوع</a></section>`; return; }
  const p = progress(k); const status = khatmaStatus(k); const message = buildWhatsAppMessage(k); const isAdmin = manageMode && isAdminUnlocked(k);
  const adminBlock = manageMode ? (isAdmin ? adminPanelHtml(k) : adminAccessInlineHtml(k)) : '';
  const manageBadge = manageMode ? '<span class="badge">صفحة إدارة</span>' : '';
  const selectionBadge = k.selectionMode === 'custom' ? '<span class="badge" style="background:rgba(201,154,62,.15);color:var(--gold)">أجزاء مخصصة</span>' : '';
  const shareBlock = manageMode ? `<div class="hero-actions khatma-share-actions"><button class="btn primary compact-btn" id="copyMessage">نسخ رسالة الواتساب</button><button class="btn ghost compact-btn" id="shareWhatsApp">مشاركة واتساب</button></div><div class="message-preview">${escapeHtml(message)}</div>` : '';
  const coordinatorBlock = (!manageMode && normalizeWhatsAppPhone(k.coordinatorWhatsapp || '')) ? `<div class="coordinator-contact-card"><div><strong>للاستفسار عن الختمة</strong><p>${escapeHtml(k.coordinatorName || 'منسق الختمة')}</p></div><a class="btn primary compact-btn" target="_blank" rel="noopener" href="${coordinatorWhatsAppUrl(k)}">تواصل مع منسق الختمة</a></div>` : '';
  const khatmaTools = khatmaToolsHtml(k);
  const filteredUnits = filterUnits(k.units);
  const emptyUnits = filteredUnits.length ? '' : '<article class="feature-card empty-state"><h3>لا توجد نتائج</h3><p>غيّر الفلتر أو البحث لعرض الأجزاء.</p></article>';
  view.innerHTML = `<section class="page-head"><span class="eyebrow">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : 'ختمة')}</span><h1>${escapeHtml(k.title)}</h1><p>${escapeHtml(k.hijriDate || '')} - ${escapeHtml(k.gregorianDate || '')}</p><div class="status-line"><span class="badge ${status.className}">${status.label}</span>${manageBadge}${selectionBadge}</div></section><section class="khatma-detail glass"><div class="mini-stats"><div><strong>${p.pct}%</strong><span>الإنجاز</span></div><div><strong>${p.completed}</strong><span>مكتمل</span></div><div><strong>${p.reserved}</strong><span>محجوز / جاري</span></div></div><div class="countdown-card ${countdownClass(k)}" data-countdown-for="${k.id}">${countdownHtml(k)}</div>${coordinatorBlock}${shareBlock}${khatmaTools}${adminBlock}</section><section class="unit-toolbar glass"><label>تصفية الأجزاء<select id="unitStatusFilter"><option value="all">الكل</option><option value="available">المتاح</option><option value="reserved">المحجوز</option><option value="reading">جاري القراءة</option><option value="completed">تمت القراءة</option></select></label><label>بحث<input id="unitSearchInput" placeholder="ابحث عن جزء أو اسم مشارك" /></label></section><section class="units-grid">${filteredUnits.map(unit => unitCardHtml(k, unit, isAdmin)).join('')}${emptyUnits}</section>`;
  document.getElementById('copyMessage')?.addEventListener('click', ()=>copyText(message));
  document.getElementById('shareWhatsApp')?.addEventListener('click', ()=> window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank'));
  const filterSelect = document.getElementById('unitStatusFilter');
  const searchInput = document.getElementById('unitSearchInput');
  if(filterSelect){ filterSelect.value = state.activeUnitFilter; filterSelect.addEventListener('change', e=>{ state.activeUnitFilter = e.target.value; setupKhatma(k.id, manageMode); }); }
  if(searchInput){ searchInput.value = state.activeUnitSearch; searchInput.addEventListener('change', e=>{ state.activeUnitSearch = e.target.value; setupKhatma(k.id, manageMode); }); }
  if(manageMode && !isAdmin) state.activeAdminKhatmaId = k.id;
  document.getElementById('adminInlineCode')?.addEventListener('keydown', event => { if(event.key === 'Enter'){ event.preventDefault(); unlockAdmin(k.id); } });
  document.getElementById('adminInlineOpen')?.addEventListener('click', ()=>unlockAdmin(k.id));
  document.getElementById('adminInlineCancel')?.addEventListener('click', ()=>{ state.activeAdminKhatmaId = ''; setupKhatma(k.id, manageMode); });
  view.querySelectorAll('.unit').forEach(card => card.addEventListener('click', (event)=>{ if(event.target.closest('button,input')) return; const unitNumber = Number(card.dataset.unit); const unit = k.units.find(x=>x.number===unitNumber); if(unit?.status === 'available') openReserveInline(k.id, unitNumber); }));
  view.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', (event)=>{ event.stopPropagation(); handleUnitAction(k.id, Number(btn.dataset.unit), btn.dataset.action); }));
  view.querySelectorAll('[data-reserve-input]').forEach(input => input.addEventListener('keydown', event => { if(event.key === 'Enter'){ event.preventDefault(); handleUnitAction(k.id, Number(input.dataset.reserveInput), 'reserve-confirm'); } }));
  if(isAdmin){ bindAdminActions(k); }
}
function filterUnits(units){
  const filter = state.activeUnitFilter || 'all';
  const q = (state.activeUnitSearch || '').trim().toLowerCase();
  return units.filter(unit => {
    const byStatus = filter === 'all' || unit.status === filter;
    const hay = `${unit.label || ''} ${unit.number || ''} ${unit.participantName || ''}`.toLowerCase();
    const bySearch = !q || hay.includes(q);
    return byStatus && bySearch;
  });
}
function unitCardHtml(k, unit, isAdmin){
  const key = `${k.id}:${unit.number}`; const isOpen = state.activeUnitKey === key; const name = escapeHtml(unit.participantName || '');
  const statusLabels = { available: 'متاح للحجز', reserved: `محجوز${name ? ': ' + name : ''}`, reading: `جاري القراءة${name ? ': ' + name : ''}`, completed: `تمت القراءة${name ? ': ' + name : ''}` };
  const title = `<strong>${escapeHtml(unit.label)}</strong><small><span class="status-dot">${statusLabels[unit.status] || 'متاح للحجز'}</span></small>`;
  if(unit.status === 'available'){
    const editor = isOpen ? `<div class="unit-inline"><input data-reserve-input="${unit.number}" placeholder="اسم المشارك" autocomplete="off" /><div class="unit-actions two"><button class="btn primary" data-action="reserve-confirm" data-unit="${unit.number}">تأكيد الحجز</button><button class="btn ghost" data-action="reserve-cancel" data-unit="${unit.number}">إلغاء</button></div></div>` : `<div class="unit-actions"><button class="btn ghost" data-action="reserve-open" data-unit="${unit.number}">حجز الجزء</button></div>`;
    return `<article class="unit available" data-unit="${unit.number}">${title}${editor}</article>`;
  }
  if(unit.status === 'reserved' || unit.status === 'reading') return `<article class="unit ${unit.status}" data-unit="${unit.number}">${title}<div class="unit-actions three"><button class="btn ghost" data-action="mark-reading" data-unit="${unit.number}">جاري القراءة</button><button class="btn primary" data-action="mark-completed" data-unit="${unit.number}">تمت القراءة</button><button class="btn ghost" data-action="make-available" data-unit="${unit.number}">إعادة إتاحة</button></div></article>`;
  const resetButton = isAdmin ? `<div class="unit-actions"><button class="btn ghost" data-action="make-available" data-unit="${unit.number}">إعادة إتاحة</button></div>` : '';
  return `<article class="unit completed" data-unit="${unit.number}">${title}${resetButton}</article>`;
}
function adminAccessInlineHtml(k){
  state.activeAdminKhatmaId = k.id;
  if(!isAdminPromptOpen(k.id)) return '';
  return `<div class="admin-panel inline-admin-access"><h3>إدارة الختمة</h3><p>أدخل رمز الإدارة لإظهار خيارات الإغلاق والحذف داخل هذا الكرت.</p><label class="inline-label">رمز الإدارة<input id="adminInlineCode" inputmode="numeric" placeholder="مثال: 739421" autocomplete="off" /></label><div class="admin-actions"><button class="btn primary" id="adminInlineOpen">فتح الإدارة</button><button class="btn ghost" id="adminInlineCancel">إلغاء</button></div></div>`;
}
function adminPanelHtml(k){
  const publicLink = location.href.split('#')[0] + '#/khatma/' + k.id;
  const canDirectManage = canManageKhatma(k);
  const deleteConfirm = state.activeDeleteKhatmaId === k.id ? `<div class="inline-panel danger-inline admin-danger-card action-sheet"><div class="sheet-head"><h4>حذف الختمة</h4><span>تأكيد نهائي</span></div><p>هذا الإجراء لا يمكن التراجع عنه. اكتب كلمة <strong>حذف</strong> للتأكيد.</p><label class="inline-label">تأكيد الحذف<input id="deleteKhatmaConfirmText" placeholder="اكتب حذف" autocomplete="off" /></label><div class="compact-actions"><button class="btn danger-btn compact-btn" id="confirmDeleteKhatmaAdmin">حذف الختمة نهائيًا</button><button class="btn ghost compact-btn" id="cancelDeleteKhatmaAdmin">إلغاء</button></div></div>` : '';
  const updateForm = state.activeUpdateKhatmaId === k.id ? updateKhatmaFormHtml(k) : '';
  return `<div class="admin-panel premium-admin-panel compact-khatma-admin"><div class="sheet-head"><h3>إدارة الختمة</h3><span>${canDirectManage ? 'حساب مصرح' : 'رمز مصرح'}</span></div><p>${canDirectManage ? 'إدارة الختمة متاحة بصلاحية حسابك.' : 'هذه الخيارات متاحة بعد إدخال رمز الإدارة.'}</p><div class="admin-actions tidy-admin-actions khatma-admin-actions"><button class="btn ghost compact-btn" id="copyPublicLink">نسخ رابط المشاركة</button><button class="btn ghost compact-btn" id="openUpdateKhatma">تحديث الختمة</button><button class="btn ghost compact-btn" id="toggleCloseKhatma">${k.status === 'closed' ? 'إعادة فتح الختمة' : 'إنهاء / إغلاق الختمة'}</button><button class="btn ghost danger-btn compact-btn" id="deleteKhatmaAdmin">حذف الختمة</button></div>${updateForm}${deleteConfirm}</div>`;
}
function customUnitsSelectorHtml(k){
  const metaMap = {juz:{total:30,label:'الجزء'}, hizb:{total:60,label:'الحزب'}, quarter:{total:240,label:'الربع'}};
  const meta = metaMap[k.division] || metaMap.juz;
  const minW = meta.total > 60 ? 64 : meta.total > 30 ? 80 : 90;
  const currentNums = new Set((k.units||[]).map(u=>u.number));
  const busyNums = new Set((k.units||[]).filter(u=>u.status!=='available').map(u=>u.number));
  const items = Array.from({length:meta.total}, (_,i)=>{
    const n = i+1;
    const checked = currentNums.has(n) ? 'checked' : '';
    const busy = busyNums.has(n);
    return `<label class="unit-pick-label${busy?' busy-unit':''}"><input type="checkbox" name="selectedUnit" value="${n}" ${checked} ${busy?'disabled title="محجوز أو مكتمل - لا يمكن إزالته"':''}>${meta.label} ${n}</label>`;
  }).join('');
  const busyCount = busyNums.size;
  const note = busyCount > 0 ? `<p class="units-picker-note">الأجزاء الرمادية محجوزة أو مكتملة ولن تتأثر (${busyCount})</p>` : '';
  return `<div class="full"><strong style="display:block;font-weight:900;color:var(--text);margin-bottom:8px">الأجزاء المتاحة للحجز</strong><input type="hidden" name="division" value="${escapeHtml(k.division)}" /><div class="custom-units-picker"><div class="sheet-head"><h4>تعديل الأجزاء</h4><span id="updatePickerCount">${currentNums.size} محدد</span></div><div class="custom-units-toolbar"><button class="btn ghost compact-btn" type="button" id="updateSelectAllUnits">تحديد الكل</button><button class="btn ghost compact-btn" type="button" id="updateClearFreeUnits">إلغاء المتاح</button></div><div class="custom-units-grid" style="grid-template-columns:repeat(auto-fill,minmax(${minW}px,1fr))">${items}</div>${note}</div></div>`;
}
function updateKhatmaFormHtml(k){
  const coordinatorName = k.coordinatorName || currentUserDisplayName();
  const phoneFields = coordinatorPhoneFieldsHtml(k.coordinatorWhatsapp || '');
  const divisionField = k.selectionMode === 'custom'
    ? customUnitsSelectorHtml(k)
    : `<label>نوع التقسيم<select name="division"><option value="juz" ${k.division === 'juz' ? 'selected' : ''}>أجزاء - 30</option><option value="hizb" ${k.division === 'hizb' ? 'selected' : ''}>أحزاب - 60</option><option value="quarter" ${k.division === 'quarter' ? 'selected' : ''}>أرباع - 240</option></select></label>`;
  return `<form id="updateKhatmaForm" class="inline-panel action-sheet update-khatma-form"><div class="sheet-head"><h4>تحديث بيانات الختمة</h4><span>تحديث كامل</span></div><div class="form-grid">
    <label>عنوان الختمة<input name="title" required value="${escapeHtml(k.title || '')}" /></label>
    <label>رقم الختمة<input name="weekNumber" type="number" min="1" value="${escapeHtml(k.weekNumber || '')}" /></label>
    <label>نوع الختمة<select name="khatmaType">${khatmaTypeOptionsHtml(k.khatmaType)}</select></label>
    <label>تاريخ الختمة<input name="khatmaDate" type="date" value="${escapeHtml(k.khatmaDate || '')}" /></label>
    <label>اليوم والتاريخ الهجري<input name="hijriDate" value="${escapeHtml(k.hijriDate || '')}" /></label>
    <label>التاريخ الميلادي<input name="gregorianDate" value="${escapeHtml(k.gregorianDate || '')}" /></label>
    <label>تاريخ انتهاء الختمة<input name="expiresAt" type="datetime-local" value="${escapeHtml(k.expiresAt || '')}" /></label>
    ${divisionField}
    <label>اسم منسق الختمة<input name="coordinatorName" value="${escapeHtml(coordinatorName)}" placeholder="يُعبأ تلقائيًا ويمكن تعديله" /></label>
    ${phoneFields}
  </div><div class="quote-meta-row"><label>القائل<input name="quoteBy" value="${escapeHtml(k.quoteBy || '')}" /></label><label>المصدر<input name="quoteSource" value="${escapeHtml(k.quoteSource || '')}" /></label></div><label>النص<textarea name="quoteText" rows="3">${escapeHtml(k.quoteText || '')}</textarea></label><label>إهداء الختمة<textarea name="dedication" rows="4">${escapeHtml(k.dedication || '')}</textarea></label><label>تنويهات المشاركة<textarea name="notes" rows="4">${escapeHtml(k.notes || '')}</textarea></label><div class="compact-actions"><button class="btn primary compact-btn" type="submit">حفظ التحديث</button><button class="btn ghost compact-btn" type="button" id="cancelUpdateKhatma">إلغاء</button></div></form>`;
}
function bindAdminActions(k){
  document.getElementById('copyPublicLink')?.addEventListener('click', ()=>copyText(location.href.split('#')[0] + '#/khatma/' + k.id));
  document.getElementById('openUpdateKhatma')?.addEventListener('click', ()=>{ state.activeUpdateKhatmaId = k.id; setupKhatma(k.id, true); });
  document.getElementById('cancelUpdateKhatma')?.addEventListener('click', ()=>{ state.activeUpdateKhatmaId = ''; setupKhatma(k.id, true); });
  const updateForm = document.getElementById('updateKhatmaForm');
  updateForm?.querySelector('[name="khatmaDate"]')?.addEventListener('change', ()=>updateDateFields(updateForm));
  updateForm?.addEventListener('submit', e=>saveKhatmaUpdate(e, k.id));
  if(k.selectionMode === 'custom' && updateForm){ const picker = updateForm.querySelector('.custom-units-picker'); if(picker){ const updateCount = ()=>{ const n=picker.querySelectorAll('input[name="selectedUnit"]:checked').length; const ctr=document.getElementById('updatePickerCount'); if(ctr) ctr.textContent=n+' محدد'; }; document.getElementById('updateSelectAllUnits')?.addEventListener('click',()=>{ picker.querySelectorAll('input[name="selectedUnit"]:not([disabled])').forEach(cb=>cb.checked=true); updateCount(); }); document.getElementById('updateClearFreeUnits')?.addEventListener('click',()=>{ picker.querySelectorAll('input[name="selectedUnit"]:not([disabled])').forEach(cb=>cb.checked=false); updateCount(); }); picker.querySelectorAll('input[name="selectedUnit"]').forEach(cb=>cb.addEventListener('change',updateCount)); } }
  document.getElementById('toggleCloseKhatma')?.addEventListener('click', ()=>toggleCloseKhatma(k.id));
  document.getElementById('deleteKhatmaAdmin')?.addEventListener('click', ()=>{ state.activeDeleteKhatmaId = k.id; state.activeUpdateKhatmaId = ''; setupKhatma(k.id, true); });
  document.getElementById('cancelDeleteKhatmaAdmin')?.addEventListener('click', ()=>{ state.activeDeleteKhatmaId = ''; setupKhatma(k.id, true); });
  document.getElementById('confirmDeleteKhatmaAdmin')?.addEventListener('click', ()=>confirmDeleteKhatmaAdmin(k.id));
}
async function saveKhatmaUpdate(event, id){
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  delete data.selectedUnit;
  prepareCoordinatorFields(form, data);
  data.adminCode = adminCodeFor(id);
  const kForUpdate = state.khatmas.find(x=>x.id===id);
  if(kForUpdate?.selectionMode === 'custom'){ const allCbs = form.querySelectorAll('input[name="selectedUnit"]'); data.selectedUnits = Array.from(allCbs).filter(cb=>cb.checked||cb.disabled).map(cb=>Number(cb.value)); }
  if(state.user?.role === 'owner') data.ownerOverride = true;
  try{
    const res = await api('/khatmas/' + encodeURIComponent(id) + '/admin/update', {method:'POST', body:data});
    const idx = state.khatmas.findIndex(x=>x.id === id);
    if(idx >= 0) state.khatmas[idx] = res.khatma;
    state.activeUpdateKhatmaId = '';
    toast('تم تحديث الختمة');
    setupKhatma(id, true);
  }catch(err){ toast(err.message || 'تعذر تحديث الختمة'); }
}
async function unlockAdmin(id){
  const input = document.getElementById('adminInlineCode');
  const code = (input?.value || '').trim();
  if(!code){ toast('أدخل رمز الإدارة أولاً'); input?.focus(); return; }
  try{
    await api('/khatmas/' + encodeURIComponent(id) + '/admin/verify', {method:'POST', body:{adminCode: code}});
    sessionStorage.setItem('admin_code_' + id, code);
    state.activeAdminKhatmaId = '';
    toast('تم فتح لوحة الإدارة');
    setupKhatma(id, true);
  }catch(err){ toast('رمز الإدارة غير صحيح'); input?.focus(); }
}
function canManageKhatma(k){ return !!(state.user && (state.user.role === 'owner' || state.user.id === k.createdByUserId)); }
function isAdminUnlocked(k){ return canManageKhatma(k) || !!adminCodeFor(k.id); }
async function toggleCloseKhatma(id){
  try{
    const body = {adminCode: adminCodeFor(id)};
    if(state.user?.role === 'owner') body.ownerOverride = true;
    const res = await api('/khatmas/' + encodeURIComponent(id) + '/admin/toggle-close', {method:'POST', body});
    await refreshOne(id); toast(res.status === 'closed' ? 'تم إغلاق الختمة' : 'تم إعادة فتح الختمة'); setupKhatma(id, true);
  }catch(err){ toast(err.message || 'تعذر تحديث الختمة'); }
}
async function confirmDeleteKhatmaAdmin(id){
  const confirmInput = document.getElementById('deleteKhatmaConfirmText');
  if(confirmInput && confirmInput.value.trim() !== 'حذف'){ toast('اكتب كلمة حذف للتأكيد'); confirmInput.focus(); return; }
  try{
    const body = {adminCode: adminCodeFor(id)};
    if(state.user?.role === 'owner') body.ownerOverride = true;
    await api('/khatmas/' + encodeURIComponent(id) + '/admin/delete', {method:'POST', body});
    state.khatmas = state.khatmas.filter(x=>x.id!==id);
    sessionStorage.removeItem('admin_code_' + id);
    state.activeDeleteKhatmaId = '';
    toast('تم حذف الختمة'); location.hash = '#/khatmas';
  }catch(err){ toast(err.message || 'تعذر حذف الختمة'); }
}
async function deleteKhatmaAdmin(id){ state.activeDeleteKhatmaId = id; setupKhatma(id, true); }
function openReserveInline(khatmaId, num){
  const k = state.khatmas.find(x=>x.id===khatmaId); if(!k) return;
  const status = khatmaStatus(k); if(status.key === 'closed'){ toast('الختمة مغلقة من قبل المنشئ'); return; }
  state.activeUnitKey = `${khatmaId}:${num}`; setupKhatma(khatmaId, state.currentManageMode); setTimeout(()=>document.querySelector(`[data-reserve-input="${num}"]`)?.focus(), 80);
}
async function handleUnitAction(khatmaId, num, action){
  const k = state.khatmas.find(x=>x.id===khatmaId); if(!k) return;
  const status = khatmaStatus(k); if(status.key === 'closed' && action !== 'make-available'){ toast('الختمة مغلقة من قبل المنشئ'); return; }
  const u = k.units.find(x=>x.number===num); if(!u) return;
  if(action === 'reserve-open') return openReserveInline(khatmaId, num);
  if(action === 'reserve-cancel'){ state.activeUnitKey = ''; setupKhatma(khatmaId, state.currentManageMode); return; }
  try{
    if(action === 'reserve-confirm'){
      const input = document.querySelector(`[data-reserve-input="${num}"]`); const name = (input?.value || '').trim();
      if(!name){ toast('اكتب اسم المشارك أولاً'); input?.focus(); return; }
      await api(`/khatmas/${encodeURIComponent(khatmaId)}/units/${num}/reserve`, {method:'POST', body:{participantName:name}});
      state.activeUnitKey = ''; toast('تم حجز الجزء'); await refreshOne(khatmaId); setupKhatma(khatmaId, state.currentManageMode); return;
    }
    if(action === 'mark-reading'){
      await api(`/khatmas/${encodeURIComponent(khatmaId)}/units/${num}/reading`, {method:'POST', body:{}});
      toast('تم تحديث الحالة إلى جاري القراءة'); await refreshOne(khatmaId); setupKhatma(khatmaId, state.currentManageMode); return;
    }
    if(action === 'mark-completed'){
      await api(`/khatmas/${encodeURIComponent(khatmaId)}/units/${num}/complete`, {method:'POST', body:{}});
      toast('تم تسجيل القراءة'); await refreshOne(khatmaId); setupKhatma(khatmaId, state.currentManageMode); return;
    }
    if(action === 'make-available'){
      const body = u.status === 'completed' ? {adminCode: adminCodeFor(khatmaId)} : {}; if(state.user?.role === 'owner') body.ownerOverride = true;
      await api(`/khatmas/${encodeURIComponent(khatmaId)}/units/${num}/available`, {method:'POST', body});
      state.activeUnitKey = ''; toast('تمت إعادة إتاحة الجزء'); await refreshOne(khatmaId); setupKhatma(khatmaId, state.currentManageMode);
    }
  }catch(err){ toast(err.message || 'تعذر تنفيذ الإجراء'); }
}
function progress(k){ const completed = k.units.filter(u=>u.status==='completed').length; const reserved = k.units.filter(u=>u.status==='reserved' || u.status==='reading').length; return {completed, reserved, pct: k.units.length ? Math.round((completed / k.units.length) * 100) : 0}; }
function khatmaStatus(k){ const p = progress(k); if(k.status === 'deleted') return {key:'deleted', label:'محذوفة', className:'closed'}; if(k.status === 'closed') return {key:'closed', label:'مغلقة بواسطة المنشئ', className:'closed'}; if(p.pct === 100) return {key:'completed', label:'مكتملة', className:'done'}; if(isExpired(k)) return {key:'expired', label:'انتهت مدة الختمة', className:'closed'}; return {key:'active', label:'الختمة جارية', className:''}; }
function isExpired(k){ return !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now(); }
function countdownClass(k){ if(!k.expiresAt) return ''; const diff = new Date(k.expiresAt).getTime() - Date.now(); if(diff <= 0) return 'expired'; if(diff <= 24*60*60*1000) return 'warning'; return ''; }
function countdownHtml(k){ if(!k.expiresAt) return '<span>تاريخ انتهاء الختمة</span><strong>غير محدد</strong><small>يمكن تحديده عند إنشاء الختمة.</small>'; const end = new Date(k.expiresAt); const diff = end.getTime() - Date.now(); if(diff <= 0) return `<span>انتهت مدة الختمة</span><strong>انتهى الوقت المحدد</strong><small>تاريخ الانتهاء: ${formatDateTime(end)}</small>`; const days = Math.floor(diff / 86400000); const hours = Math.floor((diff % 86400000) / 3600000); const minutes = Math.floor((diff % 3600000) / 60000); return `<span>الوقت المتبقي على انتهاء الختمة</span><strong>${days} يوم • ${hours} ساعة • ${minutes} دقيقة</strong><small>تاريخ الانتهاء: ${formatDateTime(end)}</small>`; }
function formatDateTime(date){ return date.toLocaleString('ar-SA', { dateStyle:'medium', timeStyle:'short' }); }
function toDatetimeLocal(date){ const pad = n => String(n).padStart(2,'0'); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function currentUserDisplayName(){
  return (state.user?.displayName || state.user?.display_name || state.user?.username || '').trim();
}
function fillDefaultCoordinatorName(form){
  const input = form?.querySelector('[name="coordinatorName"]');
  if(input && !input.value.trim()) input.value = currentUserDisplayName();
}
function normalizeLocalPhone(value=''){
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if(digits.startsWith('00')) digits = digits.slice(2);
  if(digits.startsWith('9665') && digits.length === 12) digits = '0' + digits.slice(3);
  else if(digits.startsWith('5') && digits.length === 9) digits = '0' + digits;
  return digits;
}
function coordinatorPhoneParts(value){
  return { code: '966', local: normalizeLocalPhone(value || '') };
}
function coordinatorPhoneFieldsHtml(value=''){
  const parts = coordinatorPhoneParts(value);
  return `<label class="full">واتساب منسق الختمة<input name="coordinatorWhatsappLocal" value="${escapeHtml(parts.local)}" inputmode="tel" placeholder="مثال: 05XXXXXXXX" /></label>`;
}
function splitCoordinatorPhoneIntoFields(form, value=''){
  const parts = coordinatorPhoneParts(value);
  const local = form?.querySelector('[name="coordinatorWhatsappLocal"]');
  if(local && !local.value) local.value = parts.local;
}
function prepareCoordinatorFields(form, data){
  if(!data.coordinatorName) data.coordinatorName = currentUserDisplayName();
  data.coordinatorWhatsapp = normalizeLocalPhone(data.coordinatorWhatsappLocal || form?.querySelector('[name="coordinatorWhatsappLocal"]')?.value || '');
  delete data.coordinatorCountryCode;
  delete data.coordinatorWhatsappLocal;
}
function messageSection(title, value, transform = x => x){
  const text = String(value || '').trim();
  return text ? `${title}:\n${transform(text)}` : '';
}
function buildWhatsAppMessage(k, options={}){
  const isManaged = Boolean(options.managed);
  const base = location.href.split('#')[0];
  const link = isManaged ? base + '#/reader-login' : base + '#/khatma/' + k.id;
  const lines = [
    `بحمد الله تم فتح الختمة ${khatmaTypeAdjective(k.khatmaType)} (${k.weekNumber || '-'})`
  ];
  if(k.title) lines.push(String(k.title).trim());
  const dateLine = `${k.hijriDate || ''}${k.gregorianDate ? '، الموافق ' + k.gregorianDate : ''}`.trim();
  if(dateLine) lines.push(`اليوم: ${dateLine}`);
  [
    messageSection('إهداء الختمة', k.dedication, bulletLines),
    messageSection('المصدر', k.quoteSource),
    messageSection('التنويه', k.notes, bulletLines),
    messageSection('القائل', k.quoteBy),
    messageSection('النص', k.quoteText)
  ].filter(Boolean).forEach(section => lines.push(section));
  lines.push(`نبدأ وعلى بركة الله.\n${isManaged ? 'للاطلاع على أجزائكم، تفضلوا بالدخول على بوابة القراء:-\n(أدخل كودك أو رقم جوالك أو اسمك)' : 'لحجز أجزائكم، تفضلوا بالدخول على الرابط:-'}\n${link}`);
  return lines.join('\n\n');
}
function normalizeWhatsAppPhone(value=''){
  const local = normalizeLocalPhone(value);
  if(local && /^05\d{8}$/.test(local)) return '966' + local.slice(1);
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if(digits.startsWith('00')) digits = digits.slice(2);
  if(digits.startsWith('0')) digits = '966' + digits.slice(1);
  return digits;
}
function coordinatorWhatsAppUrl(k){
  const phone = normalizeWhatsAppPhone(k.coordinatorWhatsapp || '');
  const name = k.coordinatorName || 'منسق الختمة';
  const khatmaNumber = k.weekNumber || k.title || '-';
  const text = `السلام عليكم، ${name}
أنا أراسلك بخصوص ختمة (${khatmaNumber}) وعندي استفسار`;
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
}
function bulletLines(text=''){ return text.split('\n').map(x=>x.trim()).filter(Boolean).map(x=>'* ' + x).join('\n'); }

function khatmaToolsHtml(k){
  return `<div class="khatma-tools-bar v32"><div class="icon-action-group v32">
    <button class="icon-action v32" type="button" onclick="exportSingleKhatmaCsv('${escapeJs(k.id)}')" title="تصدير ملف CSV يفتح في Excel وNumbers وGoogle Sheets"><span aria-hidden="true">⇩</span><strong>CSV / Excel</strong></button>
    <button class="icon-action v32" type="button" onclick="printSingleKhatma('${escapeJs(k.id)}')" title="طباعة الختمة أو حفظ PDF"><span aria-hidden="true">⎙</span><strong>طباعة / PDF</strong></button>
  </div></div>`;
}
function khatmaExportRows(khatmas){
  return khatmas.map(k => { const p = progress(k); const status = khatmaStatus(k); return {
    'رقم الختمة': k.weekNumber || '',
    'نوع الختمة': KHATMA_TYPE_OPTIONS.find(([key]) => key === normalizeKhatmaType(k.khatmaType))?.[1] || 'أسبوعية',
    'عنوان الختمة': k.title || '',
    'الحالة': status.label || '',
    'نسبة الإنجاز': p.pct + '%',
    'مكتمل': p.completed,
    'محجوز أو جاري': p.reserved,
    'التاريخ الهجري': k.hijriDate || '',
    'التاريخ الميلادي': k.gregorianDate || '',
    'منسق الختمة': k.coordinatorName || '',
    'واتساب المنسق': normalizeLocalPhone(k.coordinatorWhatsapp || '')
  }; });
}
function khatmaUnitExportRows(k){
  const labels = {available:'متاح', reserved:'محجوز', reading:'جاري القراءة', completed:'تمت القراءة'};
  return (k.units || []).map(u => ({
    'الختمة': k.title || '',
    'رقم الختمة': k.weekNumber || '',
    'الوحدة': u.label || '',
    'رقم الوحدة': u.number || '',
    'الحالة': labels[u.status] || u.status || '',
    'اسم المشارك': u.participantName || '',
    'وقت الحجز': u.reservedAt || '',
    'وقت بدء القراءة': u.readingAt || '',
    'وقت الإكمال': u.completedAt || ''
  }));
}
function rowsToCsv(rows){
  if(!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return '\ufeff' + [headers.map(esc).join(','), ...rows.map(row => headers.map(h => esc(row[h])).join(','))].join('\n');
}
function rowsToExcelHtml(rows, title='تصدير'){
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><table border="1"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
async function downloadTextFile(filename, content, type){
  const blob = new Blob([content], {type});

  // Mobile-friendly path: show the native share sheet when the browser supports sharing files.
  // This works better on many phones/PWAs than forcing a direct download only.
  try{
    const file = new File([blob], filename, {type});
    const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
    if(isSmallScreen && navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title: filename, text: 'تصدير من إلى الله للختمات القرآنية'});
      return;
    }
  }catch{}

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}
function safeFileName(value){ return String(value || 'khatma').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').slice(0, 80); }
window.exportKhatmasCsv = function(){ downloadTextFile('khatmas-list.csv', rowsToCsv(khatmaExportRows(state.khatmas)), 'text/csv;charset=utf-8'); };
window.exportSingleKhatmaCsv = function(id){ const k = state.khatmas.find(x=>x.id===id); if(!k) return toast('الختمة غير موجودة'); downloadTextFile(safeFileName(k.title) + '-units.csv', rowsToCsv(khatmaUnitExportRows(k)), 'text/csv;charset=utf-8'); };
function managedKhatmaExportRows(khatmas){
  return khatmas.map(k => { const p = managedProgress(k); const status = managedKhatmaStatus(k); return {
    'رقم الختمة': k.weekNumber || '',
    'نوع الختمة': KHATMA_TYPE_OPTIONS.find(([key]) => key === normalizeKhatmaType(k.khatmaType))?.[1] || 'أسبوعية',
    'عنوان الختمة': k.title || '',
    'الحالة': status.label || '',
    'نسبة الإنجاز': p.pct + '%',
    'مكتمل': p.completed,
    'مُعيّن أو جاري': p.active,
    'التاريخ الهجري': k.hijriDate || '',
    'التاريخ الميلادي': k.gregorianDate || '',
    'منسق الختمة': k.coordinatorName || '',
    'واتساب المنسق': normalizeLocalPhone(k.coordinatorWhatsapp || '')
  }; });
}
function managedKhatmaUnitExportRows(k){
  return (k.units || []).map(u => ({
    'الختمة': k.title || '',
    'رقم الختمة': k.weekNumber || '',
    'الوحدة': u.label || '',
    'رقم الوحدة': u.number || '',
    'القارئ': u.participantName || '',
    'رقم الجوال': normalizeLocalPhone(u.participantPhone || ''),
    'الحالة': managedStatusLabel(u.status),
    'وقت بدء القراءة': u.readingAt || '',
    'وقت الإكمال': u.completedAt || ''
  }));
}
window.exportManagedKhatmasCsv = function(){ downloadTextFile('managed-khatmas-list.csv', rowsToCsv(managedKhatmaExportRows(state.managedKhatmas)), 'text/csv;charset=utf-8'); };
window.exportSingleManagedKhatmaCsv = function(id){ const k = state.managedKhatmas.find(x=>x.id===id); if(!k) return toast('الختمة المُدارة غير موجودة'); downloadTextFile(safeFileName(k.title) + '-managed-units.csv', rowsToCsv(managedKhatmaUnitExportRows(k)), 'text/csv;charset=utf-8'); };
function printablePage(title, body){
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Tajawal,Arial,sans-serif;color:#12231d;margin:28px;line-height:1.8}h1{margin:0 0 8px;color:#0f5f45}.meta{color:#6d7b72;margin-bottom:18px}.card{border:1px solid #cddbd1;border-radius:18px;padding:16px;margin:12px 0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #cddbd1;padding:8px 10px;text-align:right;font-size:13px}th{background:#eef5ef;color:#0f5f45}.small{font-size:12px;color:#6d7b72}@media print{button{display:none}body{margin:12mm}}</style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`;
}
window.printKhatmasList = function(){
  const rows = khatmaExportRows(state.khatmas);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const table = `<h1>قائمة الختمات</h1><div class="meta">الى الله للختمات القرآنية · ${new Date().toLocaleDateString('ar-SA')}</div><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const w = window.open('', '_blank'); if(w){ w.document.write(printablePage('قائمة الختمات', table)); w.document.close(); }
};
window.printSingleKhatma = function(id){
  const k = state.khatmas.find(x=>x.id===id); if(!k) return toast('الختمة غير موجودة');
  const p = progress(k); const status = khatmaStatus(k); const rows = khatmaUnitExportRows(k); const headers = rows.length ? Object.keys(rows[0]).filter(h => !['الختمة','رقم الختمة'].includes(h)) : [];
  const body = `<h1>${escapeHtml(k.title || 'الختمة')}</h1><div class="meta">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : '')} · ${escapeHtml(status.label)} · الإنجاز ${p.pct}%</div><div class="card"><strong>التاريخ:</strong> ${escapeHtml([k.hijriDate || '', k.gregorianDate || ''].filter(Boolean).join(' - '))}<br><strong>منسق الختمة:</strong> ${escapeHtml(k.coordinatorName || '-')}<br><strong>الإهداء:</strong><br>${escapeHtml(k.dedication || '').replace(/\n/g,'<br>')}</div><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="small">تمت الطباعة من منصة الى الله للختمات القرآنية.</p>`;
  const w = window.open('', '_blank'); if(w){ w.document.write(printablePage(k.title || 'الختمة', body)); w.document.close(); }
};
window.printManagedKhatmasList = function(){
  const rows = managedKhatmaExportRows(state.managedKhatmas);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const table = `<h1>قائمة الختمات المُدارة</h1><div class="meta"> اى الله للختمات القرآنية · ${new Date().toLocaleDateString('ar-SA')}</div><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const w = window.open('', '_blank'); if(w){ w.document.write(printablePage('قائمة الختمات المُدارة', table)); w.document.close(); }
};
window.printReaderGroup = function(id){
  const group = state.currentReaderGroup && state.currentReaderGroup.id === id ? state.currentReaderGroup : null;
  const readers = state.currentGroupReaders || [];
  if(!group){ toast('لا توجد بيانات المجموعة، حاول مجدداً'); return; }
  const periodIndex = computeCurrentPeriodIndex(group.rotation_start_date || '', group.rotation_type || 'monthly');
  const periodLabel = currentHijriPeriodLabel(group.rotation_start_date, group.rotation_type) || ('الدورة ' + (periodIndex + 1));
  const rows = readers.map(r => {
    const currentJuz = (r.startJuz && r.partsCount) ? computeRotationJuz(r.startJuz, r.partsCount, periodIndex) : [];
    return { 'القارئ': r.name || '', 'الجوال': normalizeLocalPhone(r.phone || ''), 'الكود': r.accessCode || '', 'بداية الجزء': r.startJuz || '', 'عدد الأجزاء': r.partsCount || '', 'أجزاء الدورة الحالية': currentJuz.length ? 'ج' + currentJuz.join('، ج') : '—', 'ملاحظات': r.notes || '' };
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const body = `<h1>${escapeHtml(group.name)}</h1>
    <div class="meta">مجموعة قراء · ${escapeHtml(periodLabel)} · ${readers.length} قارئ · ${new Date().toLocaleDateString('ar-SA')}</div>
    <table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="small">تمت الطباعة من منصة الى الله للختمات القرآنية.</p>`;
  const w = window.open('', '_blank'); if(w){ w.document.write(printablePage(group.name, body)); w.document.close(); }
};
window.printMonitorReport = function(){
  const khatmas = state.managedKhatmas || [];
  if(!khatmas.length){ toast('لا توجد بيانات للطباعة'); return; }
  const rows = khatmas.map(k => {
    const p = managedProgress(k);
    const status = managedKhatmaStatus(k);
    const totalUnits = (k.units || []).length;
    const completed = (k.units || []).filter(u => u.status === 'completed').length;
    const unstarted = (k.units || []).filter(u => u.status === 'available').length;
    return { 'الختمة': k.title || '', 'رقم الختمة': k.weekNumber || '', 'النوع': khatmaTypeAdjective(k.khatmaType) || '', 'الحالة': status.label, 'الوحدات': totalUnits, 'مكتملة': completed, 'غير مبدوءة': unstarted, 'الإنجاز': p.pct + '%' };
  });
  const headers = Object.keys(rows[0]);
  const totalCompleted = khatmas.reduce((s,k)=>(k.units||[]).filter(u=>u.status==='completed').length+s,0);
  const totalUnits = khatmas.reduce((s,k)=>(k.units||[]).length+s,0);
  const globalPct = totalUnits ? Math.round(100*totalCompleted/totalUnits) : 0;
  const h = getHijriParts(new Date());
  const body = `<h1>لوحة متابعة الختمات المُدارة</h1>
    <div class="meta"> الى الله · ${hijriMonthName(h.month)} ${h.year} هـ · ${new Date().toLocaleDateString('ar-SA')}</div>
    <div class="card"><strong>الإجمالي:</strong> ${khatmas.length} ختمة · ${totalCompleted}/${totalUnits} وحدة مكتملة · الإنجاز الكلي ${globalPct}%</div>
    <table><thead><tr>${headers.map(h2=>`<th>${escapeHtml(h2)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${headers.map(h2=>`<td>${escapeHtml(row[h2])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="small">تمت الطباعة من منصة الى الله للختمات القرآنية.</p>`;
  const w = window.open('', '_blank'); if(w){ w.document.write(printablePage('تقرير المراقبة', body)); w.document.close(); }
};
window.printSingleManagedKhatma = function(id){
  const k = state.managedKhatmas.find(x=>x.id===id); if(!k) return toast('الختمة المُدارة غير موجودة');
  const p = managedProgress(k); const status = managedKhatmaStatus(k); const rows = managedKhatmaUnitExportRows(k); const headers = rows.length ? Object.keys(rows[0]).filter(h => !['الختمة','رقم الختمة'].includes(h)) : [];
  const body = `<h1>${escapeHtml(k.title || 'الختمة المُدارة')}</h1><div class="meta">${escapeHtml(k.weekNumber ? 'الختمة ' + khatmaTypeAdjective(k.khatmaType) + ' ' + k.weekNumber : '')} · ${escapeHtml(status.label)} · الإنجاز ${p.pct}%</div><div class="card"><strong>التاريخ:</strong> ${escapeHtml([k.hijriDate || '', k.gregorianDate || ''].filter(Boolean).join(' - '))}<br><strong>منسق الختمة:</strong> ${escapeHtml(k.coordinatorName || '-')}<br><strong>الإهداء:</strong><br>${escapeHtml(k.dedication || '').replace(/\n/g,'<br>')}</div><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="small">تمت الطباعة من منصة الى الله للختمات القرآنية.</p>`;
  const w = window.open('', '_blank'); if(w){ w.document.write(printablePage(k.title || 'الختمة المُدارة', body)); w.document.close(); }
};function toDateInputValue(date){ const pad = n => String(n).padStart(2,'0'); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function dateFromInputValue(value){ if(!value) return null; const [y,m,d] = value.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0); }
function updateDateFields(form){ const dateInput = form.querySelector('input[name="khatmaDate"]'); const hijriInput = form.querySelector('input[name="hijriDate"]'); const gregInput = form.querySelector('input[name="gregorianDate"]'); const date = dateFromInputValue(dateInput?.value); if(!date){ return; } if(hijriInput){ hijriInput.value = formatHijriDate(date); } if(gregInput){ gregInput.value = formatGregorianDate(date); } }
function formatHijriDate(date){ return date.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).replace('،','').trim(); }
function formatGregorianDate(date){ return date.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day:'numeric', month:'long', year:'numeric' }).replace('،','').trim(); }
function showInputModal({title, message, label, placeholder='', inputMode='text', confirmText='تأكيد'}){ return new Promise(resolve => { const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message).replace(/\n/g,'<br>')}</p><label>${escapeHtml(label)}<input id="modalInput" inputmode="${escapeHtml(inputMode)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" /></label><div class="modal-actions"><button class="btn primary" id="modalOk">${escapeHtml(confirmText)}</button><button class="btn ghost" id="modalCancel">إلغاء</button></div></div>`; document.body.appendChild(backdrop); const input = backdrop.querySelector('#modalInput'); const close = value => { backdrop.remove(); resolve(value); }; backdrop.querySelector('#modalOk').addEventListener('click', ()=>close(input.value.trim())); backdrop.querySelector('#modalCancel').addEventListener('click', ()=>close('')); backdrop.addEventListener('click', e => { if(e.target === backdrop) close(''); }); input.addEventListener('keydown', e => { if(e.key === 'Enter') close(input.value.trim()); if(e.key === 'Escape') close(''); }); setTimeout(()=>input.focus(), 20); }); }
function showConfirmModal({title, message, confirmText='تأكيد', danger=false}){ return new Promise(resolve => { const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message).replace(/\n/g,'<br>')}</p><div class="modal-actions"><button class="btn ${danger ? 'danger-btn' : 'primary'}" id="modalOk">${escapeHtml(confirmText)}</button><button class="btn ghost" id="modalCancel">إلغاء</button></div></div>`; document.body.appendChild(backdrop); const close = value => { backdrop.remove(); resolve(value); }; backdrop.querySelector('#modalOk').addEventListener('click', ()=>close(true)); backdrop.querySelector('#modalCancel').addEventListener('click', ()=>close(false)); backdrop.addEventListener('click', e => { if(e.target === backdrop) close(false); }); }); }
function copyText(text){ navigator.clipboard?.writeText(text).then(()=>toast('تم النسخ')).catch(()=>toast('تعذر النسخ')); }
function toast(msg){ const el=document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),2200); }
function showConfirmModal({ title, message, confirmLabel = 'تأكيد', cancelLabel = 'إلغاء' }){
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" dir="rtl">
      <div class="sheet-head"><h3>${escapeHtml(title)}</h3></div>
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn ghost" id="confirmModalCancel" type="button">${escapeHtml(cancelLabel)}</button>
        <button class="btn primary" id="confirmModalOk" type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = val => { backdrop.remove(); resolve(val); };
    backdrop.querySelector('#confirmModalOk').addEventListener('click', () => close(true));
    backdrop.querySelector('#confirmModalCancel').addEventListener('click', () => close(false));
    backdrop.addEventListener('click', e => { if(e.target === backdrop) close(false); });
    backdrop.querySelector('#confirmModalOk').focus();
  });
}
function escapeJs(value){ return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

// PWA — register service worker (static shell only, no API caching)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
function escapeHtml(value=''){ return String(value ?? '').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
