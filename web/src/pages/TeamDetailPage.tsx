import React, { useState, useEffect } from "react";
import { TeamDetailResponse, UserAuth } from "../types.js";
import { fetchTeamDetail } from "../api.js";
import { Countdown } from "../components/Countdown.js";
import { Users, Clock, GitPullRequest, Shield, ArrowLeft, CheckCircle2 } from "lucide-react";

export const TeamDetailPage: React.FC<{
  team: string;
  user: UserAuth | null;
  initialData?: TeamDetailResponse;
  onBack?: () => void;
}> = ({ team, user, initialData, onBack }) => {
  const [data, setData] = useState<TeamDetailResponse | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialData && user) {
      loadTeam();
    }
  }, [team, user]);

  const loadTeam = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTeamDetail(team);
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load team activity");
    } finally {
      setLoading(false);
    }
  };

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
            Authentication Required
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", maxWidth: "480px", margin: "0 auto 1.5rem" }}>
            Please log in with GitHub to view real-time team breakdowns, member claims, and PR progress.
          </p>
          <a href="/auth/github" className="btn btn-primary" style={{ padding: "0.6rem 1.25rem" }}>
            <span>Login with GitHub</span>
          </a>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ maxWidth: "1200px", margin: "4rem auto", textAlign: "center", color: "#94a3b8" }}>
        Loading team details...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ maxWidth: "1200px", margin: "4rem auto", padding: "1rem", color: "#fda4af" }}>
        {error || "Unable to load team activity."}
      </div>
    );
  }

  const { teamName, challengeTotal, totalPrs, mergedPrs, rollup, members } = data;

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1300px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      {/* Navigation & Header */}
      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={onBack ? onBack : () => { window.history.pushState({}, "", "/"); window.location.href = "/"; }}
          className="btn btn-secondary"
          style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem", display: "inline-flex", alignItems: "center", gap: "0.4rem", marginBottom: "1rem" }}
        >
          <ArrowLeft size={14} />
          <span>Back to Leaderboard</span>
        </button>
      </div>

      <div className="glass-panel" style={{ padding: "1.5rem", marginBottom: "1.5rem", background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.8) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Users size={24} color="#38bdf8" /> Team {teamName}
              </h1>
              <span className="badge" style={{ background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155" }}>
                ID: {data.team}
              </span>
            </div>
            <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Live member breakdown, active claim countdowns, and PR audit for {teamName}
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Base Points</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#38bdf8", fontFamily: "var(--font-mono)" }}>
                {challengeTotal} pts
              </div>
            </div>
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Merged PRs</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#34d399", fontFamily: "var(--font-mono)" }}>
                {mergedPrs} of {totalPrs}
              </div>
            </div>
            <div style={{ padding: "0.5rem 0.85rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase" }}>Active Claims</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fbbf24", fontFamily: "var(--font-mono)" }}>
                {rollup.activeClaims.total}
              </div>
            </div>
          </div>
        </div>

        {/* Team Rollup by Level */}
        <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid #334155" }}>
          <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#cbd5e1", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Team Rollup by Level
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
            <div style={{ padding: "0.75rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.25rem" }}>Active Claims Held</div>
              <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "#34d399" }}>Easy: {rollup.activeClaims.easy}</span>
                <span>•</span>
                <span style={{ color: "#38bdf8" }}>Med: {rollup.activeClaims.medium}</span>
                <span>•</span>
                <span style={{ color: "#fb7185" }}>Hard: {rollup.activeClaims.hard}</span>
              </div>
            </div>
            <div style={{ padding: "0.75rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.25rem" }}>Pull Requests Raised</div>
              <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "#34d399" }}>Easy: {rollup.prs.easy}</span>
                <span>•</span>
                <span style={{ color: "#38bdf8" }}>Med: {rollup.prs.medium}</span>
                <span>•</span>
                <span style={{ color: "#fb7185" }}>Hard: {rollup.prs.hard}</span>
              </div>
            </div>
            <div style={{ padding: "0.75rem", background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "0.25rem" }}>PRs Merged (Scored)</div>
              <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "#34d399" }}>Easy: {rollup.mergedPrs.easy}</span>
                <span>•</span>
                <span style={{ color: "#38bdf8" }}>Med: {rollup.mergedPrs.medium}</span>
                <span>•</span>
                <span style={{ color: "#fb7185" }}>Hard: {rollup.mergedPrs.hard}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Member Cards Breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Users size={18} color="#38bdf8" /> Team Members ({members.length})
        </h2>

        {members.map((m) => {
          const isCapHit = m.raw >= m.member.tierCap;
          return (
            <div key={m.member.id} className="glass-panel" style={{ padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f8fafc" }}>
                      {m.member.displayName || m.member.githubLogin}
                    </h3>
                    <a href={`https://github.com/${m.member.githubLogin}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem", color: "#38bdf8", textDecoration: "none" }}>
                      @{m.member.githubLogin}
                    </a>
                    <span className={`badge badge-${m.member.tier}`}>{m.member.tier} tier</span>
                    <span className="badge" style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }}>
                      {m.member.department}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ padding: "0.35rem 0.6rem", background: "#0f172a", borderRadius: "6px", border: "1px solid #334155", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "#94a3b8" }}>Score: </span>
                    <strong style={{ color: isCapHit ? "#fb7185" : "#38bdf8" }}>{m.capped}</strong>
                    <span style={{ color: "#64748b" }}> / {m.member.tierCap}</span>
                  </div>
                  <div style={{ padding: "0.35rem 0.6rem", background: "#0f172a", borderRadius: "6px", border: "1px solid #334155", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "#94a3b8" }}>Potential: </span>
                    <strong style={{ color: m.potentialPoints >= m.member.tierCap ? "#c084fc" : "#e2e8f0" }}>{m.potentialPoints}</strong>
                  </div>
                  <div style={{ padding: "0.35rem 0.6rem", background: "#0f172a", borderRadius: "6px", border: "1px solid #334155", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "#94a3b8" }}>PRs: </span>
                    <strong style={{ color: "#34d399" }}>{m.mergedPrs}</strong>
                    <span style={{ color: "#64748b" }}> / {m.totalPrs}</span>
                  </div>
                </div>
              </div>

              {/* Active Claims */}
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <Clock size={13} color="#fbbf24" /> Active Claims ({m.activeClaims.length})
                </div>
                {m.activeClaims.length === 0 ? (
                  <div style={{ fontSize: "0.8rem", color: "#64748b", fontStyle: "italic" }}>No active claims held.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.5rem" }}>
                    {m.activeClaims.map((c) => (
                      <div key={c.id} style={{ padding: "0.6rem 0.75rem", background: "#0f172a", borderRadius: "6px", border: "1px solid #1e293b" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.4rem" }}>
                          <div>
                            <div style={{ fontSize: "0.7rem", color: "#64748b", fontFamily: "var(--font-mono)" }}>
                              {c.repo} • #{c.issueNumber}
                            </div>
                            <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f8fafc" }}>{c.title}</div>
                          </div>
                          <span className={`badge badge-${c.level}`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>
                            {c.level}
                          </span>
                        </div>
                        <div style={{ marginTop: "0.4rem", paddingTop: "0.3rem", borderTop: "1px solid #1e293b", fontSize: "0.7rem", color: "#94a3b8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Remaining:</span>
                          <Countdown deadline={c.deadline} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pull Requests */}
              <div>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <GitPullRequest size={13} color="#34d399" /> Pull Requests ({m.prs.length})
                </div>
                {m.prs.length === 0 ? (
                  <div style={{ fontSize: "0.8rem", color: "#64748b", fontStyle: "italic" }}>No pull requests raised yet.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.5rem" }}>
                    {m.prs.map((pr) => (
                      <div key={pr.id} style={{ padding: "0.6rem 0.75rem", background: "#0f172a", borderRadius: "6px", border: "1px solid #1e293b" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.4rem" }}>
                          <div>
                            <div style={{ fontSize: "0.7rem", color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                              PR #{pr.prNumber} • Issue #{pr.linkedIssueNumber}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{pr.repo}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span className={`badge badge-${pr.level}`} style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>
                              {pr.level}
                            </span>
                            <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#38bdf8", fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
                              +{pr.points} pts
                            </div>
                          </div>
                        </div>
                        <div style={{ marginTop: "0.4rem", paddingTop: "0.3rem", borderTop: "1px solid #1e293b", fontSize: "0.7rem" }}>
                          {pr.merged ? (
                            <span style={{ color: "#34d399", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                              <CheckCircle2 size={11} /> Merged
                            </span>
                          ) : (
                            <span style={{ color: "#fbbf24", fontWeight: 600 }}>
                              Raised (Awaiting Merge)
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
