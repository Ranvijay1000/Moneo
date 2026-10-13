import { firebaseConfig, firebaseConfigured } from './firebase-config.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const DB_KEY = 'moneo-demo-v1';
const SESSION_KEY = 'moneo-session-v1';
const colors = { Food: '#b7f176', Transport: '#79d6b5', Study: '#9c90ff', Shopping: '#f2c66d', Other: '#ff8978' };
const investmentColors = ['#b7f176', '#79d6b5', '#9c90ff', '#f2c66d', '#ff8978', '#75baff', '#e6a8ff', '#b7c4d2'];
let db = readDb();
let authMode = 'login';
let modalType = '';
let modalInvestmentId = null;
let toastTimer;
let cloud = null;
let cloudUser = null;
let pendingUsername = '';
let stopSharedLoans = null;
let saveTimer;

if (firebaseConfigured) {
  try {
    const [appSdk, authSdk, dbSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js'),
    ]);
    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    const firestore = dbSdk.getFirestore(app);
    cloud = { authSdk, dbSdk, auth, firestore };
  } catch (error) {
    console.error('Firebase could not be initialized.', error);
  }
}

function readDb() { try { return JSON.parse(localStorage.getItem(DB_KEY)) || { users: {}, profiles: {} }; } catch { return { users: {}, profiles: {} }; } }
function saveDb() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  if (cloud && cloudUser) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { doc, setDoc, serverTimestamp } = cloud.dbSdk;
      setDoc(doc(cloud.firestore, 'users', cloudUser.uid, 'appData', 'state'), { profile: profile(), updatedAt: serverTimestamp() }, { merge: true })
        .catch(error => { console.error(error); showToast('Cloud save failed. Check your connection.'); });
    }, 300);
  }
}
function profileKey() { return localStorage.getItem(SESSION_KEY) || ''; }
function profile() { const key = profileKey(); if (!key) return null; db.profiles[key] ||= { user: key, name: key.split('@')[0], email: key.includes('@') ? key : '', currency: 'INR', sources: [], transactions: [], loans: [], budgets: [], goals: [], recurringItems: [], sharedLoans: [], investments: [] }; return db.profiles[key]; }
function currency() { return profile()?.currency || 'INR'; }
function money(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency(), maximumFractionDigits: 0 }).format(Number(value) || 0); }
function escapeHtml(text) { return String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function showToast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2600); }
function currentDate() { return new Date().toISOString().slice(0, 10); }
async function emailLookupId(email) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function setAuthMode(mode) {
  authMode = mode;
  const formWrap = $('#authFormWrap');
  formWrap.classList.remove('mode-in'); void formWrap.offsetWidth; formWrap.classList.add('mode-in');
  $$('.auth-switch button').forEach(button => button.classList.toggle('selected', button.dataset.authMode === mode));
  $('#authTitle').textContent = mode === 'signup' ? 'Make money feel simpler.' : 'Welcome back.';
  $('#authSubtitle').textContent = mode === 'signup' ? 'Start with a clearer view of your money.' : 'Your financial picture, all in one place.';
  $('#emailField').classList.toggle('hidden', mode !== 'signup');
  $('#confirmField').classList.toggle('hidden', mode !== 'signup');
  $('#authEmail').required = mode === 'signup'; $('#authConfirm').required = mode === 'signup';
  $('#authIdentity').placeholder = mode === 'signup' ? 'Choose a username' : 'you@example.com';
  $('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#authSubmit').innerHTML = `${mode === 'signup' ? 'Create account' : 'Log in'} <span>↗</span>`;
  $('#authError').textContent = '';
}
async function enterApp(key, user = null) {
  cloudUser = user;
  db = readDb();
  if (cloud && user) {
    try {
      const { doc, getDoc, setDoc, serverTimestamp } = cloud.dbSdk;
      const identityRefs = await Promise.all([user.email, user.displayName || user.email.split('@')[0]].map(async value => doc(cloud.firestore, 'userDirectory', await emailLookupId(value))));
      const identityDocs = await Promise.all(identityRefs.map(ref => getDoc(ref)));
      const oldIdentity = identityDocs.find(snapshot => snapshot.exists() && snapshot.data().uid !== user.uid);
      if (oldIdentity) {
        const recoveryError = new Error('This email or username is still linked to an older account ID. Its Firestore data may still be recoverable by the app administrator.');
        recoveryError.code = 'account/recovery-required';
        throw recoveryError;
      }
      const stateRef = doc(cloud.firestore, 'users', user.uid, 'appData', 'state');
      const stored = await getDoc(stateRef);
      if (stored.exists() && stored.data().profile) db.profiles[key] = { ...stored.data().profile, user: key, ...(pendingUsername ? { name: pendingUsername, username: pendingUsername.toLowerCase() } : {}) };
      else {
        // A missing cloud document is a fresh account. Never resurrect old data
        // from this browser's local cache after an admin has cleared Firestore.
        const name = pendingUsername || user.displayName || user.email.split('@')[0];
        db.profiles[key] = { user: key, name, username: name.toLowerCase(), email: user.email, currency: 'INR', sources: [], transactions: [], loans: [], budgets: [], goals: [], recurringItems: [], sharedLoans: [], investments: [] };
        await setDoc(stateRef, { profile: db.profiles[key], updatedAt: serverTimestamp() }, { merge: true });
      }
      const identity = { uid: user.uid, email: user.email, name: db.profiles[key].name || user.displayName || user.email.split('@')[0], username: (db.profiles[key].username || user.displayName || user.email.split('@')[0]).toLowerCase(), currency: db.profiles[key].currency || 'INR' };
      await Promise.all([identity.email, identity.username].map(async lookup => setDoc(doc(cloud.firestore, 'userDirectory', await emailLookupId(lookup)), identity)));
      pendingUsername = '';
    } catch (error) {
      console.error(error);
      localStorage.removeItem(SESSION_KEY);
      cloudUser = null;
      $('#appView').classList.add('hidden'); $('#authView').classList.remove('hidden');
      $('#authError').textContent = error.code === 'account/recovery-required'
        ? 'This email or username belongs to an older account ID. Your previous data may still be in Firestore. Contact the app administrator to restore it before using this account.'
        : error.code === 'permission-denied'
          ? 'Firebase denied access to this account. It may have been deleted in Authentication. Your Firestore data may still exist; contact the app administrator.'
          : 'Could not load your account data. Check your connection and Firebase setup, then try again.';
      if (cloud.auth.currentUser) await cloud.authSdk.signOut(cloud.auth);
      return false;
    }
  }
  localStorage.setItem(SESSION_KEY, key);
  const p = profile(); p.sources ||= []; p.transactions ||= []; p.loans ||= []; p.budgets ||= []; p.goals ||= []; p.recurringItems ||= []; p.sharedLoans ||= []; p.investments ||= []; applyTheme(p.theme || 'dark'); saveDb();
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  const name = p.name || p.user.split('@')[0]; $('#greetingName').textContent = name.split(/[ ._-]/)[0] || 'there';
  $('#avatarButton').textContent = (name[0] || 'A').toUpperCase();
  $('#settingsAvatar').textContent = (name[0] || 'A').toUpperCase(); $('#settingsName').textContent = name; $('#settingsEmail').textContent = p.email || p.user;
  $('#currencySelect').value = p.currency || 'INR';
  $('#todayLabel').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  render();
  watchSharedLoans();
  return true;
}

