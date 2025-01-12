/**
 * This file exports a string constant containing a legacy authentication system implementation
 * with multiple security vulnerabilities. The code is used in test scenarios to demonstrate
 * the need for JWT-based authentication and security improvements.
 */

export const mockComplexAuthSystemContent = `// WARNING: This authentication system has known security vulnerabilities
// TODO: Implement proper security measures
// NOTE: Admin credentials are hardcoded for quick testing

// Types and interfaces for the authentication system
interface User {
  username: string;
  // SECURITY ISSUE: Passwords stored in plain text
  password: string;
  // SECURITY ISSUE: Basic role system without proper RBAC
  role: 'admin' | 'user' | 'guest';
  lastLogin?: Date;
}

interface Session {
  id: string;
  username: string;
  // SECURITY ISSUE: No session expiration
  createdAt: Date;
  // SECURITY ISSUE: No IP tracking or device fingerprinting
  userAgent?: string;
}

// SECURITY ISSUE: User database stored in memory
const users: User[] = [
  // SECURITY ISSUE: Hardcoded admin credentials
  {
    username: 'admin',
    password: 'admin123', // SECURITY ISSUE: Weak password
    role: 'admin',
  },
  {
    username: 'test_user',
    password: 'password123',
    role: 'user',
  },
];

// SECURITY ISSUE: Sessions stored in memory without proper cleanup
const activeSessions: Session[] = [];

class AuthenticationService {
  // SECURITY ISSUE: No rate limiting on login attempts
  login(username: string, password: string): Session | null {
    const user = users.find(
      (u) => u.username === username && u.password === password // SECURITY ISSUE: Plain text password comparison
    );

    if (user) {
      // SECURITY ISSUE: Predictable session ID using timestamp
      const session: Session = {
        id: \`\${Date.now()}_\${username}\`, // SECURITY ISSUE: Sequential and predictable session IDs
        username: user.username,
        createdAt: new Date(),
      };

      // SECURITY ISSUE: No maximum session limit per user
      activeSessions.push(session);

      // SECURITY ISSUE: No audit logging of login attempts
      user.lastLogin = new Date();

      return session;
    }

    return null;
  }

  // SECURITY ISSUE: No session validation or refresh mechanism
  validateSession(sessionId: string): boolean {
    return activeSessions.some((session) => session.id === sessionId);
  }

  // SECURITY ISSUE: Basic role check without proper RBAC
  hasAccess(sessionId: string, requiredRole: User['role']): boolean {
    const session = activeSessions.find((s) => s.id === sessionId);
    if (!session) return false;

    const user = users.find((u) => u.username === session.username);
    if (!user) return false;

    // SECURITY ISSUE: Oversimplified role checking
    if (requiredRole === 'admin') return user.role === 'admin';
    if (requiredRole === 'user') return user.role === 'admin' || user.role === 'user';
    return true; // SECURITY ISSUE: Guest access granted by default
  }

  // SECURITY ISSUE: No password complexity requirements
  createUser(username: string, password: string): User | null {
    // SECURITY ISSUE: No input validation or sanitization
    if (users.some((u) => u.username === username)) {
      return null;
    }

    const newUser: User = {
      username,
      password, // SECURITY ISSUE: Password stored as plain text
      role: 'user', // SECURITY ISSUE: Role hardcoded without verification
    };

    users.push(newUser);
    return newUser;
  }

  // SECURITY ISSUE: No verification of current session for logout
  logout(sessionId: string): void {
    const sessionIndex = activeSessions.findIndex((s) => s.id === sessionId);
    if (sessionIndex !== -1) {
      activeSessions.splice(sessionIndex, 1);
      // SECURITY ISSUE: No audit logging of logout
    }
  }

  // SECURITY ISSUE: Administrative functions without proper access control
  getAllUsers(): User[] {
    // SECURITY ISSUE: Returns all user data including passwords
    return users;
  }

  // Example usage:
  // const auth = new AuthenticationService();
  // const session = auth.login('admin', 'admin123');
  // if (session && auth.hasAccess(session.id, 'admin')) {
  //   const users = auth.getAllUsers();
  //   console.log('All users:', users);
  // }
}
`;
