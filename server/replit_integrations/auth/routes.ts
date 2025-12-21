import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { requireRole, getCurrentUser } from "./roles";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/users/assignable", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await authStorage.getUser(userId);
      
      if (!currentUser) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }

      let users: any[] = [];
      
      if (currentUser.role === "admin") {
        users = await authStorage.getAllUsers();
      } else if (currentUser.role === "services" || currentUser.role === "company") {
        if (currentUser.companyId) {
          users = await authStorage.getUsersByCompany(currentUser.companyId);
        }
      }
      
      const activeUsers = users.filter(u => u.status === "active");
      
      res.json({ 
        ok: true, 
        users: activeUsers.map(u => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          companyId: u.companyId,
        }))
      });
    } catch (error) {
      console.error("Error fetching assignable users:", error);
      res.status(500).json({ ok: false, error: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, requireRole("admin"), async (_req, res) => {
    try {
      const allUsers = await authStorage.getAllUsers();
      const companies = await authStorage.getAllCompanies();
      
      const usersWithCompany = allUsers.map(user => {
        const company = companies.find(c => c.id === user.companyId);
        return {
          ...user,
          companyName: company?.name || null,
        };
      });
      
      res.json({ ok: true, users: usersWithCompany });
    } catch (error) {
      console.error("Error fetching all users:", error);
      res.status(500).json({ ok: false, error: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/users/:userId/role", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      
      if (!["user", "services", "company", "admin"].includes(role)) {
        return res.status(400).json({ ok: false, error: "Invalid role" });
      }
      
      const user = await authStorage.updateUserRole(userId, role);
      if (!user) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }
      
      res.json({ ok: true, user });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ ok: false, error: "Failed to update role" });
    }
  });

  app.patch("/api/admin/users/:userId/status", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { userId } = req.params;
      const { status } = req.body;
      
      if (!["active", "pending", "inactive"].includes(status)) {
        return res.status(400).json({ ok: false, error: "Invalid status" });
      }
      
      const user = await authStorage.updateUserStatus(userId, status);
      if (!user) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }
      
      res.json({ ok: true, user });
    } catch (error) {
      console.error("Error updating user status:", error);
      res.status(500).json({ ok: false, error: "Failed to update status" });
    }
  });

  app.patch("/api/admin/users/:userId/company", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { userId } = req.params;
      const { companyId } = req.body;
      
      const user = await authStorage.assignUserToCompany(userId, companyId || null);
      if (!user) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }
      
      res.json({ ok: true, user });
    } catch (error) {
      console.error("Error updating user company:", error);
      res.status(500).json({ ok: false, error: "Failed to update company" });
    }
  });

  app.get("/api/admin/companies", isAuthenticated, requireRole("admin", "company"), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await authStorage.getUser(userId);
      
      if (!currentUser) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }

      let companiesList: Array<{ id: string; name: string; createdAt: Date | null }> = [];
      if (currentUser.role === "admin") {
        companiesList = await authStorage.getAllCompanies();
      } else if (currentUser.role === "company" && currentUser.companyId) {
        const company = await authStorage.getCompany(currentUser.companyId);
        companiesList = company ? [company] : [];
      }
      
      res.json({ ok: true, companies: companiesList });
    } catch (error) {
      console.error("Error fetching companies:", error);
      res.status(500).json({ ok: false, error: "Failed to fetch companies" });
    }
  });

  app.post("/api/admin/companies", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { name } = req.body;
      
      if (!name || typeof name !== "string") {
        return res.status(400).json({ ok: false, error: "Company name is required" });
      }
      
      const company = await authStorage.createCompany({ name });
      res.json({ ok: true, company });
    } catch (error) {
      console.error("Error creating company:", error);
      res.status(500).json({ ok: false, error: "Failed to create company" });
    }
  });

  app.patch("/api/admin/companies/:companyId", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { companyId } = req.params;
      const { name, status } = req.body;
      
      const updateData: any = {};
      if (name) updateData.name = name;
      if (status) updateData.status = status;
      
      const company = await authStorage.updateCompany(companyId, updateData);
      if (!company) {
        return res.status(404).json({ ok: false, error: "Company not found" });
      }
      
      res.json({ ok: true, company });
    } catch (error) {
      console.error("Error updating company:", error);
      res.status(500).json({ ok: false, error: "Failed to update company" });
    }
  });
}
