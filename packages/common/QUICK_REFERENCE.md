# Quick Reference: Secure Authentication

## TL;DR - What Changed?

| Aspect | Before | After |
|--------|--------|-------|
| **Session Storage** | localStorage | HttpOnly Cookie |
| **User Data** | Stored in browser | Memory only |
| **XSS Protection** | ❌ None | ✅ Protected |
| **Persistence** | Until cleared | Session-based |
| **Access** | Any JavaScript | Server-controlled |

## Common Tasks

### 1. Login User

```typescript
// In your login component
const handleLogin = async (credentials) => {
  const response = await fetch('/api/auth/signin', {
    method: 'POST',
    credentials: 'include',  // Important!
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  
  const userData = await response.json();
  
  if (response.ok) {
    authStore.setUser(userData);  // Memory only
    window.location.href = '/home';
  }
};
```

### 2. Check if User is Logged In

```typescript
// Option 1: Subscribe to changes (recommended)
authStore.subscribe((state) => {
  if (state.isAuthenticated) {
    console.log('User:', state.user);
  }
});

// Option 2: Get current state
const { isAuthenticated, user } = authStore.getState();

// Option 3: In React components
import { useAuthStore } from '@julyware/common';

function MyComponent() {
  const { state } = useAuthStore();
  
  if (!state.isAuthenticated) {
    return <LoginPrompt />;
  }
  
  return <div>Welcome, {state.user?.name}</div>;
}
```

### 3. Logout User

```typescript
// Always use async logout
const handleLogout = async () => {
  try {
    await authStore.logout();  // Clears server + client
    window.location.href = '/signin';
  } catch (error) {
    console.error('Logout failed:', error);
  }
};
```

### 4. Refresh User Data

```typescript
// Re-fetch user profile from server
const refreshProfile = async () => {
  const user = await authStore.refreshUserProfile();
  if (!user) {
    // Session expired
    window.location.href = '/signin';
  }
};
```

### 5. Protect Routes

```typescript
// In your route guard or component
useEffect(() => {
  const { isAuthenticated, loading } = authStore.getState();
  
  if (!loading && !isAuthenticated) {
    window.location.href = '/signin';
  }
}, []);
```

## API Reference

### AuthStore Methods

```typescript
interface AuthStore {
  // Get current state
  getState(): AuthState
  
  // Set user after login
  setUser(user: User | null): void
  
  // Async logout (clears server session)
  logout(): Promise<void>
  
  // Refresh user data from backend
  refreshUserProfile(): Promise<User | null>
  
  // Subscribe to state changes
  subscribe(listener: (state: AuthState) => void): () => void
  
  // Set loading state
  setLoading(loading: boolean): void
  
  // Cleanup (for SPAs)
  destroy(): void
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  loading: boolean
}
```

### React Hook

```typescript
interface UseAuthStoreReturn {
  state: AuthState
  setUser: (user: User | null) => void
  logout: () => Promise<void>
}

// Usage
const { state, setUser, logout } = useAuthStore();
```

## Backend Requirements

### Required Endpoints

#### `POST /api/auth/signin`
```typescript
// Request
{
  "loginId": "user@example.com",
  "password": "secret123"
}

// Response (200 OK)
{
  "id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "email": "john@example.com",
  "avatar": "https://..."
}

// Headers
Set-Cookie: SESSION_ID=xyz; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600
```

#### `GET /api/auth/profile`
```typescript
// Request (cookie sent automatically)
Headers: Cookie: SESSION_ID=xyz

// Response (200 OK)
{
  "id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "email": "john@example.com",
  "avatar": "https://..."
}

// Response (401 Unauthorized) - if session invalid
{
  "error": "Unauthorized"
}
```

#### `POST /api/auth/logout`
```typescript
// Request (cookie sent automatically)
Headers: Cookie: SESSION_ID=xyz

// Response (200 OK)

// Headers
Set-Cookie: SESSION_ID=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0
```

#### `GET /api/auth/validate` (Optional)
```typescript
// Response (200 OK) - session valid
{}

// Response (401 Unauthorized) - session invalid
{
  "error": "Session expired"
}
```

### CORS Configuration

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://yourdomain.com")
            .allowCredentials(true)  // Critical!
            .allowedMethods("GET", "POST", "PUT", "DELETE");
    }
}
```

## Security Checklist

### Frontend
- [ ] No `localStorage.setItem()` for auth data
- [ ] Use `credentials: 'include'` in fetch calls
- [ ] Call `await authStore.logout()` for logout
- [ ] Don't manually manipulate cookies
- [ ] Use HTTPS in production

### Backend
- [ ] Set HttpOnly flag on session cookies
- [ ] Set Secure flag (HTTPS only)
- [ ] Set SameSite=Strict or Lax
- [ ] Implement session expiration
- [ ] Enable CORS with credentials
- [ ] Add CSRF protection
- [ ] Rate limit auth endpoints

## Troubleshooting

### Problem: "User logged out on refresh"

**Cause:** Session cookie expired or invalid

**Solution:**
1. Check cookie expiration time
2. Verify backend session store is working
3. Check Network tab for `/api/auth/profile` response

### Problem: "Cookie not being sent"

**Cause:** Missing `credentials: 'include'` or CORS issue

**Solution:**
```typescript
fetch('/api/auth/profile', {
  credentials: 'include'  // Add this!
});
```

Check backend CORS allows credentials.

### Problem: "CORS error with credentials"

**Cause:** Backend not configured properly

**Solution:**
```java
.allowCredentials(true)
.allowedOrigins("https://specific-domain.com")  // Cannot use "*"
```

### Problem: "CSRF token validation failed"

**Cause:** Missing or invalid CSRF token

**Solution:**
```typescript
const csrfToken = document.cookie
  .split('; ')
  .find(row => row.startsWith('XSRF-TOKEN='))
  ?.split('=')[1];

fetch('/api/auth/signin', {
  headers: {
    'X-XSRF-TOKEN': csrfToken || ''
  }
});
```

## Migration Steps

1. **Update package:**
   ```bash
   pnpm install @julyware/common@latest
   ```

2. **Remove localStorage code:**
   ```typescript
   // Delete these lines
   localStorage.setItem('luxio_auth', ...)
   localStorage.getItem('luxio_auth')
   ```

3. **Update logout:**
   ```typescript
   // Before
   localStorage.removeItem('luxio_auth');
   
   // After
   await authStore.logout();
   ```

4. **Test thoroughly**

## Best Practices

✅ **DO:**
- Use `authStore.subscribe()` for reactive updates
- Handle loading states in UI
- Implement proper error handling
- Use HTTPS everywhere
- Set reasonable session timeouts

❌ **DON'T:**
- Store tokens in localStorage
- Manually parse cookies
- Skip error handling
- Use HTTP in production
- Ignore session expiration

## Need Help?

📚 **Documentation:**
- `AUTH_SECURITY.md` - Detailed security guide
- `MIGRATION_CHECKLIST.md` - Step-by-step migration
- `VISUAL_GUIDE.md` - Visual explanations

💬 **Support:**
- Check existing documentation first
- Review source code in `packages/common/src/auth.ts`
- Contact security team for critical issues

---

**Quick Tip:** When in doubt, remember: **Server manages sessions, client just displays state.**