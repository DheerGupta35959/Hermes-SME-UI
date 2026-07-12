// Auth helpers — JWT + bcrypt wrappers for Hermes-SME.
// Matches the existing server style: pure functions, no classes, no DI.

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "hermes-dev-secret-change-me";
const JWT_EXPIRES_IN = "15m";

// ── Password ────────────────────────────────────────────────────────────────

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// ── Token ───────────────────────────────────────────────────────────────────

// signToken :: { id, username, email, roles } → JWT string
export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

// verifyToken :: string → payload | null
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ── Route helpers ───────────────────────────────────────────────────────────

export function isPublicPath(pathname) {
  return pathname === "/api/account/login" || pathname === "/api/account/register";
}