$$('.auth-switch button').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#authIdentity').value.trim().toLowerCase(); const pass = $('#authPassword').value;
  const email = $('#authEmail').value.trim().toLowerCase(); const error = $('#authError'); error.textContent = '';
  if (authMode === 'signup') {
    if (!id || !email) { error.textContent = 'Please fill in all the fields.'; return; }
    if ($('#authConfirm').value !== pass) { error.textContent = 'Those passwords don’t match yet.'; return; }
    if (cloud) {
      try {
        if (pass.length < 6) { error.textContent = 'Use a password with at least 6 characters.'; return; }
        pendingUsername = id.includes('@') ? id.split('@')[0] : id;
        const credential = await cloud.authSdk.createUserWithEmailAndPassword(cloud.auth, email, pass);
        await cloud.authSdk.updateProfile(credential.user, { displayName: pendingUsername });
        await enterApp(credential.user.uid, credential.user);
      } catch (authError) {
        pendingUsername = '';
        error.textContent = authError.code === 'auth/email-already-in-use' ? 'That email already has an account.' : authError.code === 'auth/weak-password' ? 'Use a password with at least 6 characters.' : 'Could not create the account. Check the email and try again.';
      }
      return;
    }
    const key = id.includes('@') ? id : id;
    if (db.users[key]) { error.textContent = 'That username or email already has an account.'; return; }
    if (Object.values(db.users).some(user => user.email === email)) { error.textContent = 'That email is already in use.'; return; }
      const name = id.includes('@') ? id.split('@')[0] : id;
    db.users[key] = { password: pass, email }; db.profiles[key] = { user: key, name, username: name.toLowerCase(), email, currency: 'INR', sources: [], transactions: [], loans: [], budgets: [], goals: [], recurringItems: [], sharedLoans: [], investments: [] }; saveDb(); enterApp(key);
  } else {
    if (cloud) {
      try {
        if (!id.includes('@')) { error.textContent = 'Use your account email to log in when cloud sync is enabled.'; return; }
        const credential = await cloud.authSdk.signInWithEmailAndPassword(cloud.auth, id, pass);
        await enterApp(credential.user.uid, credential.user);
      } catch (authError) {
        error.textContent = authError.code === 'auth/invalid-credential' || authError.code === 'auth/user-not-found' ? 'That login didn’t match. Check your details and try again.' : 'Could not log in. Check your connection and try again.';
      }
      return;
    }
    const key = Object.keys(db.users).find(user => user.toLowerCase() === id || db.users[user].email.toLowerCase() === id);
    if (!key || db.users[key].password !== pass) { error.textContent = 'That login didn’t match. Check your details and try again.'; return; }
    enterApp(key);
  }
});

function navigate(page) {
  $$('.page').forEach(node => node.classList.toggle('active', node.id === `page-${page}`));
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.page === page));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
$$('[data-page]').filter(node => !node.classList.contains('nav-item')).forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
$('#avatarButton').addEventListener('click', () => navigate('settings'));
$('#dismissCloudBanner').addEventListener('click', () => $('#cloudBanner').remove());
$('#logoutButton').addEventListener('click', async () => { stopSharedLoans?.(); stopSharedLoans = null; if (cloud) await cloud.authSdk.signOut(cloud.auth); cloudUser = null; localStorage.removeItem(SESSION_KEY); $('#appView').classList.add('hidden'); $('#authView').classList.remove('hidden'); $('#authForm').reset(); setAuthMode('login'); });

function injectFeatureUI() {
  const report = document.createElement('article'); report.className = 'card report-card';
  report.innerHTML = `<div class="section-title-row"><div><span class="card-label">SIX-MONTH REPORT</span><h2>Cash flow over time</h2></div><div class="report-legend"><span><i class="report-key income-key"></i>Income</span><span><i class="report-key expense-key"></i>Spending</span></div></div><p class="report-caption">Logged income and spending by month</p><div class="monthly-chart" id="monthlyChart"></div>`;
  $('.dashboard-grid').after(report);

  const budgets = document.createElement('section'); budgets.className = 'feature-block'; budgets.innerHTML = `<div class="feature-heading"><div><span class="card-label">SPENDING GUARDRAILS</span><h2>Monthly category budgets</h2><p>Know when a category is getting close to its limit.</p></div><button class="button secondary" data-feature-modal="budget">＋ Set budget</button></div><div class="budget-grid" id="budgetGrid"></div>`;
  $('.summary-strip').after(budgets);

  const tools = document.createElement('div'); tools.className = 'expense-tools'; tools.innerHTML = `<label class="search-box"><span>⌕</span><input id="transactionSearch" type="search" placeholder="Search transactions" aria-label="Search transactions" /></label><button class="button secondary export-button" id="exportCsv">↓ <span>Export CSV</span></button>`;
  $('.table-toolbar').append(tools);
  const recurring = document.createElement('section'); recurring.className = 'feature-block recurring-block'; recurring.innerHTML = `<div class="feature-heading"><div><span class="card-label">REPEATING EACH MONTH</span><h2>Recurring commitments</h2><p>Subscriptions and regular bills, with a simple paid reminder.</p></div><button class="button secondary" data-feature-modal="recurring">＋ Add bill</button></div><div class="recurring-grid" id="recurringGrid"></div>`;
  $('.table-card').before(recurring);

  const due = document.createElement('article'); due.className = 'card due-card'; due.innerHTML = `<div class="section-title-row"><div><span class="card-label">UP NEXT</span><h2>Loan due dates</h2></div><span class="due-count" id="dueCount">0 due soon</span></div><div id="dueLoanList" class="due-list"></div>`;
  $('.loan-summary').after(due);

  const goals = document.createElement('section'); goals.className = 'feature-block goals-block'; goals.innerHTML = `<div class="feature-heading"><div><span class="card-label">A LITTLE AT A TIME</span><h2>Savings goals</h2><p>Give the next thing you want a plan.</p></div><button class="button secondary" data-feature-modal="goal">＋ New goal</button></div><div class="goal-grid" id="goalGrid"></div>`;
  $('#incomeSources').after(goals);

  const theme = document.createElement('div'); theme.className = 'settings-row theme-row'; theme.innerHTML = `<div><strong>Appearance</strong><span>Choose a dark or light look for moneo.</span></div><button class="theme-toggle" id="themeToggle" type="button" aria-pressed="false"><span class="theme-toggle-icon">☾</span><span id="themeLabel">Dark theme</span><i></i></button>`;
  $('.settings-divider').before(theme);
}
injectFeatureUI();

