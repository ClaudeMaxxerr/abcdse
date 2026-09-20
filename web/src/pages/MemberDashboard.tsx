import React, { useState, useEffect } from "react";
import { DashboardData, UserAuth, Department, Team } from "../types.js";
import { fetchDashboard, updateMemberProfile } from "../api.js";
import { CapProgressBar } from "../components/CapProgressBar.js";
import { Countdown } from "../components/Countdown.js";
import { RuleNotice } from "../components/RuleNotice.js";
import { Clock, CheckCircle2, GitPullRequest, Layers, LogIn, ExternalLink, Shield, Edit3, Check, X, Lock } from "lucide-react";

export const MemberDashboard: React.FC<{ user: UserAuth | null; initialData?: DashboardData }> = ({ user, initialData }) => {
  const [data, setData] = useState<DashboardData | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  // Profile editing state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editDept, setEditDept] = useState<Department>("technical");
  const [editTeam, setEditTeam] = useState<Team>("NEXUS");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
      if (res.member) {
        setEditDept(res.member.department);
        setEditTeam(res.member.team);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingProfile(true);
      setProfileMsg(null);
      await updateMemberProfile(editDept, editTeam);
      setProfileMsg({ type: "success", text: "Department & team updated successfully!" });
      setIsEditingProfile(false);
      await loadDashboard();
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err.message || "Failed to update profile" });
    } finally {
      setSavingProfile(false);
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
  const canEdit = member.canEditProfile === true || (member.canEditProfile === undefined && limits.activeClaimsCount === 0 && scoring.totalPrs === 0 && (data.historyClaims?.length ?? 0) === 0);

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

              {/* Edit button / lock badge */}
              {canEdit ? (
                !isEditingProfile && (
                  <button
                    onClick={() => {
                      setEditDept(member.department);
                      setEditTeam(member.team);
                      setIsEditingProfile(true);
                      setProfileMsg(null);
                    }}
                    className="btn btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", marginLeft: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                  >
                    <Edit3 size={12} />
                    <span>Edit Dept &amp; Team</span>
                  </button>
                )
              ) : (
                <span style={{ fontSize: "0.75rem", color: "#64748b", display: "inline-flex", alignItems: "center", gap: "0.3rem", marginLeft: "0.5rem" }}>
                  <Lock size={12} /> Locked (has claims/PRs)
                </span>
              )}
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

            {/* Potential Points */}
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Potential Points</div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: (scoring.potentialPoints ?? scoring.raw) >= scoring.tierCap ? "#c084fc" : "#38bdf8", fontFamily: "var(--font-mono)" }}>
                {scoring.potentialPoints ?? scoring.raw} / {scoring.tierCap}
              </div>
            </div>
          </div>
        </div>

        {/* Profile Edit Panel */}
        {isEditingProfile && (
          <form onSubmit={handleSaveProfile} style={{ marginTop: "1rem", padding: "1rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #38bdf8" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f8fafc", marginBottom: "0.75rem" }}>
              Correct Department &amp; Team (Allowed only with 0 claims and 0 PRs)
            </div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.3rem" }}>Department</label>
                <select
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value as Department)}
                  style={{ width: "100%", padding: "0.4rem 0.6rem", background: "#1e293b", border: "1px solid #334155", borderRadius: "6px", color: "#fff", fontSize: "0.85rem" }}
                >
                  <option value="technical">Technical (60 pt cap)</option>
                  <option value="pr">PR (80 pt cap)</option>
                  <option value="research_and_development">Research &amp; Dev (80 pt cap)</option>
                  <option value="event_management">Event Management (80 pt cap)</option>
                  <option value="social_and_design">Social &amp; Design (80 pt cap)</option>
                </select>
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.3rem" }}>Assigned Team</label>
                <select
                  value={editTeam}
                  onChange={(e) => setEditTeam(e.target.value as Team)}
                  style={{ width: "100%", padding: "0.4rem 0.6rem", background: "#1e293b", border: "1px solid #334155", borderRadius: "6px", color: "#fff", fontSize: "0.85rem" }}
                >
                  <option value="NEXUS">Nexus</option>
                  <option value="CIPHER">Cipher</option>
                  <option value="BYTE_BRIGADE">Byte Brigade</option>
                  <option value="ASCEND">Ascend</option>
                  <option value="ECHO">Echo</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="submit" disabled={savingProfile} className="btn btn-primary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}>
                  <Check size={14} />
                  <span>{savingProfile ? "Saving..." : "Save Changes"}</span>
                </button>
                <button type="button" onClick={() => setIsEditingProfile(false)} className="btn btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}>
                  <X size={14} />
                  <span>Cancel</span>
                </button>
              </div>
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: editDept === "technical" ? "#a5b4fc" : "#d8b4fe" }}>
              Tier derived server-side: <strong>{editDept === "technical" ? "Technical (60 pt cap)" : "General (80 pt cap)"}</strong>
            </div>
          </form>
        )}

        {profileMsg && (
          <div style={{
            marginTop: "0.75rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            fontSize: "0.8rem",
            background: profileMsg.type === "success" ? "rgba(52, 211, 153, 0.15)" : "rgba(244, 63, 94, 0.15)",
            border: profileMsg.type === "success" ? "1px solid rgba(52, 211, 153, 0.4)" : "1px solid rgba(244, 63, 94, 0.4)",
            color: profileMsg.type === "success" ? "#6ee7b7" : "#fda4af",
          }}>
            {profileMsg.text}
          </div>
        )}

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

      {/* Tier Cap Covered - Claiming Blocked Alert */}
      {limits.isClaimBlockedByCap && (
        <div style={{
          marginBottom: "1.5rem",
          padding: "1rem 1.25rem",
          background: "rgba(244, 63, 94, 0.15)",
          border: "1px solid rgba(244, 63, 94, 0.4)",
          borderRadius: "8px",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          color: "#fda4af",
        }}>
          <Shield size={20} style={{ flexShrink: 0, marginTop: "2px", color: "#f43f5e" }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#f8fafc", marginBottom: "0.25rem" }}>
              Claiming Blocked — Tier Cap Covered
            </div>
            <div style={{ fontSize: "0.85rem" }}>
              {limits.capCoveredBlockedReason || `Your existing pull requests already cover your ${scoring.tierCap}-point cap. You cannot claim more issues. Focus on the ones you have — quality decides which PRs are merged.`}
            </div>
          </div>
        </div>
      )}

      {/* Near Cap Potential Notice */}
      {!limits.isClaimBlockedByCap && (scoring.potentialPoints ?? 0) >= scoring.tierCap && (
        <div style={{
          marginBottom: "1.5rem",
          padding: "0.85rem 1.25rem",
          background: "rgba(168, 85, 247, 0.12)",
          border: "1px solid rgba(168, 85, 247, 0.35)",
          borderRadius: "8px",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          color: "#e9d5ff",
        }}>
          <Shield size={18} style={{ flexShrink: 0, marginTop: "2px", color: "#c084fc" }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#f8fafc", marginBottom: "0.2rem" }}>
              Cap Covered ({scoring.potentialPoints} Potential Pts)
            </div>
            <div style={{ fontSize: "0.8rem" }}>
              Your existing pull requests can reach the {scoring.tierCap}-point cap. You currently hold {limits.committedClaimsCount ?? 0} claims (max allowed: {limits.maxClaimsAllowed ?? 0}). Once you reach {limits.maxClaimsAllowed ?? 0} claims, new claims will be blocked. Focus on PR review quality!
            </div>
          </div>
        </div>
      )}

      {/* Proactive Rule Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {limits.isTech ? <RuleNotice type="tech-easy-ban" /> : <RuleNotice type="easy-cap" />}
        <RuleNotice type="cap-eligibility" />
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
