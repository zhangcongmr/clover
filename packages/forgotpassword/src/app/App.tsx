import { useState } from 'react';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';

const App = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setMessage('If your email exists, you’ll receive a reset link shortly.');
      } else {
        const data = await response.json();
        setMessage(data.message || 'Failed to send reset email.');
      }
    } catch (err) {
      setMessage('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '2rem auto' }}>
      <h2>Forgot Password?</h2>
      <p>Enter your email and we’ll send you a link to reset your password.</p>

      {message && <p style={{ color: message.includes('exists') ? 'green' : 'red' }}>{message}</p>}

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <Input
            type="email"
            value={email}
            placeholder="Your email"
            required
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-1.5 border border-[#d0d7de] rounded-md bg-white text-[#24292f] focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
          />
        </div>
        <Button
          type="submit"
          className="w-full bg-[#1a7f37] hover:bg-[#1a7f37]/90 text-white py-1.5 rounded-md border border-[#1f883d]/40"
          disabled={loading}
        >
          {loading ? 'Sending...' : 'Send Reset Link'}
        </Button>
      </form>
    </div>
  );
};

export default App;