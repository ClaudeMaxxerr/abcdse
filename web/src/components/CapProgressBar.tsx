import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface CapProgressBarProps {
  raw: number;
  tierCap: number;
  capped: number;
  tier: "tech" | "general";
  showDetails?: boolean;
}

export const CapProgressBar: React.FC<CapProgressBarProps> = ({
  raw,
  tierCap,
  capped,
  tier,
  showDetails = true,
}) => {
  const percentage = Math.min(100, Math.round((raw / tierCap) * 100));
  const isCapHit = raw >= tierCap;
  const isNearCap = !isCapHit && raw >= tierCap - 15;

  return (
    <div data-testid="cap-progress-container" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f8fafc" }}>
            Score: <span style={{ color: "#38bdf8", fontSize: "1rem" }}>{capped}</span>
            <span style={{ color: "#94a3b8", fontSize: "0.8rem", fontWeight: 500 }}> / {tierCap} max</span>
          </span>
          {isCapHit && (
            <span
              data-testid="cap-hit-badge"
              className="badge badge-cap-hit"
              style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
            >
              <CheckCircle2 size={12} /> Tier Cap Reached ({tierCap} pts)
            </span>
          )}
          {isNearCap && (
            <span style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", background: "rgba(251, 191, 36, 0.2)", color: "#fbbf24", borderRadius: "9999px", border: "1px solid rgba(251, 191, 36, 0.4)" }}>
              <AlertCircle size={12} /> Near Cap ({tierCap - raw} pts left)
            </span>
          )}
        </div>

        {showDetails && (
          <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
            Raw Total: <strong style={{ color: "#cbd5e1" }}>{raw} pts</strong> • Cap: <strong style={{ color: "#a5b4fc" }}>{tierCap} pts ({tier})</strong>
          </div>
        )}
      </div>

      {/* Progress Track */}
      <div style={{
        width: "100%",
        height: "8px",
        background: "#1e293b",
        borderRadius: "9999px",
        overflow: "hidden",
        position: "relative",
      }}>
        <div
          data-testid="cap-progress-bar"
          style={{
            width: `${percentage}%`,
            height: "100%",
            borderRadius: "9999px",
            background: isCapHit
              ? "linear-gradient(90deg, #f43f5e 0%, #fb7185 100%)"
              : isNearCap
              ? "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)"
              : "linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)",
            boxShadow: isCapHit
              ? "0 0 10px rgba(244, 63, 94, 0.5)"
              : "0 0 10px rgba(56, 189, 248, 0.5)",
            transition: "width 0.5s ease-in-out",
          }}
        />
      </div>

      {isCapHit && showDetails && (
        <div style={{
          marginTop: "0.5rem",
          fontSize: "0.75rem",
          color: "#fda4af",
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
        }}>
          <AlertCircle size={13} />
          <span>
            You have reached your <strong>{tier.toUpperCase()} tier ceiling ({tierCap} pts)</strong>. Subsequent merged PRs will not add to your personal capped score, but will still contribute toward your team&apos;s participation and bonus contention!
          </span>
        </div>
      )}
    </div>
  );
};
