import {
  type CMYK,
  type ChannelHint,
  type GuessRow,
  cmykToRgb,
  clampChannel,
  getNextUtcMidnightCountdown,
} from './cmyk';
import {
  type ServerPuzzleState,
  initAuth,
  signInOrRegisterWithEmail,
  linkGoogleAccount,
  signOutAccount,
  deleteAccountAndData,
  formatAccountLabel,
  fetchServerPuzzle,
  submitServerGuess,
} from './supabase';

const THEME_KEY = 'subtra_theme';
const DRAFT_KEY = 'subtra_draft_guess';

function loadTheme(): boolean {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function loadDraftGuess(): CMYK {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      return JSON.parse(raw) as CMYK;
    }
  } catch {}
  return { c: 30, m: 30, y: 30, k: 0 };
}

let currentGuess: CMYK = loadDraftGuess();
let puzzleNumber = 1;
let targetRgb = 'rgb(200, 196, 188)';
let targetCmyk: CMYK | null = null;
let targetName: string | null = null;
let guesses: GuessRow[] = [];
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

const puzzleNumberBadge = document.getElementById('puzzle-number-badge')!;
const targetSwatchBox = document.getElementById('target-swatch-box')!;
const targetTitleLabel = document.getElementById('target-title-label')!;
const targetSpecLabel = document.getElementById('target-spec-label')!;
const tryCounterLabel = document.getElementById('try-counter-label')!;
const guessForm = document.getElementById('guess-form') as HTMLFormElement;
const submitBtn = document.getElementById('btn-submit-guess') as HTMLButtonElement;
const gameoverBanner = document.getElementById('gameover-banner')!;
const gameoverTitle = document.getElementById('gameover-title')!;
const gameoverSubtitle = document.getElementById('gameover-subtitle')!;
const resetDemoBtn = document.getElementById('btn-reset-demo')!;
const guessSlotsContainer = document.getElementById('guess-slots-container')!;
const shareTextPreview = document.getElementById('share-text-preview')!;
const utcCountdown = document.getElementById('utc-countdown')!;
const accountStatusBox = document.getElementById('account-status-box')!;
const accountFeedback = document.getElementById('account-feedback')!;
const emailAuthForm = document.getElementById('email-auth-form') as HTMLFormElement;
const authEmailInput = document.getElementById('auth-email') as HTMLInputElement;
const authPasswordInput = document.getElementById('auth-password') as HTMLInputElement;
const googleBtn = document.getElementById('btn-link-google')!;
const signOutBtn = document.getElementById('btn-sign-out')!;
const deleteAccountBtn = document.getElementById('btn-delete-account')!;
const burgerBtn = document.getElementById('btn-burger')!;
const burgerMenu = document.getElementById('burger-menu')!;
const themeLabel = document.getElementById('theme-label')!;
const themeDesktopLabel = document.getElementById('theme-desktop-label')!;

resetDemoBtn.classList.add('hidden');

const inputs: Record<keyof CMYK, HTMLInputElement> = {
  c: document.getElementById('input-c') as HTMLInputElement,
  m: document.getElementById('input-m') as HTMLInputElement,
  y: document.getElementById('input-y') as HTMLInputElement,
  k: document.getElementById('input-k') as HTMLInputElement,
};

(['c', 'm', 'y', 'k'] as const).forEach((ch) => {
  inputs[ch].value = String(currentGuess[ch]);
});

