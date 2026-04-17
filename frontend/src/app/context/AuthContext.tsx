import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const AUTH_KEY = 'netguard_session_v1';

const MOCK_USERS = [
  { id: 'u1', username: 'admin', password: 'NetGuard@2025', email: 'admin@netguard.sec', role: 'admin' as const },
  { id: 'u2', username: 'analyst', password: 'Analyst@123', email: 'analyst@netguard.sec', role: 'analyst' as const },
];

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (username: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const { userData, expiresAt } = JSON.parse(raw);
      if (Date.now() > expiresAt) { localStorage.removeItem(AUTH_KEY); return null; }
      return { ...userData, lastLogin: new Date(userData.lastLogin) };
    } catch { return null; }
  });

  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const update = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach(e => window.addEventListener(e, update, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, update));
  }, []);

  useEffect(() => {
    if (!user) return;
    const check = setInterval(() => {
      if (Date.now() - lastActivityRef.current > SESSION_TIMEOUT) {
        setUser(null);
        localStorage.removeItem(AUTH_KEY);
      }
    }, 30000);
    return () => clearInterval(check);
  }, [user]);

  const login = useCallback((username: string, password: string) => {
    const found = MOCK_USERS.find(u => u.username === username && u.password === password);
    if (!found) return { success: false, error: 'Invalid credentials. Access denied.' };
    const userData: User = {
      id: found.id, username: found.username, email: found.email,
      role: found.role, lastLogin: new Date(),
    };
    setUser(userData);
    localStorage.setItem(AUTH_KEY, JSON.stringify({ userData, expiresAt: Date.now() + SESSION_TIMEOUT }));
    lastActivityRef.current = Date.now();
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(AUTH_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
