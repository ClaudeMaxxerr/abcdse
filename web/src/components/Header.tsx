import React from "react";
import { UserAuth } from "../types.js";
import { Trophy, Users, Layers, LayoutDashboard, LogIn, LogOut } from "lucide-react";

interface HeaderProps {
  activeTab: "teams" | "members" | "issues" | "dashboard";
  onSelectTab: (tab: "teams" | "members" | "issues" | "dashboard") => void;
  user: UserAuth | null;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  user,
  onLogout,
}) => {
  return (
    <header style={{
      borderBottom: "1px solid #1e293b",
      background: "rgba(15, 23, 42, 0.85)",
      backdropFilter: "blur(12px)",
      position: "sticky",
      top: 0,
      zIndex: 50,
      padding: "0.75rem 1.5rem",
    }}>
      <div style={{
        maxWidth: "1400px",
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "1rem",
      }}>
        {/* Brand / Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: "linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 15px rgba(56, 189, 248, 0.4)",
          }}>
            <Trophy size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.02em", color: "#f8fafc" }}>
              PATCH WARS <span style={{ color: "#38bdf8" }}>2026</span>
            </div>
            <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              TSJ Competition Tracker
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            onClick={() => onSelectTab("teams")}
            className={activeTab === "teams" ? "btn btn-primary" : "btn btn-outline"}
            style={{ fontSize: "0.85rem", padding: "0.45rem 0.85rem" }}
          >
            <Trophy size={16} />
            <span>Teams</span>
          </button>

          <button
            onClick={() => onSelectTab("members")}
            className={activeTab === "members" ? "btn btn-primary" : "btn btn-outline"}
            style={{ fontSize: "0.85rem", padding: "0.45rem 0.85rem" }}
          >
            <Users size={16} />
            <span>Members</span>
          </button>

          <button
            onClick={() => onSelectTab("issues")}
            className={activeTab === "issues" ? "btn btn-primary" : "btn btn-outline"}
            style={{ fontSize: "0.85rem", padding: "0.45rem 0.85rem" }}
          >
            <Layers size={16} />
            <span>Issue Board</span>
          </button>

          <button
            onClick={() => onSelectTab("dashboard")}
            className={activeTab === "dashboard" ? "btn btn-primary" : "btn btn-outline"}
            style={{ fontSize: "0.85rem", padding: "0.45rem 0.85rem" }}
          >
            <LayoutDashboard size={16} />
            <span>My Dashboard</span>
          </button>
        </nav>

        {/* User Auth Action */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f8fafc" }}>
                  {user.displayName || user.githubLogin}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                  @{user.githubLogin} • <span className={`badge badge-${user.tier}`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>{user.tier}</span>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="btn btn-secondary"
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                title="Log out"
              >
                <LogOut size={14} />
                <span>Logout</span>
              </button>
            </div>
          ) : (
            <a
              href="/auth/github"
              className="btn btn-primary"
              style={{ fontSize: "0.85rem", padding: "0.45rem 0.9rem" }}
            >
              <LogIn size={15} />
              <span>Login with GitHub</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
