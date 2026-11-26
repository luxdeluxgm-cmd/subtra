import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY;

const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http') &&
    supabaseAnonKey.length > 20
);

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

function clampChannel(val) {
  if (Number.isNaN(val)) return 0;
  return Math.min(100, Math.max(0, Math.round(val / 5) * 5));
}

function cmykToRgb({ c, m, y, k }) {
  const cNorm = clampChannel(c) / 100;
  const mNorm = clampChannel(m) / 100;
  const yNorm = clampChannel(y) / 100;
  const kNorm = clampChannel(k) / 100;

  const r = Math.round(255 * (1 - cNorm) * (1 - kNorm));
  const g = Math.round(255 * (1 - mNorm) * (1 - kNorm));
  const b = Math.round(255 * (1 - yNorm) * (1 - kNorm));

  return {
    r,
    g,
    b,
    css: `rgb(${r}, ${g}, ${b})`,
  };
}

function getNextUtcMidnightCountdown(now = new Date()) {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0
  );
  const diffSeconds = Math.max(0, Math.floor((nextMidnight - now.getTime()) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatAccountLabel(user) {
  if (!user || user.is_anonymous) return 'GUEST SESSION';
  return user.email ?? 'SIGNED IN';
}

function initAuth(onUserChange) {
  if (!supabase) {
    onUserChange(null, true);
    return;
  }

  let initialHandled = false;
  supabase.auth.onAuthStateChange((event, session) => {
    const isInitial = !initialHandled && event === 'INITIAL_SESSION';
    initialHandled = true;
    onUserChange(session?.user ?? null, isInitial);
  });
}

async function ensureAuthenticatedUser() {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) {
    return sessionData.session.user;
  }
  const { data: anonData } = await supabase.auth.signInAnonymously();
  return anonData.user ?? null;
}

async function signInOrRegisterWithEmail(email, password) {
  if (!supabase) return { error: 'Database is not connected yet.', message: '' };
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@')) {
    return { error: 'Enter a valid email address.', message: '' };
  }
  if (
    password.length < 6 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return {
      error: 'Password must be at least 6 characters with uppercase, lowercase, and a number.',
      message: '',
    };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (!signInError) {
    return { error: null, message: 'Signed in.' };
  }

  const formatAuthError = (msg) => {
    if (msg.includes('Password should contain')) {
      return 'Password must be at least 6 characters with uppercase, lowercase, and a number.';
    }
    return msg;
  };

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user?.is_anonymous) {
    const { error: upgradeError } = await supabase.auth.updateUser({
      email: cleanEmail,
      password,
    });
    if (!upgradeError) {
      return { error: null, message: 'Account saved.' };
    }
    if (upgradeError.message.includes('Password should contain')) {
      return { error: formatAuthError(upgradeError.message), message: '' };
    }
  }

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
  });

  if (signUpError) {
    if (signUpError.message.toLowerCase().includes('already registered')) {
      return { error: 'Invalid email or password.', message: '' };
    }
    return { error: formatAuthError(signUpError.message), message: '' };
  }

  if (signUpData.user && !signUpData.session) {
    return {
      error: null,
      message: 'Check your email inbox to confirm your account.',
    };
  }

  return { error: null, message: 'Account created and signed in.' };
}

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '1062931587296-ueg07eprtn4oc44t3ijq7ir23d9tndk4.apps.googleusercontent.com';

let gsiLoaded = false;

function initGoogleDirectButton(container, onError, onSuccess) {
  if (!supabase || !container) return;

  const renderBtn = () => {
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        if (!response?.credential) {
          onError('Google sign-in was cancelled.');
          return;
        }
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: response.credential,
        });
        if (error) {
          onError(error.message);
          return;
        }
        onSuccess();
      },
    });
    container.innerHTML = '';
    window.google.accounts.id.renderButton(container, {
      theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
      size: 'large',
      width: 320,
      text: 'continue_with',
    });
  };

  if (gsiLoaded && window.google?.accounts?.id) {
    renderBtn();
    return;
  }

  const existing = document.getElementById('gsi-client-script');
  if (existing) return;

  const script = document.createElement('script');
  script.id = 'gsi-client-script';
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    gsiLoaded = true;
    renderBtn();
  };
  document.head.appendChild(script);
}

