import { RequestHandler } from 'express';
import { authStorage } from './storage';

export type UserRole = 'user' | 'services' | 'company' | 'admin';

// Role hierarchy: admin > company > services > user
const roleHierarchy: Record<UserRole, number> = {
  user: 1,
  services: 2,
  company: 3,
  admin: 4,
};

// Check if user has at least the required role
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

// Middleware to check role access
export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return async (req, res, next) => {
    const userClaims = (req as any).user?.claims;
    
    if (!userClaims?.sub) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
      const user = await authStorage.getUser(userClaims.sub);
      
      if (!user) {
        return res.status(401).json({ ok: false, error: 'User not found' });
      }

      if (user.status !== 'active') {
        return res.status(403).json({ ok: false, error: 'Account is not active' });
      }

      const userRole = user.role as UserRole;
      
      // Admin always has access
      if (userRole === 'admin') {
        (req as any).currentUser = user;
        return next();
      }

      // Check if user has one of the allowed roles
      if (allowedRoles.includes(userRole)) {
        (req as any).currentUser = user;
        return next();
      }

      return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
    } catch (error) {
      console.error('Role check error:', error);
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  };
}

// Middleware to get current user (optional auth)
export const getCurrentUser: RequestHandler = async (req, res, next) => {
  const userClaims = (req as any).user?.claims;
  
  if (userClaims?.sub) {
    try {
      const user = await authStorage.getUser(userClaims.sub);
      (req as any).currentUser = user;
    } catch (error) {
      console.error('Get current user error:', error);
    }
  }
  
  next();
};

// Middleware to check company access (user can only access own company data)
export function requireCompanyAccess(): RequestHandler {
  return async (req, res, next) => {
    const currentUser = (req as any).currentUser;
    
    if (!currentUser) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    // Admin can access any company
    if (currentUser.role === 'admin') {
      return next();
    }

    // Get the companyId from request params or body
    const requestedCompanyId = req.params.companyId || req.body.companyId;
    
    if (requestedCompanyId && currentUser.companyId !== requestedCompanyId) {
      return res.status(403).json({ ok: false, error: 'Access denied to this company' });
    }

    next();
  };
}
