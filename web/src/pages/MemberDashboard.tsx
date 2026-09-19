import React, { useState, useEffect } from "react";
import { DashboardData, UserAuth } from "../types.js";
import { fetchDashboard } from "../api.js";
import { CapProgressBar } from "../components/CapProgressBar.js";
import { Countdown } from "../components/Countdown.js";
import { RuleNotice } from "../components/RuleNotice.js";
import { Clock, CheckCircle2, GitPullRequest, Layers, LogIn, ExternalLink, Shield } from "lucide-react";

export const MemberDashboard: React.FC<{ user: UserAuth | null; initialData?: DashboardData }> = ({ user, initialData }) => {
  const [data, setData] = useState<DashboardData | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialData && user) {
      loadDashboard();
    }
  }, [user]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDashboard();
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  // If not logged in and no initial mock data provided
  if (!user && !data) {
    return (
      <div className="animate-fade-in" style={{ maxWidth: "800px", margin: "4rem auto", padding: "2rem", textAlign: "center" }}>
        <div className="glass-panel" style={{ padding: "3rem 2rem" }}>
          <div style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "rgba(56, 189, 248, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.25rem",
          }}>
            <Shield size={28} color="#38bdf8" />
          </div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f8fafc", marginBottom: "0.5rem" }}>
            Member Dashboard Authentication
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", maxWidth: "480px", margin: "0 auto 1.5rem" }}>
            Please log in with your verified GitHub account to view your active claims, live countdowns, PR scoring against your tier cap, and waitlist positions.
          </p>
          <a href="/auth/github" className="btn btn-primary" style={{ padding: "0.6rem 1.25rem" }}>
            <LogIn size={16} />
            <span>Login with GitHub</span>
          </a>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ maxWidth: "1200px", margin: "4rem auto", textAlign: "center", color: "#94a3b8" }}>
        Loading dashboard metrics...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ maxWidth: "1200px", margin: "4rem auto", padding: "1rem", color: "#fda4af" }}>
        {error || "Unable to load dashboard."}
      </div>
    );
  }

  const { member, scoring, limits, activeClaims, waitlistEntries } = data;

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1300px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      {/* Participant Header */}
      <div className="glass-panel" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.7) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f8fafc" }}>
                {member.displayName || member.githubLogin}
              </h1>
              <span className={`badge badge-${member.tier}`}>{member.tier} tier</span>
              <span className="badge" style={{ background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155" }}>
                {member.team}
              </span>
              <span className="badge" style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }}>
                {member.department}
              </span>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              GitHub: <a href={`https://github.com/${member.githubLogin}`} target="_blank" rel="noreferrer" style={{ color: "#38bdf8", textDecoration: "none" }}>@{member.githubLogin}</a>
            </div>
          </div>

          {/* Quick Metrics Badges */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {/* Free active slots */}
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Active Slots</div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: limits.freeActiveSlots > 0 ? "#34d399" : "#f43f5e", fontFamily: "var(--font-mono)" }}>
                {limits.freeActiveSlots} of {limits.maxActiveSlots} Free
              </div>
            </div>

            {/* Easy remaining */}
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Easy Remaining</div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: limits.isTech ? "#64748b" : "#fbbf24", fontFamily: "var(--font-mono)" }}>
                {limits.isTech ? "0 (Tech Tier)" : `${limits.easyRemaining} / ${limits.maxEasyClaims}`}
              </div>
            </div>

            {/* PR stats */}
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Merged PRs</div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: "#38bdf8", fontFamily: "var(--font-mono)" }}>
                {scoring.mergedPrs} of {scoring.totalPrs}
              </div>
            </div>
          </div>
        </div>

        {/* Cap Progress Bar Component */}
        <div style={{ marginTop: "1.25rem" }}>
          <CapProgressBar
            raw={scoring.raw}
            tierCap={scoring.tierCap}
            capped={scoring.capped}
            tier={member.tier}
            showDetails={true}
          />
        </div>
      </div>

      {/* Proactive Rule Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {limits.isTech ? <RuleNotice type="tech-easy-ban" /> : <RuleNotice type="easy-cap" />}
        <RuleNotice type="active-claims" />
        <RuleNotice type="no-edits" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Section 1: Active Claims */}
        <div className="glass-panel" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Clock size={18} color="#38bdf8" /> Active Claims ({activeClaims.length}/2)
            </h2>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
              48-hour deadline per claim
            </span>
          </div>

          {activeClaims.length === 0 ? (
            <div data-testid="empty-active-claims" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", background: "#1e293b", borderRadius: "8px", border: "1px dashed #334155" }}>
              You currently have no active claims. Head over to the <strong style={{ color: "#38bdf8" }}>Issue Board</strong> to find available issues to claim!
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {activeClaims.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "0.85rem",
                    borderRadius: "8px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                        {c.repoName} • #{c.issueNumber}
                      </div>
                      <h4 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f8fafc", marginTop: "0.2rem" }}>
                        {c.issueTitle}
                      </h4>
                    </div>
                    <span className={`badge badge-${c.level}`}>
                      {c.level}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #334155", paddingTop: "0.5rem" }}>
                    <div>
                      <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>Time Remaining:</div>
                      <Countdown deadline={c.deadline} />
                    </div>

                    <a
                      href={c.githubUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-outline"
                      style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}
                    >
                      <span>Issue</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Active Waitlist Entries */}
        <div className="glass-panel" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Layers size={18} color="#fbbf24" /> Waitlist Positions ({waitlistEntries.length})
            </h2>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
              Auto-promoted on spot expiry
            </span>
          </div>

          {waitlistEntries.length === 0 ? (
            <div data-testid="empty-waitlist" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", background: "#1e293b", borderRadius: "8px", border: "1px dashed #334155" }}>
              You are not currently in any waiting queues.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {waitlistEntries.map((w) => (
                <div
                  key={w.id}
                  style={{
                    padding: "0.85rem",
                    borderRadius: "8px",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                      {w.repoName} • #{w.issueNumber}
                    </div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f8fafc" }}>
                      {w.issueTitle}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <span className="badge" style={{ background: "rgba(251, 191, 36, 0.15)", color: "#fbbf24", border: "1px solid rgba(251, 191, 36, 0.3)" }}>
                      Position #{w.queuePosition}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 3: PR Breakdown and Scoring Audit */}
      <div className="glass-panel" style={{ padding: "1.25rem", overflow: "hidden" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <GitPullRequest size={18} color="#34d399" /> Pull Requests & Scoring Breakdown ({scoring.prBreakdown?.length || 0})
        </h2>
        <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "1rem" }}>
          Derived point audit for all linked PRs. PR points sum to raw total ({scoring.raw} pts), which is capped at {scoring.tierCap} pts.
        </p>

        {(!scoring.prBreakdown || scoring.prBreakdown.length === 0) ? (
          <div data-testid="empty-prs" style={{ padding: "2.5rem", textAlign: "center", color: "#94a3b8", background: "#1e293b", borderRadius: "8px" }}>
            No pull requests recorded yet. Open a PR with <code style={{ color: "#38bdf8" }}>Fixes #issue_number</code> to start scoring points!
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#1e293b", borderBottom: "1px solid #334155", color: "#94a3b8", fontSize: "0.75rem", textTransform: "uppercase" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>PR Number</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Repository & Issue</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Level</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Points Awarded</th>
                </tr>
              </thead>
              <tbody>
                {scoring.prBreakdown.map((pr) => (
                  <tr key={pr.prId} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "0.85rem 1rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#38bdf8" }}>
                      #{pr.prNumber}
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ color: "#f8fafc", fontWeight: 600 }}>{pr.issueTitle}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{pr.repoName} • Issue #{pr.issueNumber}</div>
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <span className={`badge badge-${pr.level}`}>{pr.level}</span>
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      {pr.status === "merged" ? (
                        <span style={{ color: "#34d399", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                          <CheckCircle2 size={13} /> Merged
                        </span>
                      ) : (
                        <span style={{ color: "#fbbf24", fontWeight: 600 }}>
                          Raised (Awaiting Merge)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "0.85rem 1rem", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 800, color: "#38bdf8", fontSize: "0.95rem" }}>
                      +{pr.pointsAwarded} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
