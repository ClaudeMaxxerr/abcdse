import React from "react";
import { Info, AlertTriangle, ShieldCheck, Flame } from "lucide-react";

interface RuleNoticeProps {
  type: "tech-easy-ban" | "easy-cap" | "general-hard-cap" | "active-claims" | "same-team" | "no-edits" | "expiry-ban" | "cap-eligibility" | "general-info";
  customText?: string;
}

export const RuleNotice: React.FC<RuleNoticeProps> = ({ type, customText }) => {
  switch (type) {
    case "cap-eligibility":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(168, 85, 247, 0.1)",
          border: "1px solid rgba(168, 85, 247, 0.3)",
          color: "#e9d5ff",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#c084fc" }} />
          <div>
            <strong>Tier Cap Claim Guard:</strong> You cannot claim new issues once your existing PRs cover your tier cap. A +1 claim buffer is allowed to protect against single review rejections.
          </div>
        </div>
      );
    case "general-hard-cap":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(251, 146, 60, 0.1)",
          border: "1px solid rgba(251, 146, 60, 0.3)",
          color: "#fed7aa",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <Info size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#fb923c" }} />
          <div>
            <strong>Hard Cap (3 Max):</strong> General tier participants may claim a lifetime maximum of 3 Hard issues. Medium issues remain open (3 Easy + 4 Medium reaches the 80-pt cap).
          </div>
        </div>
      );
    case "tech-easy-ban":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(244, 63, 94, 0.1)",
          border: "1px solid rgba(244, 63, 94, 0.3)",
          color: "#fda4af",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#f43f5e" }} />
          <div>
            <strong>Technical Tier Rule (§ 2.2):</strong> Technical department members are strictly forbidden from claiming Easy issues. Only Medium and Hard issues score points for your tier.
          </div>
        </div>
      );

    case "easy-cap":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(251, 191, 36, 0.1)",
          border: "1px solid rgba(251, 191, 36, 0.3)",
          color: "#fde68a",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <Info size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#fbbf24" }} />
          <div>
            <strong>Easy Cap (3 Max):</strong> General tier participants can claim a lifetime maximum of 3 Easy issues throughout the entire competition.
          </div>
        </div>
      );

    case "active-claims":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(56, 189, 248, 0.1)",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          color: "#bae6fd",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#38bdf8" }} />
          <div>
            <strong>Active Claim Limit (2 Max):</strong> You may hold at most 2 active claims simultaneously. Opening a Pull Request linking to the issue frees a slot immediately.
          </div>
        </div>
      );

    case "same-team":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(129, 140, 248, 0.1)",
          border: "1px solid rgba(129, 140, 248, 0.3)",
          color: "#c7d2fe",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <Flame size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#818cf8" }} />
          <div>
            <strong>Team Collision (§ 9.9):</strong> Two members of the <em>same team</em> cannot claim the same Medium or Hard issue. If a teammate holds a spot, your claim will be waitlisted.
          </div>
        </div>
      );

    case "no-edits":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          color: "#fca5a5",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#ef4444" }} />
          <div>
            <strong>Comment-Edit Exploit Guard (§ 9.4):</strong> Never edit your claim comment on GitHub. Edited comments are automatically and permanently rejected by the bot. Post a new comment instead.
          </div>
        </div>
      );

    case "expiry-ban":
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(244, 63, 94, 0.1)",
          border: "1px solid rgba(244, 63, 94, 0.3)",
          color: "#fda4af",
          fontSize: "0.8rem",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: "2px", color: "#f43f5e" }} />
          <div>
            <strong>Expiry Penalty:</strong> If your 48-hour claim deadline expires without an opened PR, you can never claim this specific issue again.
          </div>
        </div>
      );

    default:
      return (
        <div style={{
          padding: "0.6rem 0.85rem",
          borderRadius: "8px",
          background: "rgba(30, 41, 59, 0.6)",
          border: "1px solid #334155",
          color: "#cbd5e1",
          fontSize: "0.8rem",
        }}>
          {customText}
        </div>
      );
  }
};
