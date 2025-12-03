import { useEffect, useState } from "react";
import type { PermissionKey, User } from "../types";

const permissionLabels: Record<PermissionKey, string> = {
  list: "List",
  createFolder: "Create folder",
  upload: "Upload",
  delete: "Delete",
  copyLink: "Copy public link",
  copySignedUrl: "Copy signed URL",
};

type Props = {
  users: User[];
  currentUserId: string;
  editingUserId: string | null;
  onSelectUser: (id: string) => void;
  onAddUser: (name: string) => void;
  onUpdateUser: (id: string, user: Partial<User>) => void;
  onUpdatePermissions: (id: string, permissions: Record<PermissionKey, boolean>) => void;
  onRemoveUser: (id: string) => void;
  onEdit: (id: string) => void;
  onDoneEditing: () => void;
};

export function UserManagement({
  users,
  currentUserId,
  editingUserId,
  onSelectUser,
  onAddUser,
  onUpdateUser,
  onUpdatePermissions,
  onRemoveUser,
  onEdit,
  onDoneEditing,
}: Props) {
  const [newUserName, setNewUserName] = useState("");
  const editingUser = users.find((u) => u.id === editingUserId) || null;
  const [draftPerms, setDraftPerms] = useState<Record<PermissionKey, boolean> | null>(null);

  useEffect(() => {
    if (editingUser) {
      setDraftPerms({ ...editingUser.permissions });
    } else {
      setDraftPerms(null);
    }
  }, [editingUser]);

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Access Control</p>
          <h2>User management</h2>
        </div>
        <div className="add-user">
          <input
            value={newUserName}
            onChange={(event) => setNewUserName(event.target.value)}
            placeholder="New user name"
          />
          <button
            onClick={() => {
              if (!newUserName.trim()) return;
              onAddUser(newUserName.trim());
              setNewUserName("");
            }}
          >
            Add
          </button>
        </div>
      </header>

      <div className="user-table">
        <div className="user-header">
          <span>User</span>
          <span>Active</span>
          <span>Actions</span>
        </div>
        {users.map((user) => (
          <div key={user.id} className="user-row">
            <div className="user-meta">
              <input
                className="user-name-input"
                value={user.name}
                onChange={(event) => onUpdateUser(user.id, { name: event.target.value })}
              />
            </div>
            <div className="user-radio">
              <input
                type="radio"
                name="currentUser"
                checked={user.id === currentUserId}
                onChange={() => onSelectUser(user.id)}
              />
            </div>
            <div className="user-actions">
              <button className="ghost" onClick={() => onEdit(user.id)}>
                Edit
              </button>
              <button
                className="ghost"
                disabled={users.length === 1}
                onClick={() => onRemoveUser(user.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingUser && draftPerms && (
        <div className="permission-editor">
          <div>
            <p className="eyebrow">Editing</p>
            <h3>{editingUser.name}</h3>
          </div>
          <div className="permission-grid">
            {Object.entries(permissionLabels).map(([key, label]) => (
              <label key={key} className="permission-toggle">
                <input
                  type="checkbox"
                  checked={draftPerms[key as PermissionKey]}
                  onChange={(event) =>
                    setDraftPerms({ ...draftPerms, [key]: event.target.checked })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="permission-actions">
            <button
              className="ghost"
              onClick={() => {
                onDoneEditing();
                setDraftPerms(null);
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onUpdatePermissions(editingUser.id, draftPerms);
                onDoneEditing();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
