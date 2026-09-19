import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  textToCopy: string;
  label?: string;
  compact?: boolean;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  textToCopy,
  label = "Copy Claim Text",
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback
        const el = document.createElement("textarea");
        el.value = textToCopy;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      className={copied ? "btn btn-secondary" : "btn btn-outline"}
      style={{
        fontSize: compact ? "0.75rem" : "0.8rem",
        padding: compact ? "0.25rem 0.5rem" : "0.35rem 0.75rem",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        color: copied ? "#34d399" : undefined,
        borderColor: copied ? "rgba(52, 211, 153, 0.4)" : undefined,
      }}
      title={`Copy exact text: "${textToCopy}"`}
    >
      {copied ? <Check size={13} color="#34d399" /> : <Copy size={13} />}
      <span>{copied ? "Copied!" : label}</span>
    </button>
  );
};
