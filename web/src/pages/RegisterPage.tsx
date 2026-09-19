import React, { useState } from "react";
import { Department, Team } from "../types.js";
import { completeRegistration } from "../api.js";
import { Shield } from "lucide-react";

export const RegisterPage: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [department, setDepartment] = useState<Department>("pr");
  const [team, setTeam] = useState<Team>("NEXUS");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      const ok = await completeRegistration(department, team);
      if (ok) {
        onComplete();
      } else {
        setError("Failed to complete registration. Please try again.");
      }
    } catch (err: any) {
      setError(err.message || "Registration error");
    } finally {
      setSubmitting(false);
    }
  };

  const isTechDept = department === "technical";

  return (
    <div className="animate-fade-in" style={{ maxWidth: "540px", margin: "3rem auto", padding: "1.5rem" }}>
      <div className="glass-panel" style={{ padding: "2rem" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
            boxShadow: "0 0 15px rgba(56, 189, 248, 0.4)",
          }}>
            <Shield size={24} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f8fafc" }}>
            Complete Registration
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "0.25rem" }}>
            Welcome to Patch Wars 2026! Select your society department and assigned team to begin.
          </p>
        </div>

        {error && (
          <div style={{ padding: "0.75rem 1rem", background: "rgba(244, 63, 94, 0.15)", border: "1px solid rgba(244, 63, 94, 0.4)", borderRadius: "8px", color: "#fda4af", fontSize: "0.85rem", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Department Selection */}
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#e2e8f0", marginBottom: "0.4rem" }}>
              Society Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as Department)}
              style={{
                width: "100%",
                padding: "0.6rem 0.75rem",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#f8fafc",
                fontSize: "0.9rem",
              }}
            >
              <option value="technical">Technical (60 pt cap)</option>
              <option value="pr">PR (80 pt cap)</option>
              <option value="research_and_development">Research &amp; Dev (80 pt cap)</option>
              <option value="event_management">Event Management (80 pt cap)</option>
              <option value="social_and_design">Social &amp; Design (80 pt cap)</option>
            </select>

            <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: isTechDept ? "#a5b4fc" : "#d8b4fe" }}>
              Tier derived server-side: <strong>{isTechDept ? "Technical Tier (60 pts ceiling, Easy issues banned)" : "General Tier (80 pts ceiling, max 3 Easy claims)"}</strong>
            </div>
          </div>

          {/* Team Selection */}
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#e2e8f0", marginBottom: "0.4rem" }}>
              Assigned Team
            </label>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value as Team)}
              style={{
                width: "100%",
                padding: "0.6rem 0.75rem",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#f8fafc",
                fontSize: "0.9rem",
              }}
            >
              <option value="NEXUS">Nexus</option>
              <option value="CIPHER">Cipher</option>
              <option value="BYTE_BRIGADE">Byte Brigade</option>
              <option value="ASCEND">Ascend</option>
              <option value="ECHO">Echo</option>
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary"
            style={{ width: "100%", padding: "0.75rem", fontSize: "0.95rem", marginTop: "0.5rem" }}
          >
            {submitting ? "Saving..." : "Complete Registration & Enter"}
          </button>
        </form>
      </div>
    </div>
  );
};
