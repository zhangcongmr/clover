# Authentication Security Migration Checklist

## Overview

This checklist helps you migrate from localStorage-based authentication to the secure HttpOnly cookie-based approach.

## Backend Changes Required

### 1. Session Cookie Configuration

- [ ] Configure session cookies with security flags:
  ```java
  Cookie sessionCookie = new Cookie("SESSION_ID", sessionId);
  sessionCookie.setHttpOnly(true);   // Prevent JavaScript access
  sessionCookie.setSecure(true);     // HTTPS only (production)
  sessionCookie.setPath("/");        // Available app-wide
  sessionCookie.setMaxAge(3600);     // 1 hour expiration
  sessionCookie.setAttribute("SameSite", "Strict"); // CSRF protection
  response.addCookie(sessionCookie);
  ```

### 2. Authentication Endpoints

#### Login Endpoint (`POST /api/auth/signin`)

- [ ] Validate credentials
- [ ] Create server-side session
- [ ] Set HttpOnly cookie in response
- [ ] Return user data in response body (not in cookie)

Example response:
```json
{
  "id": "user123",
  "username": "john.doe",
  "name": "John Doe",
  "email": "john@example.com",
  "avatar": "https://..."
}
```

#### Profile Endpoint (`GET /api/auth/profile`)

- [ ] Read session from HttpOnly cookie
- [ ] Validate session exists and is not expired
- [ ] Return 200 with user data if valid
- [ ] Return 401 if session invalid

#### Logout Endpoint (`POST /api/auth/logout`)

- [ ] Invalidate session server-side
- [ ] Clear cookie: `Set-Cookie: SESSION_ID=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
- [ ] Return 200 OK

#### Validation Endpoint (`GET /api/auth/validate`) - Optional but Recommended

- [ ] Quick session validation
- [ ] Return 200 if valid, 401 if invalid
- [ ] Minimal processing for performance

### 3. CORS Configuration

- [ ] Enable credentials in CORS:
  ```java
  @Configuration
  public class CorsConfig implements WebMvcConfigurer {
      @Override
      public void addCorsMappings(CorsRegistry registry) {
          registry.addMapping("/api/**")
              .allowedOrigins("https://yourdomain.com")
              .allowCredentials(true)  // Critical for cookies
              .allowedMethods("GET", "POST", "PUT", "DELETE")
              .allowedHeaders("*");
      }
  }
  ```

### 4. CSRF Protection

- [ ] Enable CSRF token generation endpoint (`GET /api/csrf`)
- [ ] Configure CSRF token repository
- [ ] Verify CSRF tokens on state-changing operations

## Frontend Changes Required

### 1. Update Package Dependencies

- [ ] Ensure `@julyware/common` package is updated to latest version
- [ ] Run `pnpm install` to update dependencies

### 2. Remove localStorage Usage

Search and remove these patterns:

- [ ] `localStorage.setItem('clover_auth', ...)`
- [ ] `localStorage.getItem('clover_auth')`
- [ ] `localStorage.removeItem('clover_auth')`
- [ ] Any manual JSON parsing of auth data from storage

### 3. Update Auth Store Usage

**Before:**
```typescript
import { authStore } from '@julyware/common';

// Old way - might have manually managed storage
const user = JSON.parse(localStorage.getItem('user'));
authStore.setUser(user);
```

**After:**
```typescript
import { authStore } from '@julyware/common';

// New way - let authStore handle everything
// On login success, just call setUser with backend response
authStore.setUser(userDataFromBackend);

// Subscribe to changes
authStore.subscribe((state) => {
  console.log('Auth changed:', state.isAuthenticated);
});
```

### 4. Update Login Flow

**In signin package or component:**

- [ ] Keep existing fetch call to `/api/auth/signin`
- [ ] On success, extract user data from response
- [ ] Call `authStore.setUser(userData)`
- [ ] Remove any manual localStorage manipulation

Example:
```typescript
const handleSignIn = async (e: React.FormEvent) => {
  e.preventDefault();
  
  try {
    const response = await fetch('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',  // Important!
      headers: { 
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': csrfToken || '',
      },
      body: JSON.stringify({ loginId, password }),
    });
    
    const userData = await response.json();
    
    if (response.ok) {
      // Backend sets HttpOnly cookie automatically
      // Just update client state
      authStore.setUser(userData);
      
      // Redirect
      window.location.href = '/home';
    }
  } catch (error) {
    console.error('Login failed:', error);
  }
};
```

### 5. Update Logout Flow

**Before:**
```typescript
const handleLogout = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('clover_auth');
  window.location.href = '/signin';
};
```

**After:**
```typescript
const handleLogout = async () => {
  try {
    // This handles both server session invalidation and client cleanup
    await authStore.logout();
    window.location.href = '/official-site';
  } catch (error) {
    console.error('Logout failed:', error);
    window.location.href = '/official-site'; // Still redirect
  }
};
```

### 6. Update Profile Fetching

**In components that load on mount:**

- [ ] Use `authStore.refreshUserProfile()` or let it auto-initialize
- [ ] Remove manual profile fetching logic

Example:
```typescript
useEffect(() => {
  // Option 1: Let authStore auto-initialize on first import
  // No code needed!
  
  // Option 2: Manually refresh if needed
  const refreshProfile = async () => {
    const user = await authStore.refreshUserProfile();
    if (!user) {
      window.location.href = '/signin';
    }
  };
  
  refreshProfile();
}, []);
```

### 7. Update React Components Using Hooks

If using `useAuthStore`:

- [ ] No changes needed to hook usage
- [ ] The hook interface remains the same
- [ ] State structure unchanged

```typescript
import { useAuthStore } from '@julyware/common';

