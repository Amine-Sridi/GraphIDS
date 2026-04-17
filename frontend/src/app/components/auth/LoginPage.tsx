import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ShieldAlert, Eye, EyeOff, Lock, User, AlertCircle, Terminal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('All fields are required.');
      return;
    }
    setIsLoading(true);
    setError('');
    // Simulate network delay
    await new Promise(r => setTimeout(r, 800));
    const result = login(username, password);
    setIsLoading(false);
    if (result.success) {
      navigate('/');
    } else {
      setAttempts(a => a + 1);
      setError(result.error ?? 'Authentication failed.');
      setPassword('');
    }
  };

  return (
    <div style={{
      width: '100%', height: '100vh', background: '#0d1117',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(#58a6ff 1px, transparent 1px), linear-gradient(90deg, #58a6ff 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Glow effects */}
      <div style={{
        position: 'absolute', top: '20%', left: '30%', width: 400, height: 400,
        background: 'radial-gradient(circle, rgba(88,166,255,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '20%', right: '25%', width: 300, height: 300,
        background: 'radial-gradient(circle, rgba(248,81,73,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, padding: '0 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: 16,
            background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.25)',
            marginBottom: 16,
          }}>
            <ShieldAlert size={30} color="#58a6ff" />
          </div>
          <div style={{ color: '#e6edf3', fontSize: 22, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>
            NETGUARD IDS
          </div>
          <div style={{ color: '#7d8590', fontSize: 12, letterSpacing: '0.06em' }}>
            INTRUSION DETECTION SYSTEM — SECURE ACCESS
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#161b22', border: '1px solid #21262d', borderRadius: 12,
          padding: '28px 28px 24px', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24,
            padding: '8px 12px', background: 'rgba(255,255,255,0.02)',
            border: '1px solid #21262d', borderRadius: 6,
          }}>
            <Terminal size={11} color="#3fb950" />
            <span style={{ color: '#3fb950', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
              netguard-ids-v2.1 // authentication required
            </span>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Username */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: '#7d8590', fontSize: 11, letterSpacing: '0.06em', marginBottom: 6 }}>
                USERNAME / EMAIL
              </label>
              <div style={{ position: 'relative' }}>
                <User size={14} color="#4d5666" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#0d1117', border: `1px solid ${error ? 'rgba(248,81,73,0.4)' : '#30363d'}`,
                    borderRadius: 6, padding: '10px 12px 10px 36px',
                    color: '#e6edf3', fontSize: 13, outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#58a6ff'; }}
                  onBlur={e => { e.target.style.borderColor = error ? 'rgba(248,81,73,0.4)' : '#30363d'; }}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', color: '#7d8590', fontSize: 11, letterSpacing: '0.06em', marginBottom: 6 }}>
                PASSWORD
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} color="#4d5666" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#0d1117', border: `1px solid ${error ? 'rgba(248,81,73,0.4)' : '#30363d'}`,
                    borderRadius: 6, padding: '10px 36px 10px 36px',
                    color: '#e6edf3', fontSize: 13, outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#58a6ff'; }}
                  onBlur={e => { e.target.style.borderColor = error ? 'rgba(248,81,73,0.4)' : '#30363d'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: '#4d5666', display: 'flex', alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
                padding: '8px 12px', background: 'rgba(248,81,73,0.08)',
                border: '1px solid rgba(248,81,73,0.25)', borderRadius: 6,
              }}>
                <AlertCircle size={13} color="#f85149" />
                <span style={{ color: '#f85149', fontSize: 12 }}>{error}</span>
                {attempts >= 3 && (
                  <span style={{ color: '#7d8590', fontSize: 11, marginLeft: 4 }}>
                    ({attempts} attempts)
                  </span>
                )}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%', padding: '11px 20px',
                background: isLoading ? 'rgba(88,166,255,0.15)' : 'rgba(88,166,255,0.15)',
                border: '1px solid rgba(88,166,255,0.35)',
                borderRadius: 6, color: isLoading ? '#4d5666' : '#58a6ff',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={e => { if (!isLoading) { (e.target as HTMLButtonElement).style.background = 'rgba(88,166,255,0.22)'; } }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'rgba(88,166,255,0.15)'; }}
            >
              {isLoading ? (
                <>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: '2px solid #4d5666', borderTopColor: '#58a6ff',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  AUTHENTICATING...
                </>
              ) : (
                <>
                  <Lock size={13} />
                  AUTHENTICATE
                </>
              )}
            </button>
          </form>
        </div>

        {/* Demo credentials */}
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: 'rgba(63,185,80,0.05)', border: '1px solid rgba(63,185,80,0.15)',
          borderRadius: 8,
        }}>
          <div style={{ color: '#3fb950', fontSize: 10, letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>
            DEMO CREDENTIALS
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { role: 'ADMIN', user: 'admin', pass: 'NetGuard@2025' },
              { role: 'ANALYST', user: 'analyst', pass: 'Analyst@123' },
            ].map(c => (
              <button
                key={c.role}
                onClick={() => { setUsername(c.user); setPassword(c.pass); setError(''); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', padding: 0,
                }}
              >
                <div style={{ color: '#3fb950', fontSize: 10, fontFamily: 'monospace', marginBottom: 2 }}>
                  [{c.role}]
                </div>
                <div style={{ color: '#7d8590', fontSize: 10, fontFamily: 'monospace' }}>
                  {c.user} / {c.pass}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, color: '#4d5666', fontSize: 10, letterSpacing: '0.04em' }}>
          NETGUARD IDS v2.1 — Sessions expire after 30 minutes of inactivity
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input::placeholder { color: #4d5666; }
      `}</style>
    </div>
  );
}
