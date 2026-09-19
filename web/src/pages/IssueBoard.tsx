import React, { useState, useEffect, useMemo } from "react";
import { IssueItem, UserAuth } from "../types.js";
import { fetchIssues } from "../api.js";
import { Countdown } from "../components/Countdown.js";
import { CopyButton } from "../components/CopyButton.js";
import { RuleNotice } from "../components/RuleNotice.js";
import { Layers, ExternalLink, Search, Clock } from "lucide-react";

export const IssueBoard: React.FC<{ user: UserAuth | null; initialData?: IssueItem[] }> = ({ user, initialData }) => {
  const [issues, setIssues] = useState<IssueItem[]>(initialData || []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<string>("ALL");
  const [selectedLevel, setSelectedLevel] = useState<string>("ALL");
  const [selectedAvailability, setSelectedAvailability] = useState<string>("ALL"); // "ALL" | "AVAILABLE" | "WAITLIST" | "FULL"

  const isTechUser = user?.tier === "tech";

  useEffect(() => {
    if (!initialData) {
      loadData();
    }
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchIssues();
      setIssues(data);
    } catch (err: any) {
      setError(err.message || "Failed to load issues");
    } finally {
      setLoading(false);
    }
  };

  // Distinct repositories
  const repos = useMemo(() => {
    const set = new Set(issues.map((i) => i.repoName));
    return Array.from(set).sort();
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      // Repo filter
      if (selectedRepo !== "ALL" && issue.repoName !== selectedRepo) return false;

      // Level filter
      if (selectedLevel !== "ALL" && issue.level !== selectedLevel) return false;

      // Availability filter
      if (selectedAvailability === "AVAILABLE" && !issue.isAvailable) return false;
      if (selectedAvailability === "WAITLIST" && (issue.isAvailable || issue.waitlistCount === 0)) return false;
      if (selectedAvailability === "FULL" && issue.isAvailable) return false;

      // Search query (number, title, repo, claimants)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNum = issue.number.toString().includes(q);
        const matchTitle = issue.title.toLowerCase().includes(q);
        const matchRepo = issue.repoName.toLowerCase().includes(q);
        const matchClaimant = issue.claims.some(
          (c) => c.displayName.toLowerCase().includes(q) || c.githubLogin.toLowerCase().includes(q)
        );
        if (!matchNum && !matchTitle && !matchRepo && !matchClaimant) return false;
      }

      return true;
    });
  }, [issues, selectedRepo, selectedLevel, selectedAvailability, searchQuery]);

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.03em", color: "#f8fafc", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Layers size={28} color="#38bdf8" /> Issue Board
          </h1>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Explore verified open-source issues across all 6 repositories. Read-only board — comment on GitHub to claim!
          </p>
        </div>
      </div>

      {/* Surface Rule Warnings (§ 9.3, § 2.2, § 9.9) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {isTechUser ? (
          <RuleNotice type="tech-easy-ban" />
        ) : (
          <RuleNotice type="easy-cap" />
        )}
        <RuleNotice type="active-claims" />
        <RuleNotice type="same-team" />
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel" style={{ padding: "1rem", marginBottom: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={16} color="#64748b" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            placeholder="Search #number, title, repo, or claimant..."
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

        {/* Repository Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Repo:</span>
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL">All Repositories ({repos.length})</option>
            {repos.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* Level Filter with Technical Disable explanation */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Level:</span>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL">All Levels</option>
            <option value="easy" disabled={isTechUser}>Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        {/* Availability Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Status:</span>
          <select
            value={selectedAvailability}
            onChange={(e) => setSelectedAvailability(e.target.value)}
            style={{
              padding: "0.45rem 0.6rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              color: "#f8fafc",
              fontSize: "0.8rem",
            }}
          >
            <option value="ALL">All Availability</option>
            <option value="AVAILABLE">Available Now (Spots Left)</option>
            <option value="WAITLIST">Waitlist Open</option>
            <option value="FULL">Fully Claimed</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "rgba(244, 63, 94, 0.15)", border: "1px solid rgba(244, 63, 94, 0.4)", borderRadius: "8px", color: "#fda4af", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="glass-panel" style={{ padding: "3rem", textAlign: "center", color: "#94a3b8" }}>
          <div className="animate-spin" style={{ width: "24px", height: "24px", border: "2px solid #38bdf8", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 1rem" }} />
          Loading issues board...
        </div>
      ) : (
        /* Issues Grid / List */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "1rem" }}>
          {filteredIssues.length === 0 ? (
            <div className="glass-panel" style={{ gridColumn: "1 / -1", padding: "3rem", textAlign: "center", color: "#94a3b8" }}>
              No issues match your current filters.
            </div>
          ) : (
          filteredIssues.map((issue) => {
            const hasTechEasyBan = isTechUser && issue.level === "easy";
            const isUserTeamOccupying = user && issue.occupiedTeams.includes(user.team);

            return (
              <div
                key={issue.id}
                className="glass-panel"
                style={{
                  padding: "1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  borderLeft: issue.isAvailable
                    ? "4px solid #34d399"
                    : issue.waitlistCount > 0
                    ? "4px solid #fbbf24"
                    : "4px solid #64748b",
                  opacity: hasTechEasyBan ? 0.75 : 1,
                }}
              >
                {/* Header & Badges */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                      {issue.repoOwner}/<strong>{issue.repoName}</strong> • #{issue.number}
                    </div>
                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <span className={`badge badge-${issue.level}`}>
                        {issue.level}
                      </span>
                      {issue.isAvailable ? (
                        <span className="badge" style={{ background: "rgba(52, 211, 153, 0.15)", color: "#34d399", border: "1px solid rgba(52, 211, 153, 0.3)" }}>
                          {issue.spotsTotal - issue.spotsTaken} Spot{issue.spotsTotal - issue.spotsTaken > 1 ? "s" : ""} Left
                        </span>
                      ) : (
                        <span className="badge" style={{ background: "rgba(100, 116, 139, 0.2)", color: "#94a3b8", border: "1px solid #334155" }}>
                          Full ({issue.spotsTaken}/{issue.spotsTotal})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#f8fafc", lineHeight: 1.4, marginBottom: "0.5rem" }}>
                    {issue.title}
                  </h3>

                  {/* Rule warning badge if tech member viewing easy */}
                  {hasTechEasyBan && (
                    <div style={{ margin: "0.5rem 0", padding: "0.4rem 0.6rem", background: "rgba(244, 63, 94, 0.1)", border: "1px solid rgba(244, 63, 94, 0.3)", borderRadius: "6px", fontSize: "0.7rem", color: "#fda4af" }}>
                      ⚠ Technical members may not claim Easy issues (§ 2.2).
                    </div>
                  )}

                  {/* Same-team warning if user is logged in */}
                  {!hasTechEasyBan && isUserTeamOccupying && issue.level !== "easy" && (
                    <div style={{ margin: "0.5rem 0", padding: "0.4rem 0.6rem", background: "rgba(251, 191, 36, 0.1)", border: "1px solid rgba(251, 191, 36, 0.3)", borderRadius: "6px", fontSize: "0.7rem", color: "#fde68a" }}>
                      ⚠ Your team ({user?.team}) already has an active claim. You would be placed on the waitlist (§ 9.9).
                    </div>
                  )}

                  {/* Active Claimants & Deadlines */}
                  {issue.claims.length > 0 && (
                    <div style={{ marginTop: "0.75rem", borderTop: "1px solid #1e293b", paddingTop: "0.5rem" }}>
                      <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.35rem" }}>
                        Active Claims ({issue.claims.length}/{issue.spotsTotal}):
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                        {issue.claims.map((c) => (
                          <div
                            key={c.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: "0.75rem",
                              background: "#1e293b",
                              padding: "0.35rem 0.5rem",
                              borderRadius: "4px",
                            }}
                          >
                            <span style={{ color: "#cbd5e1" }}>
                              <strong>{c.displayName}</strong> <span style={{ color: "#64748b" }}>({c.team})</span>
                            </span>
                            <Countdown deadline={c.deadline} compact />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Waitlist count */}
                  {issue.waitlistCount > 0 && (
                    <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "#fbbf24", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <Clock size={12} /> {issue.waitlistCount} waiting in queue
                    </div>
                  )}
                </div>

                {/* Actions Footer */}
                <div style={{ borderTop: "1px solid #1e293b", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                  <CopyButton
                    textToCopy="Claiming this issue"
                    label="Copy Claim"
                    compact
                  />

                  <a
                    href={issue.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
                  >
                    <span>View on GitHub</span>
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>
      )}
    </div>
  );
};