function applyServerState(state: ServerPuzzleState) {
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

function setBurgerOpen(next: boolean) {
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

function renderHintCell(label: string, hint: ChannelHint, value: number): string {
  if (hint === 'perfect') {
    return `<div class="py-2 px-1.5 md:px-2.5 flex items-center justify-between bg-ink text-paper font-mono-spec text-xs font-bold">
      <span class="opacity-65 text-[10px]">${label}</span>
      <span>${value}</span>
      <span class="text-[10px]">✓</span>
    </div>`;
  }
  const arrow = hint === 'higher' ? '▲' : '▼';
  return `<div class="py-2 px-1.5 md:px-2.5 flex items-center justify-between font-mono-spec text-xs">
    <span class="text-muted text-[10px]">${label}</span>
    <span class="font-bold">${value}</span>
    <span class="text-[10px] font-bold">${arrow}</span>
  </div>`;
}

function buildShareText(): string {
  const score = gameOver ? (won ? `${guesses.length}/5` : 'X/5') : `${guesses.length}/5`;
  const grid =
    guesses.length > 0
      ? guesses
          .map((r) =>
            (['c', 'm', 'y', 'k'] as const)
              .map((ch) =>
                r.hints[ch] === 'perfect'
                  ? '🟩'
                  : r.hints[ch] === 'higher'
                  ? '🔼'
                  : '🔽'
              )
              .join('')
          )
          .join('\n')
      : '🟩🔼🔽🟩';
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

  const rowsHtml: string[] = [];

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
      rowsHtml.push(`<div class="grid grid-cols-4 divide-x divide-ink/15 h-11 md:h-12 text-muted/45 font-mono-spec text-[11px]">
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
  document.getElementById('stat-played')!.textContent = String(stats.played);
  document.getElementById('stat-winrate')!.textContent = `${winPct}%`;
  document.getElementById('stat-streak')!.textContent = String(stats.currentStreak);
  document.getElementById('stat-best')!.textContent = String(stats.bestStreak);
}

function resetDeleteConfirmation() {
  confirmDeleteArmed = false;
  deleteAccountBtn.textContent = 'Delete Account & Data';
}

function openModal(id: string) {
  setBurgerOpen(false);
  resetDeleteConfirmation();
  accountFeedback.classList.add('hidden');
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('flex');
}

function closeModal(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('flex');
}

burgerBtn.addEventListener('click', () => {
  setBurgerOpen(!burgerOpen);
});

(['c', 'm', 'y', 'k'] as const).forEach((ch) => {
  inputs[ch].addEventListener('input', () => {
    const parsed = parseInt(inputs[ch].value, 10);
    currentGuess[ch] = Number.isNaN(parsed) ? 0 : clampChannel(parsed);
    saveDraftGuess();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-channel]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const ch = btn.dataset.channel as keyof CMYK;
    const delta = parseInt(btn.dataset.delta || '0', 10);
    currentGuess[ch] = clampChannel(currentGuess[ch] + delta);
    inputs[ch].value = String(currentGuess[ch]);
    saveDraftGuess();
  });
});

guessForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (gameOver || submitting) return;

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'CHECKING...';

  const { state, error } = await submitServerGuess(currentGuess);

  submitting = false;
  submitBtn.disabled = false;
  submitBtn.textContent = 'GUESS';

  if (error || !state) {
    return;
  }

  applyServerState(state);

  if (state.gameOver) {
    setTimeout(() => openModal('modal-results'), 350);
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-toggle-theme]').forEach((btn) => {
  btn.addEventListener('click', () => {
    darkMode = !darkMode;
    applyTheme();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-open-modal]').forEach((btn) => {
  btn.addEventListener('click', () => openModal(btn.dataset.openModal!));
});

document.getElementById('btn-gameover-results')!.addEventListener('click', () => openModal('modal-results'));

document.querySelectorAll<HTMLButtonElement>('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal!));
});

document.getElementById('btn-copy-share')!.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  await navigator.clipboard.writeText(buildShareText());
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = 'Copy';
  }, 2000);
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

googleBtn.addEventListener('click', async () => {
  const err = await linkGoogleAccount();
  if (err) {
    accountFeedback.textContent = err;
    accountFeedback.classList.remove('hidden');
  }
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
  (['c', 'm', 'y', 'k'] as const).forEach((ch) => {
    inputs[ch].value = String(currentGuess[ch]);
  });
  resetDeleteConfirmation();
  await syncFromServer();
  accountFeedback.textContent = 'All account and local data erased.';
  accountFeedback.classList.remove('hidden');
});

initAuth(async (user) => {
  const isPermanent = Boolean(user && !user.is_anonymous);
  const label = formatAccountLabel(user);

  emailAuthForm.classList.toggle('hidden', isPermanent);
  googleBtn.classList.toggle('hidden', isPermanent);
  signOutBtn.classList.toggle('hidden', !isPermanent);

  accountStatusBox.innerHTML = `<p class="font-mono-spec font-bold">${label}</p><p class="text-muted">${
    isPermanent
      ? 'This account works across both Subtra and Idiomatic.'
      : 'Sign in with email or Google to sync your streak across devices and games.'
  }</p>`;

  await syncFromServer();
});

setInterval(() => {
  utcCountdown.textContent = getNextUtcMidnightCountdown();
}, 1000);
utcCountdown.textContent = getNextUtcMidnightCountdown();

applyTheme();
render();
syncFromServer();
