import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';

const App = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const navigate = useNavigate();
  const [token, setToken] = useState(null);
  const [isValidating, setIsValidating] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");

    if (!token) {
      setIsValidating(false);
      setIsTokenValid(false);
      return;
    }

    // ✅ 关键：调用后端验证 token
    fetch(`/api/auth/password-reset/validate?token=${encodeURIComponent(token)}`)
      .then(res => {
        if (res.ok) {
          setIsTokenValid(true);
          setToken(token);
        } else {
          setIsTokenValid(false);
          setError("Invalid or expired reset link.");
        }
      })
      .catch(() => {
        setIsTokenValid(false);
        setError("Failed to validate link.");
      })
      .finally(() => setIsValidating(false));
  }, []);

  if (isValidating) return <div>Loading...</div>;

  if (!isTokenValid) {
    return <div style={{ textAlign: 'center', marginTop: '2rem' }}>{error || "Invalid reset link."}</div>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      if (response.ok) {
        alert('Password reset successful! You can now log in.');
        window.location.href = '/signin';
      } else {
        const data = await response.json();
        setMessage(data.message || 'Failed to reset password.');
      }
    } catch (err) {
      setMessage('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '2rem auto' }}>
      <h2>Reset Password</h2>
      {message && <p style={{ color: 'red' }}>{message}</p>}
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <Input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-1.5 border border-[#d0d7de] rounded-md bg-white text-[#24292f] focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
          />
        </div>
        <div className="mb-4">
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-1.5 border border-[#d0d7de] rounded-md bg-white text-[#24292f] focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
          />
        </div>
        <Button
          type="submit"
          className="w-full bg-[#1a7f37] hover:bg-[#1a7f37]/90 text-white py-1.5 rounded-md border border-[#1f883d]/40"
          disabled={loading}
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </Button>
      </form>
    </div>
  );
};

export default App;