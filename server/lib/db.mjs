// Local SQLite persistence for the live stream + auth (built-in node:sqlite — no deps).
//
// The cockpit's Live Feed / Workers read the in-memory stream, which used to
// reset on every restart. We now mirror each stream item (and its held draft)
// into a small SQLite file so the session survives restarts and the feed is
// there when you reopen the app.

import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.mjs";

let db = null;

export function initDb(path) {
  db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS stream_items (
       id TEXT PRIMARY KEY,
       item TEXT NOT NULL,
       draft TEXT,
       created_at INTEGER NOT NULL
     )`
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS roles (
       id TEXT PRIMARY KEY,
       name TEXT UNIQUE NOT NULL
     )`
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS users (
       id TEXT PRIMARY KEY,
       username TEXT UNIQUE NOT NULL,
       email TEXT UNIQUE NOT NULL,
       password_hash TEXT NOT NULL,
       display_name TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS user_roles (
       user_id TEXT NOT NULL REFERENCES users(id),
       role_id TEXT NOT NULL REFERENCES roles(id),
       PRIMARY KEY (user_id, role_id)
     )`
  );
  seedAuthTables(db);
}

// ── Auth: seed ──────────────────────────────────────────────────────────────

const ROLES = ["Admin", "Operator", "Viewer"];

export function seedAuthTables(d) {
  const r = d || db;
  for (const name of ROLES) {
    r.prepare(
      `INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)`
    ).run(name.toLowerCase(), name);
  }
  // Default admin user: admin / Admin123!
  const existing = r.prepare(`SELECT id FROM users WHERE username = ?`).get("admin");
  if (!existing) {
    const now = Date.now();
    r.prepare(
      `INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "admin", "admin", "admin@hermes.local",
      hashPassword("Admin123!"), "Admin", now, now,
    );
    r.prepare(
      `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`
    ).run("admin", "admin");
  }
}

// ── Auth: user queries ──────────────────────────────────────────────────────

export function findUserByUsername(username) {
  if (!db) return null;
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) || null;
}

export function findUserById(id) {
  if (!db) return null;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!user) return null;
  user.roles = getUserRoles(id);
  return user;
}

export function listAllUsers() {
  if (!db) return [];
  const users = db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all();
  return users.map((u) => {
    const roles = db.prepare(
      `SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?`
    ).all(u.id).map((r) => r.name);
    return { ...u, roles };
  });
}

export function createUser({ username, email, password, displayName, roles }) {
  if (!db) throw new Error("db not initialized");
  const id = username.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Date.now();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, username, email, hashPassword(password), displayName || username, now, now);
  for (const role of roles || ["Viewer"]) {
    db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`).run(id, role.toLowerCase());
  }
  return findUserById(id);
}

export function updateUser(id, { username, email, password, displayName, roles }) {
  if (!db) return null;
  const sets = [];
  const vals = [];
  if (username !== undefined) { sets.push("username = ?"); vals.push(username); }
  if (email !== undefined) { sets.push("email = ?"); vals.push(email); }
  if (displayName !== undefined) { sets.push("display_name = ?"); vals.push(displayName); }
  if (password) { sets.push("password_hash = ?"); vals.push(hashPassword(password)); }
  sets.push("updated_at = ?"); vals.push(Date.now());
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  if (roles) {
    db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(id);
    for (const role of roles) {
      db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`).run(id, role.toLowerCase());
    }
  }
  return findUserById(id);
}

export function deleteUser(id) {
  if (!db) return;
  db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(id);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

export function getUserRoles(userId) {
  if (!db) return [];
  return db.prepare(
    `SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?`
  ).all(userId).map((r) => r.name);
}

// ── Stream items ────────────────────────────────────────────────────────────

// Insert or update one stream item + its draft.
export function saveItem(item, draft) {
  if (!db) return;
  db.prepare(
    `INSERT INTO stream_items (id, item, draft, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET item = excluded.item, draft = excluded.draft`
  ).run(item.id, JSON.stringify(item), draft ? JSON.stringify(draft) : null, Date.now());
}

// Load persisted items, newest first, for hydrating the in-memory stream on boot.
export function loadItems(limit = 100) {
  if (!db) return [];
  const rows = db.prepare(`SELECT item, draft FROM stream_items ORDER BY created_at DESC LIMIT ?`).all(limit);
  return rows.map((r) => ({ item: JSON.parse(r.item), draft: r.draft ? JSON.parse(r.draft) : null }));
}
