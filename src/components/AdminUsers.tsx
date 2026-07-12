import { useState, useEffect, type FormEvent } from "react";
import { getToken } from "../lib/authClient";
import type { AuthUser } from "../lib/authClient";

const BASE = (import.meta.env.VITE_HERMES_URL as string | undefined)?.replace(/\/$/, "");

interface UserRow {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: number;
}

interface UserForm {
  username: string;
  email: string;
  displayName: string;
  password: string;
  roles: string[];
}

const ALL_ROLES = ["Admin", "Operator", "Viewer"];

export function AdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>({
    username: "",
    email: "",
    displayName: "",
    password: "",
    roles: ["Operator"],
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  async function fetchUsers() {
    if (!BASE) return;
    setLoading(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch(`${BASE}/api/account/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to load" }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      setUsers(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  function openNew() {
    setEditingId(null);
    setForm({ username: "", email: "", displayName: "", password: "", roles: ["Operator"] });
    setShowForm(true);
  }

  function openEdit(u: UserRow) {
    setEditingId(u.id);
    setForm({
      username: u.username,
      email: u.email,
      displayName: u.displayName,
      password: "",
      roles: u.roles,
    });
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!BASE) return;
    setSaving(true);
    setError("");
    try {
      const token = getToken();
      const body: Record<string, unknown> = {
        username: form.username,
        email: form.email,
        displayName: form.displayName || form.username,
        roles: form.roles,
      };
      if (form.password) body.password = form.password;

      const url = editingId
        ? `${BASE}/api/account/users/${editingId}`
        : `${BASE}/api/account/users`;
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      setShowForm(false);
      setEditingId(null);
      await fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!BASE) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${BASE}/api/account/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      setDeleteConfirm(null);
      await fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleRole(r: string) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(r)
        ? prev.roles.filter((x) => x !== r)
        : [...prev.roles, r],
    }));
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>User Management</h2>
        <p>Manage users and their roles. Changes take effect immediately.</p>
      </div>

      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ marginBottom: 12 }}>
        <button className="btn-white" onClick={openNew} disabled={showForm}>
          + Add User
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="user-form-card">
          <h3>{editingId ? "Edit User" : "New User"}</h3>
          <div className="user-form-grid">
            <div className="user-form-row">
              <label className="field">
                <span>Username</span>
                <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
              </label>
              <label className="field">
                <span>Display Name</span>
                <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
              </label>
            </div>
            <div className="user-form-row">
              <label className="field">
                <span>Email</span>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
              </label>
              <label className="field">
                <span>Password {editingId && <span className="muted">(blank = keep)</span>}</span>
                <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required={!editingId} />
              </label>
            </div>
          </div>
          <div>
            <span className="field-hint" style={{ marginBottom: 4 }}>Roles</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ALL_ROLES.map((r) => (
                <button key={r} type="button" className={`user-role-tag ${form.roles.includes(r) ? "on" : ""}`} onClick={() => toggleRole(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="user-form-actions">
            <button className="login-btn" type="submit" disabled={saving} style={{ width: "auto", padding: "7px 18px", fontSize: 12 }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-white" onClick={() => { setShowForm(false); setEditingId(null); }} style={{ fontSize: 12 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="muted" style={{ padding: 12 }}>Loading users…</div>
      ) : (
        <div className="user-table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.displayName}</b><br /><span className="muted">@{u.username}</span></td>
                  <td>{u.email}</td>
                  <td>{u.roles.join(", ")}</td>
                  <td className="mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="icon-btn" onClick={() => openEdit(u)} title="Edit user">✎</button>
                    <button className="icon-btn" onClick={() => setDeleteConfirm(u.id)} title="Delete user" style={{ color: "var(--no)" }} disabled={u.username === "admin"}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteConfirm && (
        <div className="side-overlay" onClick={() => setDeleteConfirm(null)}>
          <div
            className="confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <p>Delete this user? This cannot be undone.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-white" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="login-btn" onClick={() => handleDelete(deleteConfirm)} style={{ width: "auto", padding: "8px 20px", background: "var(--no)", color: "#fff" }}>
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
