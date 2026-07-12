// Auth client — token storage, login/logout, user fetching.
// Works alongside hermesClient; no additional dependencies.

const BASE = (import.meta.env.VITE_HERMES_URL as string | undefined)?.replace(/\/$/, "");
const STORAGE_KEY = "hermes_token";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: string[];
}

// ── Token (localStorage) ────────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(t: string): void {
  localStorage.setItem(STORAGE_KEY, t);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Login / Logout ──────────────────────────────────────────────────────────

export async function login(
  username: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  if (!BASE) throw new Error("Server URL not configured");
  const res = await fetch(`${BASE}/api/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Login failed" }));
    throw new Error(err.error || `Login failed (${res.status})`);
  }
  const data = await res.json();
  setToken(data.token);
  return data;
}

export function logout(): void {
  clearToken();
}

// Fetch the current user from the server using the stored token.
// Returns null if the token is missing, expired, or the server rejects it.
export async function getMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token || !BASE) return null;
  const res = await fetch(`${BASE}/api/account/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearToken();
    return null;
  }
  return (await res.json()).user;
}

// ── Demo user (no backend) ──────────────────────────────────────────────────

export const DEMO_USER: AuthUser = {
  id: "demo",
  username: "maya",
  email: "maya@northline.co",
  displayName: "Maya",
  roles: ["Admin"],
};
