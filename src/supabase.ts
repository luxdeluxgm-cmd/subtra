import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { CMYK, GuessRow } from './cmyk';

export interface ServerPuzzleState {
  puzzleNumber: number;
  targetRgb: string;
  guesses: GuessRow[];
  gameOver: boolean;
  won: boolean;
  targetCmyk: CMYK | null;
  targetName: string | null;
  stats: {
    played: number;
    wins: number;
    currentStreak: number;
    bestStreak: number;
  };
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_KEY) as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http') &&
    supabaseAnonKey.length > 20
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function formatAccountLabel(user: User | null): string {
  if (!user || user.is_anonymous) return 'GUEST SESSION';
  return user.email ?? 'SIGNED IN';
}

export async function initAuth(onUserChange: (user: User | null) => void): Promise<void> {
  if (!supabase) {
    onUserChange(null);
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  onUserChange(sessionData.session?.user ?? null);

  supabase.auth.onAuthStateChange((_event, session) => {
    onUserChange(session?.user ?? null);
  });
}

export async function ensureAuthenticatedUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) {
    return sessionData.session.user;
  }
  const { data: anonData } = await supabase.auth.signInAnonymously();
  return anonData.user ?? null;
}

export async function signInOrRegisterWithEmail(
  email: string,
  password: string
): Promise<{ error: string | null; message: string }> {
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

  const formatAuthError = (msg: string) => {
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
      return {
        error: null,
        message: 'Account saved.',
      };
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

export async function linkGoogleAccount(): Promise<string | null> {
  if (!supabase) return 'Database is not connected yet.';
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user?.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return error ? error.message : null;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return error ? error.message : null;
}

export async function signOutAccount(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function deleteAccountAndData(): Promise<string | null> {
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
  return null;
}

export async function fetchServerPuzzle(): Promise<ServerPuzzleState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_subtra_puzzle');
  if (error || !data) return null;
  return data as ServerPuzzleState;
}

export async function submitServerGuess(cmyk: CMYK): Promise<{
  state: ServerPuzzleState | null;
  error: string | null;
}> {
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
  return { state: data as ServerPuzzleState, error: null };
}