async function signOutAccount() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

async function deleteAccountAndData() {
  if (supabase) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user) {
      const { error } = await supabase.rpc('delete_own_account');
      if (error) return error.message;
      await supabase.auth.signOut();
    }
  }
  localStorage.removeItem('subtra_state');
  localStorage.removeItem('subtra_stats');
  localStorage.removeItem('subtra_theme');
  localStorage.removeItem('subtra_draft_guess');
  return null;
}

async function fetchServerPuzzle() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_subtra_puzzle');
  if (error || !data) return null;
  return data;
}

async function submitServerGuess(cmyk) {
  if (!supabase) return { state: null, error: 'Database not connected.' };
  await ensureAuthenticatedUser();
  const { data, error } = await supabase.rpc('submit_subtra_guess', {
    p_c: cmyk.c,
    p_m: cmyk.m,
    p_y: cmyk.y,
    p_k: cmyk.k,
  });
  if (error) {
    return { state: null, error: error.message };
  }
  return { state: data, error: null };
}

const THEME_KEY = 'subtra_theme';
const DRAFT_KEY = 'subtra_draft_guess';

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function loadDraftGuess() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return { c: 30, m: 30, y: 30, k: 0 };
}

let currentGuess = loadDraftGuess();
let puzzleNumber = 1;
let targetRgb = 'rgb(200, 196, 188)';
let targetCmyk = null;
let targetName = null;
let guesses = [];
let gameOver = false;
let won = false;
let stats = { played: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
let submitting = false;
let darkMode = loadTheme();
let burgerOpen = false;
let confirmDeleteArmed = false;

function saveDraftGuess() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(currentGuess));
}

const puzzleNumberBadge = document.getElementById('puzzle-number-badge');
const targetSwatchBox = document.getElementById('target-swatch-box');
const targetTitleLabel = document.getElementById('target-title-label');
const targetSpecLabel = document.getElementById('target-spec-label');
const tryCounterLabel = document.getElementById('try-counter-label');
const guessForm = document.getElementById('guess-form');
const submitBtn = document.getElementById('btn-submit-guess');
const gameoverBanner = document.getElementById('gameover-banner');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverSubtitle = document.getElementById('gameover-subtitle');
const resetDemoBtn = document.getElementById('btn-reset-demo');
const guessSlotsContainer = document.getElementById('guess-slots-container');
const shareTextPreview = document.getElementById('share-text-preview');
const utcCountdown = document.getElementById('utc-countdown');
const accountStatusBox = document.getElementById('account-status-box');
const accountFeedback = document.getElementById('account-feedback');
const guestAuthWrapper = document.getElementById('guest-auth-wrapper');
const toggleLoginBtn = document.getElementById('btn-toggle-login');
const loginDrawer = document.getElementById('login-drawer');
const emailAuthForm = document.getElementById('email-auth-form');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const googleBtnContainer = document.getElementById('google-btn-container');
const signOutBtn = document.getElementById('btn-sign-out');
const deleteAccountBtn = document.getElementById('btn-delete-account');
const burgerBtn = document.getElementById('btn-burger');
const burgerMenu = document.getElementById('burger-menu');
const themeLabel = document.getElementById('theme-label');
const themeDesktopLabel = document.getElementById('theme-desktop-label');

resetDemoBtn.classList.add('hidden');

const inputs = {
  c: document.getElementById('input-c'),
  m: document.getElementById('input-m'),
  y: document.getElementById('input-y'),
  k: document.getElementById('input-k'),
};

['c', 'm', 'y', 'k'].forEach((ch) => {
  inputs[ch].value = String(currentGuess[ch]);
});

