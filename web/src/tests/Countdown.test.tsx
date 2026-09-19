import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Countdown } from "../components/Countdown.js";

describe("Countdown Component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders active countdown when deadline is in the future", () => {
    const now = new Date("2026-09-19T12:00:00Z").getTime();
    vi.setSystemTime(now);

    // Deadline 4 hours in future
    const deadline = new Date("2026-09-19T16:00:00Z").toISOString();
    render(<Countdown deadline={deadline} />);

    expect(screen.getByTestId("countdown-active")).toBeInTheDocument();
    expect(screen.getByText(/04h 00m 00s/i)).toBeInTheDocument();
  });

  it("ticks down accurately over time", () => {
    const now = new Date("2026-09-19T12:00:00Z").getTime();
    vi.setSystemTime(now);

    const deadline = new Date("2026-09-19T12:05:00Z").toISOString();
    render(<Countdown deadline={deadline} />);

    expect(screen.getByText(/00h 05m 00s/i)).toBeInTheDocument();

    // Advance 65 seconds
    act(() => {
      vi.advanceTimersByTime(65000);
    });

    expect(screen.getByText(/00h 03m 55s/i)).toBeInTheDocument();
  });

  it("displays critical indicator when deadline is under 30 minutes away", () => {
    const now = new Date("2026-09-19T12:00:00Z").getTime();
    vi.setSystemTime(now);

    const deadline = new Date("2026-09-19T12:20:00Z").toISOString();
    render(<Countdown deadline={deadline} />);

    expect(screen.getByText(/Critical/i)).toBeInTheDocument();
    expect(screen.getByText(/00h 20m 00s/i)).toBeInTheDocument();
  });

  it("displays Expired when deadline is in the past", () => {
    const now = new Date("2026-09-19T12:00:00Z").getTime();
    vi.setSystemTime(now);

    const pastDeadline = new Date("2026-09-19T11:59:00Z").toISOString();
    render(<Countdown deadline={pastDeadline} />);

    expect(screen.getByTestId("countdown-expired")).toBeInTheDocument();
    expect(screen.getByText(/Expired/i)).toBeInTheDocument();
  });
});
