import React, { useState, useEffect } from "react";
import { TeamScore, MemberScore } from "../types.js";
import { fetchTeamLeaderboard } from "../api.js";
import { Trophy, RefreshCw, ChevronDown, ChevronUp, Sparkles, Users } from "lucide-react";

export const TeamLeaderboard: React.FC<{ initialData?: TeamScore[] }> = ({ initialData }) => {
  const [teams, setTeams] = useState<TeamScore[]>(initialData || []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTeamLeaderboard();
      setTeams(data);
      setLastRefreshed(new Date());
      setCountdown(60);
    } catch (err: any) {
      setError(err.message || "Failed to load team standings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      loadData();
    }
  }, []);

  // 60-second auto refresh per Task 2
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          loadData();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const getRankBadge = (index: number) => {
    if (index === 0) {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)",
          color: "#000",
          fontWeight: 800,
          boxShadow: "0 0 12px rgba(251, 191, 36, 0.6)",
        }}>
          1
        </span>
      );
    }
    if (index === 1) {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%)",
          color: "#000",
          fontWeight: 800,
          boxShadow: "0 0 10px rgba(148, 163, 184, 0.5)",
        }}>
          2
        </span>
      );
    }
    if (index === 2) {
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #b45309 0%, #d97706 100%)",
          color: "#fff",
          fontWeight: 800,
        }}>
          3
        </span>
      );
    }
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        background: "#1e293b",
        color: "#94a3b8",
        fontWeight: 700,
      }}>
        {index + 1}
      </span>
    );
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      {/* Page Header with auto-refresh counter */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "1rem",
        marginBottom: "1.5rem",
      }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.03em", color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Trophy size={28} color="#38bdf8" /> Team Leaderboard
          </h1>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Real-time standings across all 5 competing teams with member breakdown & bonus points
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#94a3b8", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span>Updated: <strong style={{ color: "#f8fafc" }}>{lastRefreshed.toLocaleTimeString()}</strong></span>
            <span>•</span>
            <span>Auto-refreshes in <strong style={{ color: "#38bdf8", fontFamily: "var(--font-mono)" }}>{countdown}s</strong></span>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="btn btn-secondary"
            style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "rgba(244, 63, 94, 0.15)", border: "1px solid rgba(244, 63, 94, 0.4)", borderRadius: "8px", color: "#fda4af", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {/* Main Table / Cards */}
      <div className="glass-panel" style={{ overflow: "hidden", marginBottom: "2rem" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "rgba(30, 41, 59, 0.7)", borderBottom: "1px solid #334155", color: "#94a3b8", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.05em" }}>
                <th style={{ padding: "0.85rem 1rem", width: "60px" }}>Rank</th>
                <th style={{ padding: "0.85rem 1rem" }}>Team</th>
                <th style={{ padding: "0.85rem 1rem", textAlign: "center" }}>Members</th>
                <th style={{ padding: "0.85rem 1rem", textAlign: "center" }}>PRs (Merged / Total)</th>
                <th style={{ padding: "0.85rem 1rem", textAlign: "right" }}>Raw Points</th>
                <th style={{ padding: "0.85rem 1rem", textAlign: "right" }}>Capped Base</th>
                <th style={{ padding: "0.85rem 1rem", textAlign: "right" }}>Bonuses</th>
                <th style={{ padding: "0.85rem 1.25rem", textAlign: "right", color: "#38bdf8" }}>Grand Total</th>
                <th style={{ padding: "0.85rem 1rem", width: "50px" }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: "3rem 1rem", textAlign: "center", color: "#94a3b8" }}>
                    Loading team standings...
                  </td>
                </tr>
              ) : teams.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "3rem 1rem", textAlign: "center", color: "#94a3b8" }}>
                    No team standings recorded yet.
                  </td>
                </tr>
              ) : (
                teams.map((t, idx) => {
                  const isExpanded = expandedTeam === t.team;
                return (
                  <React.Fragment key={t.team}>
                    <tr
                      onClick={() => setExpandedTeam(isExpanded ? null : t.team)}
                      style={{
                        borderBottom: "1px solid #1e293b",
                        cursor: "pointer",
                        background: idx === 0 ? "rgba(56, 189, 248, 0.05)" : undefined,
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(30, 41, 59, 0.5)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = idx === 0 ? "rgba(56, 189, 248, 0.05)" : "transparent")}
                    >
                      <td style={{ padding: "1rem", textAlign: "center" }}>
                        {getRankBadge(idx)}
                      </td>
                      <td style={{ padding: "1rem" }}>
                        <div style={{ fontWeight: 800, fontSize: "1rem", color: "#f8fafc" }}>
                          {t.teamName}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          ID: {t.team}
                        </div>
                      </td>
                      <td style={{ padding: "1rem", textAlign: "center", color: "#cbd5e1" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                          <Users size={14} color="#94a3b8" /> {t.members?.length || 9}
                        </span>
                      </td>
                      <td style={{ padding: "1rem", textAlign: "center", fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "#34d399", fontWeight: 700 }}>{t.mergedPrs}</span>
                        <span style={{ color: "#64748b" }}> / {t.totalPrs}</span>
                      </td>
                      <td style={{ padding: "1rem", textAlign: "right", fontFamily: "var(--font-mono)", color: "#94a3b8" }}>
                        {t.members ? t.members.reduce((acc: number, m: MemberScore) => acc + m.raw, 0) : t.challengeTotal} pts
                      </td>
                      <td style={{ padding: "1rem", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#e2e8f0" }}>
                        {t.challengeTotal} pts
                      </td>
                      <td style={{ padding: "1rem", textAlign: "right" }}>
                        {t.bonuses && t.bonuses.totalBonus > 0 ? (
                          <span style={{ color: "#fbbf24", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                            +{t.bonuses.totalBonus} pts
                          </span>
                        ) : (
                          <span style={{ color: "#64748b" }}>0</span>
                        )}
                      </td>
                      <td style={{ padding: "1rem 1.25rem", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "1.15rem", color: "#38bdf8" }}>
                        {t.grandTotal}
                      </td>
                      <td style={{ padding: "1rem", textAlign: "center", color: "#64748b" }}>
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </td>
                    </tr>

                    {/* Expanded Member Breakdown */}
                    {isExpanded && t.members && t.members.length > 0 && (
                      <tr style={{ background: "rgba(15, 23, 42, 0.95)" }}>
                        <td colSpan={9} style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #334155" }}>
                          <div style={{ marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {t.teamName} — Member Breakdown ({t.members.length} participants)
                            </h4>
                            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                              Tier Cap: 60 pts (Tech) • 80 pts (General)
                            </span>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
                            {t.members.map((m: MemberScore) => {
                              const isCapHit = m.raw >= m.tierCap;
                              return (
                                <div
                                  key={m.memberId}
                                  style={{
                                    padding: "0.75rem",
                                    borderRadius: "8px",
                                    background: "#1e293b",
                                    border: isCapHit ? "1px solid rgba(244, 63, 94, 0.4)" : "1px solid #334155",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                                    <div>
                                      <strong style={{ color: "#f8fafc", fontSize: "0.85rem" }}>{m.displayName || m.githubLogin}</strong>
                                      <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>@{m.githubLogin} • {m.department}</div>
                                    </div>
                                    <span className={`badge badge-${m.tier}`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>
                                      {m.tier}
                                    </span>
                                  </div>

                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                                    <span style={{ color: "#94a3b8" }}>PRs: <strong style={{ color: "#34d399" }}>{m.mergedPrs}</strong> merged</span>
                                    <span>
                                      Score: <strong style={{ color: isCapHit ? "#fb7185" : "#38bdf8" }}>{m.capped}</strong>
                                      <span style={{ color: "#64748b" }}> / {m.tierCap}</span>
                                    </span>
                                  </div>

                                  {isCapHit && (
                                    <div style={{ marginTop: "0.4rem", fontSize: "0.65rem", color: "#fda4af", fontWeight: 600 }}>
                                      ★ TIER CAP REACHED ({m.raw} raw)
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bonus Summary Card (§ 2.6) */}
      <div className="glass-panel" style={{ padding: "1.25rem", borderRadius: "12px", background: "rgba(15, 23, 42, 0.6)" }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f8fafc", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles size={18} color="#fbbf24" /> Official Team Bonus Rules (§ 2.6)
        </h3>
        <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
          Team bonuses are applied at final standings and are derived directly from aggregate performance:
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", fontSize: "0.8rem" }}>
          <div style={{ padding: "0.75rem", background: "#1e293b", borderRadius: "8px", border: "1px solid #334155" }}>
            <strong style={{ color: "#fbbf24" }}>Winner (+20 pts)</strong>
            <p style={{ color: "#94a3b8", marginTop: "0.25rem" }}>Awarded to the team with the highest base challenge score total.</p>
          </div>
          <div style={{ padding: "0.75rem", background: "#1e293b", borderRadius: "8px", border: "1px solid #334155" }}>
            <strong style={{ color: "#cbd5e1" }}>Runner-up (+15 pts)</strong>
            <p style={{ color: "#94a3b8", marginTop: "0.25rem" }}>Awarded to the team with the 2nd highest base challenge score.</p>
          </div>
          <div style={{ padding: "0.75rem", background: "#1e293b", borderRadius: "8px", border: "1px solid #334155" }}>
            <strong style={{ color: "#38bdf8" }}>Most Participation (+15 pts)</strong>
            <p style={{ color: "#94a3b8", marginTop: "0.25rem" }}>Awarded to the team with the highest distinct member PR merge count.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