function applyServerState(state) {
  puzzleNumber = state.puzzleNumber;
  targetRgb = state.targetRgb;
  guesses = state.guesses ?? [];
  gameOver = state.gameOver;
  won = state.won;
  targetCmyk = state.targetCmyk;
  targetName = state.targetName;
  stats = state.stats ?? { played: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
  render();
}

async function syncFromServer() {
  const state = await fetchServerPuzzle();
  if (state) {
    applyServerState(state);
  }
}

function setBurgerOpen(next) {
  burgerOpen = next;
  burgerBtn.classList.toggle('is-open', burgerOpen);
  burgerBtn.setAttribute('aria-expanded', String(burgerOpen));
  burgerMenu.classList.toggle('is-open', burgerOpen);
}

function applyTheme() {
  document.documentElement.classList.toggle('dark', darkMode);
  localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light');
  themeLabel.textContent = darkMode ? 'Light Mode' : 'Dark Mode';
  themeDesktopLabel.textContent = darkMode ? 'Light' : 'Dark';
}

function renderHintCell(label, hint, value) {
  if (hint === 'perfect') {
    return `<div class="py-2 px-1.5 md:px-2.5 flex items-center justify-between bg-ink text-paper font-mono-spec text-xs font-bold">
      <span class="opacity-65 text-[10px]">${label}</span>
      <span>${value}</span>
      <span class="text-[10px]">✓</span>
    </div>`;
  }
  if (hint === 'close') {
    return `<div class="py-2 px-1.5 md:px-2.5 flex items-center justify-between bg-ink/15 text-ink font-mono-spec text-xs font-bold">
      <span class="text-muted text-[10px]">${label}</span>
      <span>${value}</span>
      <span class="text-[11px] font-bold">~</span>
    </div>`;
  }
  return `<div class="py-2 px-1.5 md:px-2.5 flex items-center justify-between font-mono-spec text-xs text-muted">
    <span class="text-[10px] opacity-75">${label}</span>
    <span>${value}</span>
    <span class="text-[10px] opacity-60">—</span>
  </div>`;
}

function buildShareText() {
  const score = gameOver ? (won ? `${guesses.length}/5` : 'X/5') : `${guesses.length}/5`;
  const grid =
    guesses.length > 0
      ? guesses
          .map((r) =>
            ['c', 'm', 'y', 'k']
              .map((ch) =>
                r.hints[ch] === 'perfect'
                  ? '🟩'
                  : r.hints[ch] === 'close'
                  ? '🟨'
                  : '⬜'
              )
              .join('')
          )
          .join('\n')
      : '🟩🟨⬜🟩';
  return `Subtra #${puzzleNumber} ${score}\n${grid}`;
}

function render() {
  const numStr = String(puzzleNumber).padStart(3, '0');
  puzzleNumberBadge.textContent = `#${numStr}`;
  targetSwatchBox.style.backgroundColor = targetRgb;

  targetTitleLabel.textContent = gameOver && targetName ? targetName : `SWATCH ${numStr}`;
  targetSpecLabel.textContent =
    gameOver && targetCmyk
      ? `C${targetCmyk.c}  M${targetCmyk.m}  Y${targetCmyk.y}  K${targetCmyk.k}`
      : 'C —  M —  Y —  K —';

  tryCounterLabel.textContent = `${guesses.length} / 5`;

  guessForm.classList.toggle('hidden', gameOver);
  gameoverBanner.classList.toggle('hidden', !gameOver);
  gameoverBanner.classList.toggle('flex', gameOver);

  if (gameOver) {
    gameoverTitle.textContent = won ? 'SOLVED' : 'GAME OVER';
    gameoverSubtitle.textContent =
      targetName && targetCmyk
        ? `${targetName} • C${targetCmyk.c} M${targetCmyk.m} Y${targetCmyk.y} K${targetCmyk.k}`
        : '';
  }

  const rowsHtml = [];

  for (let slot = 1; slot <= 5; slot++) {
    const row = guesses[slot - 1];
    if (row) {
      const swatch = cmykToRgb(row.cmyk);
      rowsHtml.push(`<div>
        <div class="w-full h-7 md:h-8 flex items-center justify-between px-2.5" style="background-color: ${swatch.css}">
          <span class="font-mono-spec text-[10px] font-bold px-1 bg-white/90 text-black">0${row.guessNumber}</span>
        </div>
        <div class="grid grid-cols-4 divide-x divide-ink border-t border-ink">
          ${renderHintCell('C', row.hints.c, row.cmyk.c)}
          ${renderHintCell('M', row.hints.m, row.cmyk.m)}
          ${renderHintCell('Y', row.hints.y, row.cmyk.y)}
          ${renderHintCell('K', row.hints.k, row.cmyk.k)}
        </div>
      </div>`);
    } else {
      rowsHtml.push(`<div class="grid grid-cols-4 divide-x divide-ink/15 h-11 md:h-12 text-muted font-mono-spec text-[11px]">
        <div class="px-2.5 flex items-center">0${slot}</div>
        <div></div>
        <div></div>
        <div></div>
      </div>`);
    }
  }

  guessSlotsContainer.innerHTML = rowsHtml.join('');
  shareTextPreview.textContent = buildShareText();

  const winPct = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0;
  document.getElementById('stat-played').textContent = String(stats.played);
  document.getElementById('stat-winrate').textContent = `${winPct}%`;
  document.getElementById('stat-streak').textContent = String(stats.currentStreak);
  document.getElementById('stat-best').textContent = String(stats.bestStreak);
}

function resetDeleteConfirmation() {
  confirmDeleteArmed = false;
  deleteAccountBtn.textContent = 'Delete Account & Data';
}

function openModal(id) {
  setBurgerOpen(false);
  resetDeleteConfirmation();
  loginDrawer.classList.remove('is-open');
  accountFeedback.classList.add('hidden');
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('flex');
}

burgerBtn.addEventListener('click', () => {
  setBurgerOpen(!burgerOpen);
});

['c', 'm', 'y', 'k'].forEach((ch) => {
  inputs[ch].addEventListener('input', () => {
    const parsed = parseInt(inputs[ch].value, 10);
    if (!Number.isNaN(parsed)) {
      currentGuess[ch] = Math.min(100, Math.max(0, parsed));
    }
  });
  inputs[ch].addEventListener('blur', () => {
    const parsed = parseInt(inputs[ch].value, 10);
    currentGuess[ch] = Number.isNaN(parsed) ? 0 : clampChannel(parsed);
    inputs[ch].value = String(currentGuess[ch]);
    saveDraftGuess();
  });
});

document.querySelectorAll('[data-channel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const ch = btn.dataset.channel;
    const delta = parseInt(btn.dataset.delta || '0', 10);
    currentGuess[ch] = clampChannel(currentGuess[ch] + delta);
    inputs[ch].value = String(currentGuess[ch]);
    saveDraftGuess();
  });
});

guessForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (gameOver || submitting) return;

  ['c', 'm', 'y', 'k'].forEach((ch) => {
    const parsed = parseInt(inputs[ch].value, 10);
    currentGuess[ch] = Number.isNaN(parsed) ? 0 : clampChannel(parsed);
    inputs[ch].value = String(currentGuess[ch]);
  });
  saveDraftGuess();

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'CHECKING...';

  const { state, error } = await submitServerGuess(currentGuess);

  submitting = false;
  submitBtn.disabled = false;

  if (error || !state) {
    submitBtn.textContent = 'CONNECTION ERROR — RETRY';
    setTimeout(() => {
      if (!submitting) submitBtn.textContent = 'GUESS';
    }, 2000);
    return;
  }

  submitBtn.textContent = 'GUESS';
  applyServerState(state);

  if (state.gameOver) {
    setTimeout(() => openModal('modal-results'), 350);
  }
});

document.querySelectorAll('[data-toggle-theme]').forEach((btn) => {
  btn.addEventListener('click', () => {
    darkMode = !darkMode;
    applyTheme();
  });
});

document.querySelectorAll('[data-open-modal]').forEach((btn) => {
  btn.addEventListener('click', () => openModal(btn.dataset.openModal));
});

document.getElementById('btn-gameover-results').addEventListener('click', () => openModal('modal-results'));

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});

document.querySelectorAll('[role="dialog"]').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal.id);
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('[role="dialog"]').forEach((modal) => {
      if (!modal.classList.contains('hidden')) {
        closeModal(modal.id);
      }
    });
    if (burgerOpen) {
      setBurgerOpen(false);
    }
  }
});