function MyComponent() {
  const { state, setUser, logout } = useAuthStore();
  
  // Everything works the same!
  if (!state.isAuthenticated) return <LoginPrompt />;
  
  return <div>Welcome {state.user?.name}</div>;
}
```

## Testing Checklist

### Manual Testing

- [ ] **Login Flow**
  - Enter credentials and submit
  - Verify redirect to home page
  - Check DevTools → Application → Cookies: Session cookie present with HttpOnly flag
  - Check DevTools → Application → Local Storage: NO auth data stored
  
- [ ] **Session Persistence**
  - Refresh page while logged in
  - Verify user stays logged in (session re-validated)
  - Check network tab: `/api/auth/profile` request sent with cookie
  
- [ ] **Logout Flow**
  - Click logout button
  - Verify redirect to official-site
  - Check cookies: Session cookie cleared
  - Try accessing protected route: Should redirect to login
  
- [ ] **Session Expiration**
  - Wait for session timeout (or manually expire on backend)
  - Try to perform authenticated action
  - Verify redirect to login page
  
- [ ] **XSS Resistance**
  - Open browser console
  - Try: `document.cookie` - should NOT show session cookie
  - Try: `localStorage.getItem('clover_auth')` - should return null

### Automated Testing

- [ ] Update unit tests for auth store
- [ ] Add security-focused integration tests
- [ ] Test CORS configuration with credentials
- [ ] Verify CSRF token flow

## Security Audit

- [ ] Run security scan for XSS vulnerabilities
- [ ] Verify Content-Security-Policy headers
- [ ] Check all API endpoints require authentication
- [ ] Verify rate limiting on auth endpoints
- [ ] Test with browser security tools (Lighthouse, etc.)

## Deployment Checklist

- [ ] Update environment variables for production domain
- [ ] Enable HTTPS (required for Secure cookies)
- [ ] Configure reverse proxy (nginx) to preserve cookies
- [ ] Update CORS allowed origins to production domains
- [ ] Test in staging environment first
- [ ] Monitor authentication logs after deployment
- [ ] Have rollback plan ready

## Rollback Plan

If issues occur:

1. Revert backend cookie configuration
2. Revert frontend auth.ts changes
3. Clear all user sessions
4. Force users to re-login

Keep old implementation in git history for quick rollback if needed.

## Common Issues & Solutions

### Issue: "Cookie not being sent with requests"

**Solution:**
- Check `credentials: 'include'` in fetch calls
- Verify CORS allows credentials
- Check cookie domain matches your domain

### Issue: "User logged out on every refresh"

**Solution:**
- Verify session cookie has correct `Max-Age` or `Expires`
- Check backend session store is working
- Verify cookie path is `/`

### Issue: "CORS error when sending credentials"

**Solution:**
```java
// Backend must explicitly allow credentials
.allowCredentials(true)
.allowedOrigins("https://specific-domain.com") // Cannot use "*" with credentials
```

### Issue: "CSRF token validation failed"

**Solution:**
- Ensure CSRF token endpoint is called before form submission
- Include token in request headers: `'X-XSRF-TOKEN': csrfToken`
- Check cookie name matches expected name (usually `XSRF-TOKEN`)

## Support

For questions or issues:
1. Review `packages/common/AUTH_SECURITY.md`
2. Check implementation in `packages/common/src/auth.ts`
3. Contact security team for critical issues

---

**Migration Status Tracking:**

| Package | Status | Notes |
|---------|--------|-------|
| common | ✅ Complete | Auth store updated |
| home | ✅ Complete | Logout handler updated |
| signin | ⏳ Pending | Verify login flow |
| signup | ⏳ Pending | Verify registration flow |
| assistant | ⏳ Pending | Check Angular integration |
| editor | ⏳ Pending | Verify widget integration |
| community-widget | ⏳ Pending | Verify widget integration |

Last Updated: 2026-04-27