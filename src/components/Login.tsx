import { useState } from "react";
import { LogIn } from "lucide-react";
import { login } from "../client/api";
import { auth } from "../client/auth";

type Props = {
  onSuccess: () => void;
};

export function Login({ onSuccess }: Props) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(secret);
      if (!auth.token) throw new Error("No token returned");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel auth-panel">
      <h2>Sign in</h2>
      <p className="muted">Enter the admin secret to access the S3 console.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="Admin secret"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          required
        />
        <button type="submit" disabled={!secret.trim() || loading}>
          <LogIn size={16} /> {loading ? "Signing in..." : "Login"}
        </button>
      </form>
      {error && <p className="pill danger">{error}</p>}
    </div>
  );
}