document.getElementById('btn-copy-share').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  await navigator.clipboard.writeText(buildShareText());
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = 'Copy';
  }, 2000);
});

toggleLoginBtn.addEventListener('click', () => {
  const opening = !loginDrawer.classList.contains('is-open');
  loginDrawer.classList.toggle('is-open');
  if (opening) {
    initGoogleDirectButton(
      googleBtnContainer,
      (err) => {
        accountFeedback.textContent = err;
        accountFeedback.classList.remove('hidden');
      },
      async () => {
        accountFeedback.textContent = 'Signed in with Google.';
        accountFeedback.classList.remove('hidden');
        await syncFromServer();
      }
    );
  }
});

emailAuthForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  accountFeedback.classList.add('hidden');
  const { error, message } = await signInOrRegisterWithEmail(
    authEmailInput.value,
    authPasswordInput.value
  );
  if (error) {
    accountFeedback.textContent = error;
    accountFeedback.classList.remove('hidden');
    return;
  }
  authPasswordInput.value = '';
  accountFeedback.textContent = message;
  accountFeedback.classList.remove('hidden');
  await syncFromServer();
});

signOutBtn.addEventListener('click', async () => {
  await signOutAccount();
  guesses = [];
  gameOver = false;
  won = false;
  targetCmyk = null;
  targetName = null;
  stats = { played: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
  accountFeedback.textContent = 'Signed out.';
  accountFeedback.classList.remove('hidden');
  await syncFromServer();
});

deleteAccountBtn.addEventListener('click', async () => {
  if (!confirmDeleteArmed) {
    confirmDeleteArmed = true;
    deleteAccountBtn.textContent = 'Tap again to permanently erase all data';
    return;
  }
  const err = await deleteAccountAndData();
  if (err) {
    accountFeedback.textContent = err;
    accountFeedback.classList.remove('hidden');
    resetDeleteConfirmation();
    return;
  }
  guesses = [];
  currentGuess = { c: 30, m: 30, y: 30, k: 0 };
  gameOver = false;
  won = false;
  targetCmyk = null;
  targetName = null;
  stats = { played: 0, wins: 0, currentStreak: 0, bestStreak: 0 };
  ['c', 'm', 'y', 'k'].forEach((ch) => {
    inputs[ch].value = String(currentGuess[ch]);
  });
  resetDeleteConfirmation();
  await syncFromServer();
  accountFeedback.textContent = 'All account and local data erased.';
  accountFeedback.classList.remove('hidden');
});

initAuth(async (user, isInitial) => {
  const isPermanent = Boolean(user && !user.is_anonymous);
  const label = formatAccountLabel(user);

  guestAuthWrapper.classList.toggle('hidden', isPermanent);
  signOutBtn.classList.toggle('hidden', !isPermanent);

  const titleEl = document.createElement('p');
  titleEl.className = 'font-mono-spec font-bold break-all';
  titleEl.textContent = label;

  const descEl = document.createElement('p');
  descEl.className = 'text-muted';
  descEl.textContent = isPermanent
    ? 'This account works across both Subtra and Idiomatic.'
    : 'Sign in with email or Google to sync your streak across devices and games.';

  accountStatusBox.replaceChildren(titleEl, descEl);

  if (!isInitial) {
    await syncFromServer();
  }
});

let currentUtcDay = new Date().toISOString().slice(0, 10);

setInterval(() => {
  utcCountdown.textContent = getNextUtcMidnightCountdown();
  const nowUtcDay = new Date().toISOString().slice(0, 10);
  if (nowUtcDay !== currentUtcDay) {
    currentUtcDay = nowUtcDay;
    syncFromServer();
  }
}, 1000);
utcCountdown.textContent = getNextUtcMidnightCountdown();

applyTheme();
render();
syncFromServer();

if (!localStorage.getItem('subtra_seen_rules')) {
  localStorage.setItem('subtra_seen_rules', '1');
  openModal('modal-how-to-play');
}
