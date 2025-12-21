export { setupAuth, isAuthenticated, getSession } from "./replitAuth";
export { authStorage, type IAuthStorage } from "./storage";
export { registerAuthRoutes } from "./routes";
export { requireRole, getCurrentUser, requireCompanyAccess, hasRole, type UserRole } from "./roles";
