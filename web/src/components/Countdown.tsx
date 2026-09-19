import React, { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";

interface CountdownProps {
  deadline: string; // ISO date string
  compact?: boolean;
}

export const Countdown: React.FC<CountdownProps> = ({ deadline, compact = false }) => {
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(deadline));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(deadline));
    }, 1000);

    return () => clearInterval(timer);
  }, [deadline]);

  function calculateTimeLeft(targetIso: string) {
    const totalMs = new Date(targetIso).getTime() - Date.now();
    if (totalMs <= 0) {
      return { totalMs: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
    }

    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

    return { totalMs, hours, minutes, seconds, isExpired: false };
  }

  if (timeLeft.isExpired) {
    return (
      <span
        data-testid="countdown-expired"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          color: "#f43f5e",
          fontSize: compact ? "0.75rem" : "0.85rem",
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
        }}
      >
        <AlertTriangle size={14} /> Expired
      </span>
    );
  }

  // Near zero indicators (< 2 hours amber, < 30 mins pulsing red)
  const isCritical = timeLeft.totalMs < 30 * 60 * 1000;
  const isUrgent = timeLeft.totalMs < 2 * 60 * 60 * 1000;

  const color = isCritical ? "#f43f5e" : isUrgent ? "#fbbf24" : "#38bdf8";

  const formatted = `${String(timeLeft.hours).padStart(2, "0")}h ${String(timeLeft.minutes).padStart(2, "0")}m ${String(timeLeft.seconds).padStart(2, "0")}s`;

  return (
    <span
      data-testid="countdown-active"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        color,
        fontSize: compact ? "0.75rem" : "0.85rem",
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
      }}
      title={`Deadline: ${new Date(deadline).toLocaleString()}`}
    >
      <Clock size={13} />
      <span>{formatted}</span>
      {isCritical && (
        <span style={{ fontSize: "0.65rem", padding: "0.1rem 0.3rem", background: "rgba(244, 63, 94, 0.2)", borderRadius: "4px", color: "#fb7185" }}>
          Critical
        </span>
      )}
    </span>
  );
};
