import { User } from '../types';

const KEY = 'gdp_session';
const SESSION_KEY = 'gdp_session_tab';

export interface Session {
  token: string;
  user: User;
}

export function saveSession(session: Session, remember = false) {
  try {
    if (remember) localStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.user && parsed.user.id) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}