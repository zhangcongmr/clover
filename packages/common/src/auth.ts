/// <reference lib="dom" />
import { User } from './model.js';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
}

const AUTH_STATE_KEY = 'clover_auth_state';
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // Check session every 5 minutes
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

// Only store minimal, non-sensitive state in memory (not localStorage)
interface ClientAuthState {
  isAuthenticated: boolean;
  lastChecked: number;
  userId?: string; // Only store non-sensitive identifier
}

class AuthStore {
  private state: AuthState = {
    user: null,
    isAuthenticated: false,
    loading: true,
  };

  private clientState: ClientAuthState = {
    isAuthenticated: false,
    lastChecked: 0,
  };

  private listeners: Array<(state: AuthState) => void> = [];
  private sessionCheckTimer?: number;

  constructor() {
    this.initializeAuth();
    this.setupSessionMonitoring();
  }

  /**
   * Initialize authentication state by checking with backend
   * This avoids storing sensitive data in localStorage
   */
  private async initializeAuth() {
    if (!isBrowser) {
      this.state.loading = false;
      this.notify();
      return;
    }

    try {
      // Check authentication status via HTTP-only cookie
      const response = await fetch('/api/auth/profile', {
        method: 'GET',
        credentials: 'include', // Send HttpOnly cookie
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const userData = await response.json();
        this.state = {
          user: userData,
          isAuthenticated: true,
          loading: false,
        };
        this.clientState = {
          isAuthenticated: true,
          lastChecked: Date.now(),
          userId: userData?.id,
        };
      } else {
        // Not authenticated
        this.state = {
          user: null,
          isAuthenticated: false,
          loading: false,
        };
        this.clientState = {
          isAuthenticated: false,
          lastChecked: Date.now(),
        };
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      this.state = {
        user: null,
        isAuthenticated: false,
        loading: false,
      };
    }
    
    this.notify();
  }

  /**
   * Setup periodic session validation
   * Ensures stale sessions are detected
   */
  private setupSessionMonitoring() {
    if (!isBrowser) return;

    // Check session validity periodically
    this.sessionCheckTimer = window.setInterval(async () => {
      // await this.validateSession();
    }, SESSION_CHECK_INTERVAL);

    // Also check when page becomes visible again
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        // await this.validateSession();
      }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      if (this.sessionCheckTimer) {
        clearInterval(this.sessionCheckTimer);
      }
    });
  }

  /**
   * Validate current session with backend
   */
  private async validateSession(): Promise<boolean> {
    if (!isBrowser || !this.clientState.isAuthenticated) {
      return false;
    }

    try {
      const response = await fetch('/api/auth/validate', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      const isValid = response.ok;
      
      if (!isValid && this.clientState.isAuthenticated) {
        // Session expired or invalid
        this.handleSessionInvalidation();
      } else if (isValid) {
        this.clientState.lastChecked = Date.now();
      }

      return isValid;
    } catch (error) {
      console.error('Session validation failed:', error);
      return false;
    }
  }

  /**
   * Handle session invalidation (expired, logged out, etc.)
   */
  private handleSessionInvalidation() {
    this.state = {
      user: null,
      isAuthenticated: false,
      loading: false,
    };
    this.clientState = {
      isAuthenticated: false,
      lastChecked: Date.now(),
    };
    this.notify();
  }

  private notify() {
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Get current auth state
   */
  getState(): AuthState {
    return { ...this.state };
  }

  /**
   * Set user data after successful login
   * Note: Actual session is managed by HttpOnly cookie from backend
   */
  setUser(user: User | null) {
    this.state.user = user;
    this.state.isAuthenticated = !!user;
    this.state.loading = false;
    
    this.clientState = {
      isAuthenticated: !!user,
      lastChecked: Date.now(),
      userId: user?.id,
    };
    
    this.notify();
  }

  /**
   * Set loading state
   */
  setLoading(loading: boolean) {
    this.state.loading = loading;
    this.notify();
  }

  /**
   * Logout - clears client state and calls backend to invalidate session
   */
  async logout(): Promise<void> {
    if (!isBrowser) {
      this.handleSessionInvalidation();
      return;
    }

    try {
      // Call backend to invalidate session (clear HttpOnly cookie)
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      // Always clear client state regardless of backend response
      this.handleSessionInvalidation();
      
      // Clear any sessionStorage items used for redirects
      try {
        sessionStorage.clear();
      } catch (error) {
        console.error('Failed to clear sessionStorage:', error);
      }
    }
  }

  /**
   * Refresh user data from backend
   */
  async refreshUserProfile(): Promise<User | null> {
    if (!isBrowser) return null;

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const userData = await response.json();
        this.setUser(userData);
        return userData;
      } else {
        this.handleSessionInvalidation();
        return null;
      }
    } catch (error) {
      console.error('Failed to refresh profile:', error);
      return null;
    }
  }

  /**
   * Subscribe to auth state changes
   */
  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    
    // Immediately notify with current state
    listener(this.state);
    
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.sessionCheckTimer) {
      clearInterval(this.sessionCheckTimer);
    }
    this.listeners = [];
  }
}

export const authStore = new AuthStore();