const modalDefinitions = {
  transaction: { eyebrow: 'KEEP TRACK OF THE LITTLE THINGS', title: 'New transaction', button: 'Save transaction', fields: `<div class="form-grid"><label class="wide">What was it for?<input name="title" required maxlength="50" placeholder="e.g. Lunch with friends" /></label><label>Amount<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label><label>Category<select name="category"><option>Food</option><option>Transport</option><option>Study</option><option>Shopping</option><option>Other</option></select></label><label>Date<input name="date" required type="date" value="${currentDate()}" /></label><label>Type<select name="kind"><option value="expense">Expense</option><option value="income">Income</option></select></label></div>` },
  income: { eyebrow: 'MONEY COMING IN', title: 'Add income source', button: 'Add source', fields: `<div class="form-grid"><label class="wide">Source name<input name="name" required maxlength="40" placeholder="e.g. Part-time job" /></label><label class="wide">Monthly amount<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label></div>` },
  loan: { eyebrow: 'KEEP THE DETAILS HANDY', title: 'Track a loan', button: 'Save loan', fields: `<div class="form-grid"><label>Person’s name<input name="person" required maxlength="40" placeholder="Their name" /></label><label>Direction<select name="direction"><option value="lent">I lent</option><option value="borrowed">I borrowed</option></select></label><label class="wide">Their moneo username or email (optional)<input id="loanCounterparty" name="counterpartyEmail" type="text" placeholder="username or friend@example.com" autocomplete="off" /><span id="accountMatch" class="account-match" aria-live="polite">Add their username or account email to check if they use moneo.</span></label><label>Amount<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label><label>Date lent / borrowed<input name="date" required type="date" value="${currentDate()}" /></label><label>Due date (optional)<input name="dueDate" type="date" /></label><label class="wide">Note (optional)<input name="note" maxlength="60" placeholder="A little context" /></label></div>` },
  budget: { eyebrow: 'SET A MONTHLY LIMIT', title: 'Create a category budget', button: 'Save budget', fields: `<div class="form-grid"><label>Category<select name="category"><option>Food</option><option>Transport</option><option>Study</option><option>Shopping</option><option>Other</option></select></label><label>Monthly limit<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label></div>` },
  goal: { eyebrow: 'SAVE FOR SOMETHING YOU WANT', title: 'Create a savings goal', button: 'Create goal', fields: `<div class="form-grid"><label class="wide">Goal name<input name="name" required maxlength="40" placeholder="e.g. New laptop" /></label><label>Target amount<input name="target" required type="number" min="1" step="1" placeholder="0" /></label><label>Already saved<input name="saved" type="number" min="0" step="1" value="0" /></label><label class="wide">Target date (optional)<input name="targetDate" type="date" /></label></div>` },
  recurring: { eyebrow: 'PLAN FOR THE REGULAR THINGS', title: 'Add a monthly commitment', button: 'Add commitment', fields: `<div class="form-grid"><label class="wide">Bill or subscription<input name="name" required maxlength="45" placeholder="e.g. Music subscription" /></label><label>Amount<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label><label>Category<select name="category"><option>Other</option><option>Food</option><option>Transport</option><option>Study</option><option>Shopping</option></select></label><label class="wide">Due day of each month<input name="dueDay" required type="number" min="1" max="28" value="1" /></label></div>` },
  contribution: { eyebrow: 'MOVE CLOSER TO YOUR GOAL', title: 'Add savings', button: 'Add to goal', fields: '' },
  investment: { eyebrow: 'BUILD YOUR PORTFOLIO', title: 'Add an investment', button: 'Add investment', fields: `<div class="form-grid"><label>Investment type<select name="type"><option>Stocks</option><option>Mutual funds</option><option>Gold</option><option>Silver</option><option>Savings account</option><option>Fixed deposit</option><option>Bonds</option><option>Crypto</option><option>Other</option></select></label><label>Investment name<input name="name" required maxlength="50" placeholder="e.g. Nifty index fund" /></label><label class="wide">Bank, broker, or platform (optional)<input name="provider" maxlength="45" placeholder="e.g. Zerodha or SBI" /></label><label>Amount invested<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label><label>Value today (optional)<input name="currentValue" type="number" min="0" step="1" placeholder="Same as invested" /></label><label>Started on<input name="date" required type="date" value="${currentDate()}" /></label><label>Units or quantity (optional)<input name="units" type="number" min="0" step="any" placeholder="e.g. 2.5" /></label></div>` },
  valuation: { eyebrow: 'UPDATE YOUR PORTFOLIO', title: 'Update current value', button: 'Save value', fields: '' }
};
function applyTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light-theme', light);
  const toggle = $('#themeToggle');
  if (toggle) { toggle.setAttribute('aria-pressed', String(light)); $('#themeLabel').textContent = light ? 'Light theme' : 'Dark theme'; $('.theme-toggle-icon', toggle).textContent = light ? '☀' : '☾'; }
}
function openModal(type, investmentId = null) {
  modalType = type; modalInvestmentId = investmentId; const def = modalDefinitions[type]; let fields = def.fields;
  if (type === 'contribution') {
    const goals = profile()?.goals || [];
    if (!goals.length) { showToast('Create a savings goal first.'); return; }
    fields = `<div class="form-grid"><label class="wide">Savings goal<select name="goalId">${goals.map(goal => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.name)}</option>`).join('')}</select></label><label class="wide">Amount to add<input name="amount" required type="number" min="1" step="1" placeholder="0" /></label></div>`;
  }
  if (type === 'valuation') {
    const investment = profile()?.investments?.find(item => item.id === modalInvestmentId);
    if (!investment) return;
    fields = `<input type="hidden" name="investmentId" value="${escapeHtml(investment.id)}" /><div class="form-grid"><label class="wide">Current value<input name="currentValue" required type="number" min="0" step="1" value="${Number(investment.currentValue)}" /></label><p class="form-hint wide">Update this when you want to refresh the portfolio estimate.</p></div>`;
  }
  $('#modalEyebrow').textContent = def.eyebrow; $('#modalTitle').textContent = def.title; $('#modalSubmit').innerHTML = `${def.button} <span>↗</span>`; $('#modalFields').innerHTML = fields; $('#modalBackdrop').classList.remove('hidden'); if (type === 'loan') setupCounterpartyLookup(); const focus = $('#modalFields input, #modalFields select'); focus?.focus();
}
function closeModal() { $('#modalBackdrop').classList.add('hidden'); $('#entryForm').reset(); }
$$('[data-open-modal]').forEach(button => button.addEventListener('click', () => openModal(button.dataset.openModal)));
$('#quickAdd').addEventListener('click', () => openModal('transaction'));
$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
document.addEventListener('click', event => {
  const feature = event.target.closest('[data-feature-modal]');
  if (feature) openModal(feature.dataset.featureModal);
  const updateInvestment = event.target.closest('[data-update-investment]');
  if (updateInvestment) openModal('valuation', updateInvestment.dataset.updateInvestment);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
let matchedCounterparty = null;
let lookupTimer;
function setupCounterpartyLookup() {
  matchedCounterparty = null;
  const input = $('#loanCounterparty'); const status = $('#accountMatch');
  status.textContent = cloud ? 'Enter their moneo username or account email to check.' : 'Cross-account matching will be available after Firebase setup.';
  input.addEventListener('input', () => {
    clearTimeout(lookupTimer); matchedCounterparty = null;
    const email = input.value.trim().toLowerCase();
    if (!email || !cloud || !cloudUser) { status.textContent = email ? 'Sign in to a connected account to look up moneo users.' : 'Enter their moneo username or account email to check.'; return; }
    status.textContent = 'Checking moneo accounts…';
    lookupTimer = setTimeout(async () => {
      try {
        const { doc, getDoc } = cloud.dbSdk;
        const result = await getDoc(doc(cloud.firestore, 'userDirectory', await emailLookupId(email)));
        if (result.exists() && result.data().uid !== cloudUser.uid && (result.data().email.toLowerCase() === email || result.data().username === email)) {
          matchedCounterparty = result.data(); status.textContent = `${result.data().name || email} has a moneo account. This loan will appear in both accounts.`;
        } else if (result.exists() && result.data().uid === cloudUser.uid) {
          status.textContent = 'That email belongs to your own account. Enter the other person’s account email.';
        } else status.textContent = 'No moneo account found. This loan will stay on your account.';
      } catch (error) { console.error(error); status.textContent = 'Could not check accounts. Try again in a moment.'; }
    }, 450);
  });
}
$('#entryForm').addEventListener('submit', async event => {
  event.preventDefault(); const p = profile(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); const amount = Number(data.amount);
  if (modalType === 'valuation') { if (!Number.isFinite(Number(data.currentValue)) || Number(data.currentValue) < 0) return; }
  else if (!Number.isFinite(amount) || amount <= 0) return;
  if (modalType === 'transaction') p.transactions.unshift({ id: crypto.randomUUID?.() || String(Date.now()), title: data.title.trim(), amount, category: data.category, date: data.date, kind: data.kind });
  if (modalType === 'income') p.sources.push({ id: crypto.randomUUID?.() || String(Date.now()), name: data.name.trim(), amount });
  let sharedWasAdded = false; let sharedFailed = false;
  if (modalType === 'loan') {
    if (matchedCounterparty && cloud && cloudUser) {
      try {
        const { addDoc, collection, serverTimestamp } = cloud.dbSdk;
        const isLent = data.direction === 'lent';
        await addDoc(collection(cloud.firestore, 'sharedLoans'), { participantUids: [cloudUser.uid, matchedCounterparty.uid], lenderUid: isLent ? cloudUser.uid : matchedCounterparty.uid, borrowerUid: isLent ? matchedCounterparty.uid : cloudUser.uid, participantNames: { [cloudUser.uid]: p.name, [matchedCounterparty.uid]: matchedCounterparty.name }, createdBy: cloudUser.uid, amount, currency: p.currency || 'INR', date: data.date, dueDate: data.dueDate || '', note: (data.note || '').trim(), status: 'open', createdAt: serverTimestamp() });
        sharedWasAdded = true;
      } catch (error) { console.error(error); sharedFailed = true; p.loans.unshift({ id: crypto.randomUUID?.() || String(Date.now()), person: data.person.trim(), direction: data.direction, amount, date: data.date, dueDate: data.dueDate || '', note: (data.note || '').trim(), settled: false }); }
    } else p.loans.unshift({ id: crypto.randomUUID?.() || String(Date.now()), person: data.person.trim(), direction: data.direction, amount, date: data.date, dueDate: data.dueDate || '', note: (data.note || '').trim(), settled: false });
  }
  const savedType = modalType;
  if (savedType === 'budget') { const found = p.budgets.find(item => item.category === data.category); if (found) found.amount = amount; else p.budgets.push({ id: crypto.randomUUID?.() || String(Date.now()), category: data.category, amount }); }
  if (savedType === 'goal') p.goals.push({ id: crypto.randomUUID?.() || String(Date.now()), name: data.name.trim(), target: Number(data.target), saved: Number(data.saved || 0), targetDate: data.targetDate || '' });
  if (savedType === 'contribution') { const goal = p.goals.find(item => item.id === data.goalId); if (goal) goal.saved = Number(goal.saved || 0) + amount; }
  if (savedType === 'recurring') p.recurringItems.push({ id: crypto.randomUUID?.() || String(Date.now()), name: data.name.trim(), amount, category: data.category, dueDay: Number(data.dueDay), paidMonth: '' });
  if (savedType === 'investment') p.investments.push({ id: crypto.randomUUID?.() || String(Date.now()), type: data.type, name: data.name.trim(), provider: (data.provider || '').trim(), amount, currentValue: data.currentValue === '' ? amount : Number(data.currentValue), date: data.date, units: data.units === '' ? '' : Number(data.units) });
  if (savedType === 'valuation') { const holding = p.investments.find(item => item.id === data.investmentId); if (holding) holding.currentValue = Number(data.currentValue); }
  let budgetNotice = '';
  if (savedType === 'transaction' && data.kind !== 'income' && thisMonth(data.date)) {
    const limit = p.budgets.find(item => item.category === data.category);
    if (limit) { const spent = total(p.transactions, item => item.kind !== 'income' && item.category === data.category && thisMonth(item.date)); const percent = Math.round(spent / limit.amount * 100); if (percent >= 100) budgetNotice = `${data.category} budget reached or exceeded.`; else if (percent >= 80) budgetNotice = `${data.category} budget is ${percent}% used.`; }
  }
  saveDb(); render(); closeModal();
  if (sharedWasAdded) showToast('Shared loan added to both accounts.'); else if (sharedFailed) showToast('Cloud share failed; loan saved only to your account.'); else showToast(budgetNotice || ({ transaction: 'Transaction added.', income: 'Income source added.', loan: 'Loan added to your account.', budget: 'Budget saved.', goal: 'Savings goal created.', contribution: 'Savings added to your goal.', recurring: 'Monthly commitment added.', investment: 'Investment added to your portfolio.', valuation: 'Portfolio value updated.' })[savedType] || 'Saved.');
});

function total(arr, filter = () => true) { return arr.filter(filter).reduce((sum, item) => sum + Number(item.amount || 0), 0); }
function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function thisMonth(date) { return String(date || '').slice(0, 7) === monthKey(); }
function fmtDate(value) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date); }
function activityMarkup(item, loan = false) {
  const isIncome = item.kind === 'income'; const symbol = loan ? (item.direction === 'lent' ? '↗' : '↙') : (isIncome ? '＋' : '↘');
  const subtitle = loan ? `${item.direction === 'lent' ? 'Lent to' : 'Borrowed from'} ${escapeHtml(item.person)} · ${fmtDate(item.date)}` : `${escapeHtml(item.category || 'Income')} · ${fmtDate(item.date)}`;
  const prefix = !loan && isIncome ? '+' : !loan ? '−' : '';
  return `<div class="activity-row"><div class="activity-mark">${symbol}</div><div class="activity-desc"><strong>${escapeHtml(loan ? item.person : item.title)}</strong><span>${subtitle}</span></div><span class="activity-amount ${loan ? '' : isIncome ? 'income' : 'expense'}">${prefix}${money(item.amount)}</span></div>`;
}
function renderTransactions(p) {
  const transactions = [...p.transactions].sort((a, b) => b.date.localeCompare(a.date));
  $('#recentActivity').innerHTML = transactions.length ? transactions.slice(0, 4).map(item => activityMarkup(item)).join('') : `<div class="empty-state"><span class="empty-icon">↗</span><strong>Nothing to see yet</strong><span>Add your first transaction to get going.</span></div>`;
  const filter = $('#expenseFilter').value; const search = ($('#transactionSearch')?.value || '').trim().toLowerCase(); const filtered = transactions.filter(item => (filter === 'all' || item.category === filter) && (!search || `${item.title} ${item.category} ${item.date} ${item.kind}`.toLowerCase().includes(search)));
  $('#transactionList').innerHTML = filtered.length ? filtered.map(item => `<div class="transaction-row"><div class="transaction-main"><span class="activity-mark">${item.kind === 'income' ? '＋' : '↘'}</span><div><strong>${escapeHtml(item.title)}</strong><span>${item.kind === 'income' ? 'Income' : escapeHtml(item.category)}</span></div></div><span class="date-text">${fmtDate(item.date)}</span><span class="activity-amount ${item.kind === 'income' ? 'income' : 'expense'}">${item.kind === 'income' ? '+' : '−'}${money(item.amount)}</span><button class="delete-entry" data-delete-transaction="${escapeHtml(item.id)}" aria-label="Delete transaction">×</button></div>`).join('') : `<div class="empty-state"><strong>${transactions.length ? 'No matching transactions' : 'No expenses yet'}</strong><span>${transactions.length ? 'Try another search or category.' : 'When you add one, it’ll show up here.'}</span></div>`;
  const expenses = p.transactions.filter(item => item.kind !== 'income' && thisMonth(item.date)); const categoryTotals = {};
  expenses.forEach(item => categoryTotals[item.category] = (categoryTotals[item.category] || 0) + Number(item.amount));
  const entries = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1]);
  $('#categoryLegend').innerHTML = entries.length ? entries.slice(0, 4).map(([category, amount]) => `<div class="legend-item"><span class="legend-label"><i class="legend-color" style="background:${colors[category] || colors.Other}"></i>${escapeHtml(category)}</span><span class="legend-value">${money(amount)}</span></div>`).join('') : `<div class="empty-state small">Your categories will show here.</div>`;
  if (entries.length) { const sum = entries.reduce((total, [, amount]) => total + amount, 0); let angle = 0; const segments = entries.map(([category, amount]) => { const start = angle; angle += amount / sum * 360; return `${colors[category] || colors.Other} ${start}deg ${angle}deg`; }); $('#spendingDonut').style.background = `conic-gradient(${segments.join(', ')})`; }
  else $('#spendingDonut').style.background = 'conic-gradient(#303640 0deg 360deg)';
  $('#donutTotal').textContent = money(total(expenses));
  const allExpenses = p.transactions.filter(item => item.kind !== 'income'); $('#transactionCount').textContent = allExpenses.length; $('#expensePageTotal').textContent = money(total(expenses)); $('#topCategory').textContent = entries[0]?.[0] || '—';
}
function renderLoans(p) {
  const open = p.loans.filter(item => !item.settled); const shared = (p.sharedLoans || []).filter(item => item.status === 'open').map(item => ({ ...item, shared: true, direction: item.lenderUid === cloudUser?.uid ? 'lent' : 'borrowed', person: item.participantNames?.[item.lenderUid === cloudUser?.uid ? item.borrowerUid : item.lenderUid] || 'moneo user' }));
  const lent = [...open.filter(item => item.direction === 'lent'), ...shared.filter(item => item.direction === 'lent')]; const borrowed = [...open.filter(item => item.direction === 'borrowed'), ...shared.filter(item => item.direction === 'borrowed')];
  $('#loansOwed').textContent = money(total(lent)); $('#loansOwe').textContent = money(total(borrowed)); $('#openLoans').textContent = lent.length + borrowed.length; $('#owedTotal').textContent = money(total(lent)); $('#owedCount').textContent = lent.length ? `${lent.length} ${lent.length === 1 ? 'person' : 'people'} to follow up` : 'No active loans';
  const list = (items, cls) => items.length ? items.map(item => `<div class="loan-row ${cls}-list"><div class="loan-person">${escapeHtml(item.person[0]?.toUpperCase() || '?')}</div><div class="loan-details"><strong>${escapeHtml(item.person)}${item.shared ? ' <span class="shared-tag">SHARED</span>' : ''}</strong><span>${item.note ? `${escapeHtml(item.note)} · ` : ''}${fmtDate(item.date)}${item.dueDate ? ` · Due ${fmtDate(item.dueDate)}` : ''}${item.shared ? ' · synced across accounts' : ''}</span></div><strong class="loan-money ${cls}">${money(item.amount)}</strong><button class="loan-settle" ${item.shared ? `data-settle-shared="${escapeHtml(item.id)}"` : `data-settle-loan="${escapeHtml(item.id)}"`}>Settle</button></div>`).join('') : `<div class="empty-state"><strong>${cls === 'lent' ? 'No one on the list' : 'All clear for now'}</strong><span>${cls === 'lent' ? 'Track a loan when you lend money.' : 'Add a loan you’ve taken to keep track.'}</span></div>`;
  $('#lentList').innerHTML = list(lent, 'lent'); $('#borrowedList').innerHTML = list(borrowed, 'borrowed');
  const dueLoans = [...lent, ...borrowed].filter(item => item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $('#dueCount').textContent = dueLoans.length ? `${dueLoans.length} tracked` : 'No dates yet';
  $('#dueLoanList').innerHTML = dueLoans.length ? dueLoans.map(item => { const days = Math.ceil((new Date(`${item.dueDate}T12:00:00`) - new Date(`${currentDate()}T12:00:00`)) / 86400000); const status = days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? 'Due today' : `Due in ${days} days`; return `<div class="due-row"><span class="due-dot ${days < 0 ? 'overdue' : days <= 7 ? 'soon' : ''}"></span><div><strong>${escapeHtml(item.person)} · ${item.direction === 'lent' ? 'lent' : 'borrowed'}</strong><span>${status} · ${fmtDate(item.dueDate)}</span></div><b>${money(item.amount)}</b></div>`; }).join('') : `<div class="empty-state small">Add an optional due date to a loan to see reminders here.</div>`;
}
function watchSharedLoans() {
  stopSharedLoans?.(); stopSharedLoans = null;
  if (!cloud || !cloudUser) return;
  const { collection, onSnapshot, query, where } = cloud.dbSdk;
  const sharedQuery = query(collection(cloud.firestore, 'sharedLoans'), where('participantUids', 'array-contains', cloudUser.uid));
  stopSharedLoans = onSnapshot(sharedQuery, snapshot => {
    const p = profile(); p.sharedLoans = snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
    localStorage.setItem(DB_KEY, JSON.stringify(db)); render();
  }, error => { console.error(error); showToast('Could not sync shared loans.'); });
}
function renderIncome(p) {
  const sourceTotal = total(p.sources); $('#incomeTotal').textContent = money(sourceTotal); $('#incomePageTotal').textContent = money(sourceTotal); $('#incomeSourceCount').textContent = p.sources.length ? `${p.sources.length} income ${p.sources.length === 1 ? 'source' : 'sources'}` : 'Add your income sources';
  $('#incomeSources').innerHTML = p.sources.length ? p.sources.map((source, index) => `<article class="card income-source-card"><div class="source-top"><span class="source-symbol">${['↗','✳','＋','⌂'][index % 4]}</span><button class="delete-entry" data-delete-source="${escapeHtml(source.id)}" aria-label="Remove source">×</button></div><strong>${money(source.amount)}<span style="font:10px var(--sans);color:#858c99"> / month</span></strong><p>${escapeHtml(source.name)}</p></article>`).join('') : `<div class="card empty-state"><strong>No income sources yet</strong><span>Add a job, allowance, scholarship, or anything else.</span></div>`;
}
function renderFeatureCards(p) {
  const monthExpenses = p.transactions.filter(item => item.kind !== 'income' && thisMonth(item.date));
  $('#budgetGrid').innerHTML = p.budgets.length ? p.budgets.map(budget => {
    const spent = total(monthExpenses, item => item.category === budget.category); const percent = Math.round(spent / Math.max(1, Number(budget.amount)) * 100); const bounded = Math.min(100, percent);
    return `<article class="card budget-card ${percent >= 100 ? 'is-over' : percent >= 80 ? 'is-close' : ''}"><div class="budget-top"><span class="category-chip" style="--chip:${colors[budget.category] || colors.Other}">${escapeHtml(budget.category)}</span><button class="delete-entry" data-delete-budget="${escapeHtml(budget.id)}" aria-label="Remove budget">×</button></div><div class="budget-amount"><strong>${money(spent)}</strong><span>of ${money(budget.amount)}</span></div><div class="progress-track"><i style="width:${bounded}%"></i></div><div class="budget-bottom"><span>${percent}% used</span><b>${percent >= 100 ? `${money(spent - budget.amount)} over` : `${money(budget.amount - spent)} left`}</b></div></article>`;
  }).join('') : `<div class="card empty-state"><strong>No budgets set</strong><span>Set a category limit to keep spending on track.</span></div>`;

  $('#goalGrid').innerHTML = p.goals.length ? p.goals.map(goal => {
    const percent = Math.round(Number(goal.saved || 0) / Math.max(1, Number(goal.target)) * 100);
    return `<article class="card goal-card"><div class="goal-top"><span class="goal-symbol">✳</span><button class="delete-entry" data-delete-goal="${escapeHtml(goal.id)}" aria-label="Delete goal">×</button></div><h3>${escapeHtml(goal.name)}</h3><div class="goal-amount"><strong>${money(goal.saved || 0)}</strong><span>of ${money(goal.target)}</span></div><div class="progress-track"><i style="width:${Math.min(100, percent)}%"></i></div><div class="budget-bottom"><span>${Math.min(100, percent)}% saved${goal.targetDate ? ` · target ${fmtDate(goal.targetDate)}` : ''}</span><button class="text-button" data-contribute-goal="${escapeHtml(goal.id)}">＋ Add</button></div></article>`;
  }).join('') : `<div class="card empty-state"><strong>Nothing you’re saving for yet</strong><span>Create a goal and track progress as you save.</span></div>`;

  const month = monthKey();
  $('#recurringGrid').innerHTML = p.recurringItems.length ? p.recurringItems.map(item => {
    const paid = item.paidMonth === month;
    return `<article class="card recurring-card"><div class="recurring-symbol">↻</div><div class="recurring-info"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)} · Day ${item.dueDay} each month</span></div><b>${money(item.amount)}</b><button class="button ${paid ? 'paid-button' : 'secondary'}" data-pay-recurring="${escapeHtml(item.id)}" ${paid ? 'disabled' : ''}>${paid ? '✓ Paid' : 'Mark paid'}</button><button class="delete-entry" data-delete-recurring="${escapeHtml(item.id)}" aria-label="Remove commitment">×</button></article>`;
  }).join('') : `<div class="card empty-state"><strong>No recurring commitments</strong><span>Add regular bills or subscriptions to remember them each month.</span></div>`;

  const points = [];
  for (let offset = 5; offset >= 0; offset--) { const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - offset); const key = monthKey(date); const label = new Intl.DateTimeFormat('en', { month: 'short' }).format(date); points.push({ key, label, income: total(p.transactions, item => item.kind === 'income' && item.date?.startsWith(key)), expense: total(p.transactions, item => item.kind !== 'income' && item.date?.startsWith(key)) }); }
  const max = Math.max(1, ...points.flatMap(point => [point.income, point.expense]));
  $('#monthlyChart').innerHTML = points.some(point => point.income || point.expense) ? points.map(point => `<div class="chart-month" title="${point.label}: income ${money(point.income)}, spending ${money(point.expense)}"><div class="chart-bars"><i class="chart-income" style="height:${Math.max(point.income ? 5 : 0, point.income / max * 100)}%"></i><i class="chart-expense" style="height:${Math.max(point.expense ? 5 : 0, point.expense / max * 100)}%"></i></div><span>${point.label}</span></div>`).join('') : `<div class="empty-state small chart-empty">Log income and expenses to build your six-month report.</div>`;
}
function renderInvestments(p) {
  const holdings = p.investments || [];
  $('#holdingCount').textContent = `${holdings.length} ${holdings.length === 1 ? 'HOLDING' : 'HOLDINGS'}`;
  const invested = total(holdings); const value = holdings.reduce((sum, item) => sum + Number(item.currentValue ?? item.amount ?? 0), 0); const change = value - invested; const percent = invested ? change / invested * 100 : 0;
  $('#investmentCost').textContent = money(invested); $('#investmentValue').textContent = money(value); $('#investmentGain').textContent = `${change >= 0 ? '+' : '−'}${money(Math.abs(change))}`; $('#investmentGain').classList.toggle('gain-positive', change >= 0); $('#investmentGain').classList.toggle('gain-negative', change < 0); $('#investmentReturn').textContent = `${change >= 0 ? '+' : ''}${percent.toFixed(1)}% overall`;
  const allocations = new Map(); holdings.forEach(item => allocations.set(item.type || 'Other', (allocations.get(item.type || 'Other') || 0) + Number(item.currentValue ?? item.amount ?? 0)));
  const allocationEntries = [...allocations.entries()].sort((a, b) => b[1] - a[1]);
  $('#investmentAllocation').innerHTML = allocationEntries.length ? allocationEntries.map(([type, amount], index) => `<div class="allocation-row"><div><span class="allocation-name"><i style="--allocation:${investmentColors[index % investmentColors.length]}"></i>${escapeHtml(type)}</span><strong>${money(amount)}</strong></div><div class="allocation-track"><i style="width:${value ? amount / value * 100 : 0}%;--allocation:${investmentColors[index % investmentColors.length]}"></i></div></div>`).join('') : `<div class="empty-state small">Add an investment to see your portfolio mix.</div>`;
  $('#investmentList').innerHTML = holdings.length ? [...holdings].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(item => {
    const currentValue = Number(item.currentValue ?? item.amount ?? 0); const gain = currentValue - Number(item.amount || 0); const returnRate = item.amount ? gain / Number(item.amount) * 100 : 0;
    return `<article class="card holding-card"><div class="holding-icon">${escapeHtml((item.type || 'Other').slice(0, 1).toUpperCase())}</div><div class="holding-main"><div class="holding-title"><div><span class="holding-type">${escapeHtml(item.type || 'Other')}</span><h3>${escapeHtml(item.name)}</h3></div><div class="holding-actions"><button class="text-button" data-update-investment="${escapeHtml(item.id)}">Update value</button><button class="delete-entry" data-delete-investment="${escapeHtml(item.id)}" aria-label="Remove investment">×</button></div></div><p>${escapeHtml(item.provider || 'Personal holding')}${item.units ? ` · ${escapeHtml(item.units)} units` : ''} · Added ${fmtDate(item.date)}</p></div><div class="holding-values"><span>Current value</span><strong>${money(currentValue)}</strong><small class="${gain >= 0 ? 'gain-positive' : 'gain-negative'}">${gain >= 0 ? '+' : '−'}${money(Math.abs(gain))} (${returnRate >= 0 ? '+' : ''}${returnRate.toFixed(1)}%)</small></div></article>`;
  }).join('') : `<div class="card empty-state investment-empty"><span class="empty-icon">↗</span><strong>Your portfolio starts here</strong><span>Add gold, savings, shares, or another holding to track its value.</span></div>`;
}
function render() {
  const p = profile(); if (!p) return;
  const income = total(p.sources) + total(p.transactions, item => item.kind === 'income' && thisMonth(item.date)); const expenses = total(p.transactions, item => item.kind !== 'income' && thisMonth(item.date)); const balance = income - expenses;
  $('#balanceAmount').textContent = money(balance); $('#balancePill').textContent = balance < 0 ? 'OVER BUDGET' : balance === 0 ? 'GET STARTED' : 'ON TRACK'; $('#balancePill').classList.toggle('positive', balance >= 0); $('#balanceTrend').textContent = `${money(Math.abs(balance))} left`;
  $('#incomeTotal').textContent = money(total(p.sources)); $('#expenseTotal').textContent = money(expenses); $('#expenseCount').textContent = `${p.transactions.filter(item => item.kind !== 'income').length} ${p.transactions.filter(item => item.kind !== 'income').length === 1 ? 'expense' : 'expenses'} logged`;
  const ratio = income ? Math.min(100, Math.round(expenses / income * 100)) : 0; $('#insightText').textContent = income && expenses ? `You’ve spent ${ratio}% of your income so far. ${ratio < 70 ? 'Nice breathing room — keep it up.' : ratio < 100 ? 'You’re getting close to your monthly income.' : 'Your spending is above your income this month.'}` : 'Add your income and a few transactions to unlock a clearer picture of your spending.';
  renderTransactions(p); renderLoans(p); renderIncome(p); renderFeatureCards(p); renderInvestments(p); $('#settingsStorageNote').textContent = cloud ? 'Your profile and finance data sync through Firebase.' : 'Your data is stored locally in this browser for this demo.'; saveDb();
}
$('#expenseFilter').addEventListener('change', () => renderTransactions(profile()));
$('#transactionSearch').addEventListener('input', () => renderTransactions(profile()));
$('#themeToggle').addEventListener('click', () => { const p = profile(); p.theme = p.theme === 'light' ? 'dark' : 'light'; applyTheme(p.theme); saveDb(); });
$('#exportCsv').addEventListener('click', () => {
  const rows = profile().transactions || []; if (!rows.length) { showToast('There are no transactions to export yet.'); return; }
  const csvCell = value => { let cell = String(value ?? ''); if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`; return `"${cell.replace(/"/g, '""')}"`; };
  const csv = [['Date', 'Description', 'Type', 'Category', 'Amount'], ...rows.map(item => [item.date, item.title, item.kind, item.category || '', item.amount])].map(row => row.map(csvCell).join(',')).join('\r\n');
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })); link.href = url; link.download = `moneo-transactions-${monthKey()}.csv`; link.click(); URL.revokeObjectURL(url); showToast('Transactions exported as CSV.');
});
document.addEventListener('click', event => {
  const tx = event.target.closest('[data-delete-transaction]'); const source = event.target.closest('[data-delete-source]'); const settle = event.target.closest('[data-settle-loan]'); const p = profile(); if (!p) return;
  if (tx) { p.transactions = p.transactions.filter(item => item.id !== tx.dataset.deleteTransaction); saveDb(); render(); showToast('Transaction removed.'); }
  if (source) { p.sources = p.sources.filter(item => item.id !== source.dataset.deleteSource); saveDb(); render(); showToast('Income source removed.'); }
  if (settle) { p.loans = p.loans.filter(item => item.id !== settle.dataset.settleLoan); saveDb(); render(); showToast('Loan marked as settled.'); }
  const budget = event.target.closest('[data-delete-budget]'); if (budget) { p.budgets = p.budgets.filter(item => item.id !== budget.dataset.deleteBudget); saveDb(); render(); showToast('Budget removed.'); }
  const investment = event.target.closest('[data-delete-investment]'); if (investment) { p.investments = p.investments.filter(item => item.id !== investment.dataset.deleteInvestment); saveDb(); render(); showToast('Investment removed.'); }
  const goal = event.target.closest('[data-delete-goal]'); if (goal) { p.goals = p.goals.filter(item => item.id !== goal.dataset.deleteGoal); saveDb(); render(); showToast('Savings goal removed.'); }
  const recurringDelete = event.target.closest('[data-delete-recurring]'); if (recurringDelete) { p.recurringItems = p.recurringItems.filter(item => item.id !== recurringDelete.dataset.deleteRecurring); saveDb(); render(); showToast('Commitment removed.'); }
  const pay = event.target.closest('[data-pay-recurring]'); if (pay) { const item = p.recurringItems.find(entry => entry.id === pay.dataset.payRecurring); if (item && item.paidMonth !== monthKey()) { const paidDate = new Date(); paidDate.setDate(Math.min(item.dueDay, new Date(paidDate.getFullYear(), paidDate.getMonth() + 1, 0).getDate())); const date = `${paidDate.getFullYear()}-${String(paidDate.getMonth() + 1).padStart(2, '0')}-${String(paidDate.getDate()).padStart(2, '0')}`; p.transactions.unshift({ id: `${item.id}-${monthKey()}`, title: item.name, amount: Number(item.amount), category: item.category, date, kind: 'expense' }); item.paidMonth = monthKey(); saveDb(); render(); showToast('Payment added to this month’s expenses.'); } }
  const contribution = event.target.closest('[data-contribute-goal]'); if (contribution) { openModal('contribution'); const select = $('#modalFields select[name="goalId"]'); if (select) select.value = contribution.dataset.contributeGoal; }
  const shared = event.target.closest('[data-settle-shared]');
  if (shared && cloud && cloudUser) { const { doc, updateDoc, serverTimestamp } = cloud.dbSdk; updateDoc(doc(cloud.firestore, 'sharedLoans', shared.dataset.settleShared), { status: 'settled', settledAt: serverTimestamp(), settledBy: cloudUser.uid }).then(() => showToast('Shared loan settled for both accounts.')).catch(error => { console.error(error); showToast('Could not update the shared loan.'); }); }
});
$('#currencySelect').addEventListener('change', event => { const p = profile(); p.currency = event.target.value; saveDb(); render(); showToast('Currency updated.'); });
$('#clearData').addEventListener('click', () => { if (!confirm('Clear your transactions, personal loans, income sources, budgets, savings goals, recurring commitments, and investments?')) return; const p = profile(); p.transactions = []; p.loans = []; p.sources = []; p.budgets = []; p.goals = []; p.recurringItems = []; p.investments = []; saveDb(); render(); showToast('Your personal finance data has been cleared.'); });

if (cloud) {
  $('#cloudBanner').classList.add('hidden');
  $('#authFootnote').textContent = 'Your account and loans sync securely through Firebase.';
  cloud.authSdk.onAuthStateChanged(cloud.auth, user => {
    if (user) enterApp(user.uid, user);
    else { localStorage.removeItem(SESSION_KEY); $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
  });
} else {
  if (firebaseConfigured) $('#authFootnote').textContent = 'Firebase could not connect. Check firebase-config.js and reload.';
  if (profileKey() && db.users[profileKey()]) enterApp(profileKey());
  else { localStorage.removeItem(SESSION_KEY); $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
}
