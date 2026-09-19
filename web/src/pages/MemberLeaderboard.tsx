import React, { useState, useEffect } from "react";
import { MemberScore } from "../types.js";
import { fetchMemberLeaderboard } from "../api.js";
import { CapProgressBar } from "../components/CapProgressBar.js";
import { Users, Search } from "lucide-react";

export const MemberLeaderboard: React.FC<{ initialData?: MemberScore[] }> = ({ initialData }) => {
  const [members, setMembers] = useState<MemberScore[]>(initialData || []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<string>("ALL");
  const [selectedDept, setSelectedDept] = useState<string>("ALL");
  const [selectedTier, setSelectedTier] = useState<string>("ALL");

  useEffect(() => {
    if (!initialData) {
      loadData();
    }
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMemberLeaderboard();
      setMembers(data);
    } catch (err: any) {
      setError(err.message || "Failed to load member standings");
    } finally {
      setLoading(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (selectedTeam !== "ALL" && m.team !== selectedTeam) return false;
    if (selectedDept !== "ALL" && m.department !== selectedDept) return false;
    if (selectedTier !== "ALL" && m.tier !== selectedTier) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = m.displayName?.toLowerCase().includes(q);
      const matchLogin = m.githubLogin?.toLowerCase().includes(q);
      if (!matchName && !matchLogin) return false;
    }

    return true;
  });

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1300px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.03em", color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Users size={28} color="#38bdf8" /> Member Leaderboard
        </h1>
        <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.25rem" }}>
          Individual participant standings with live tier cap tracking (Technical: 60 pts max • General: 80 pts max)
        </p>
      </div>

      {/* Filter & Search Bar */}
      <div className="glass-panel" style={{ padding: "1rem", marginBottom: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={16} color="#64748b" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            placeholder="Search by name or @github..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem 0.5rem 2.25rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.85rem",
            }}
          />
        </div>

        {/* Team Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Team:</span>
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL">All Teams</option>
            <option value="NEXUS">Nexus</option>
            <option value="CIPHER">Cipher</option>
            <option value="BYTE_BRIGADE">Byte Brigade</option>
            <option value="ASCEND">Ascend</option>
            <option value="ECHO">Echo</option>
          </select>
        </div>

        {/* Department Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Dept:</span>
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL">All Departments</option>
            <option value="technical">Technical</option>
            <option value="pr">PR</option>
            <option value="research_and_development">Research &amp; Dev</option>
            <option value="event_management">Event Management</option>
            <option value="social_and_design">Social &amp; Design</option>
          </select>
        </div>

        {/* Tier Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Tier:</span>
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL">All Tiers</option>
            <option value="tech">Tech (60 pt cap)</option>
            <option value="general">General (80 pt cap)</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "rgba(244, 63, 94, 0.15)", border: "1px solid rgba(244, 63, 94, 0.4)", borderRadius: "8px", color: "#fda4af", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="glass-panel" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "rgba(30, 41, 59, 0.7)", borderBottom: "1px solid #334155", color: "#94a3b8", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em" }}>
                <th style={{ padding: "0.85rem 1rem", width: "60px", textAlign: "center" }}>Rank</th>
                <th style={{ padding: "0.85rem 1rem" }}>Participant</th>
                <th style={{ padding: "0.85rem 1rem" }}>Team & Dept</th>
                <th style={{ padding: "0.85rem 1rem", textAlign: "center" }}>PRs (Merged / Total)</th>
                <th style={{ padding: "0.85rem 1rem", width: "260px" }}>Score vs Tier Cap</th>
                <th style={{ padding: "0.85rem 1.25rem", textAlign: "right", color: "#38bdf8" }}>Final Score</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: "3rem 1rem", textAlign: "center", color: "#94a3b8" }}>
                    Loading member standings...
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "3rem 1rem", textAlign: "center", color: "#94a3b8" }}>
                    No members match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((m, idx) => {
                  const isCapHit = m.raw >= m.tierCap;
                  return (
                    <tr
                      key={m.memberId}
                      style={{
                        borderBottom: "1px solid #1e293b",
                        background: isCapHit ? "rgba(244, 63, 94, 0.04)" : idx < 3 ? "rgba(56, 189, 248, 0.03)" : undefined,
                        transition: "background 0.15s ease",
                      }}
                    >
                      <td style={{ padding: "1rem", textAlign: "center", fontWeight: 700, color: idx < 3 ? "#38bdf8" : "#94a3b8" }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: "1rem" }}>
                        <div style={{ fontWeight: 700, color: "#f8fafc" }}>
                          {m.displayName || m.githubLogin}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          @{m.githubLogin}
                        </div>
                      </td>
                      <td style={{ padding: "1rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{m.team}</span>
                          <span style={{ color: "#64748b" }}>•</span>
                          <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{m.department}</span>
                          <span className={`badge badge-${m.tier}`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>
                            {m.tier}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "1rem", textAlign: "center", fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "#34d399", fontWeight: 700 }}>{m.mergedPrs}</span>
                        <span style={{ color: "#64748b" }}> / {m.totalPrs}</span>
                      </td>
                      <td style={{ padding: "1rem" }}>
                        <CapProgressBar
                          raw={m.raw}
                          tierCap={m.tierCap}
                          capped={m.capped}
                          tier={m.tier}
                          showDetails={false}
                        />
                      </td>
                      <td style={{ padding: "1rem 1.25rem", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "1.1rem", color: isCapHit ? "#fb7185" : "#38bdf8" }}>
                        {m.capped}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
