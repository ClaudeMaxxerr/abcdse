import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CapProgressBar } from "../components/CapProgressBar.js";

describe("CapProgressBar Component", () => {
  it("renders correctly for technical tier member below cap", () => {
    render(<CapProgressBar raw={35} capped={35} tierCap={60} tier="tech" />);
    
    // Tech cap is 60
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("/ 60 max")).toBeInTheDocument();
    expect(screen.queryByTestId("cap-hit-badge")).not.toBeInTheDocument();
  });

  it("renders correctly for general tier member below cap", () => {
    render(<CapProgressBar raw={50} capped={50} tierCap={80} tier="general" />);
    
    // General cap is 80
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("/ 80 max")).toBeInTheDocument();
    expect(screen.queryByTestId("cap-hit-badge")).not.toBeInTheDocument();
  });

  it("displays prominent Tier Cap Reached badge when member reaches or exceeds cap", () => {
    render(<CapProgressBar raw={60} capped={60} tierCap={60} tier="tech" />);
    
    expect(screen.getByTestId("cap-hit-badge")).toBeInTheDocument();
    expect(screen.getByText(/Tier Cap Reached \(60 pts\)/i)).toBeInTheDocument();
  });

  it("shows explanatory warning when raw points hit the cap", () => {
    render(<CapProgressBar raw={95} capped={60} tierCap={60} tier="tech" showDetails={true} />);
    
    expect(screen.getByTestId("cap-hit-badge")).toBeInTheDocument();
    expect(screen.getByText(/You have reached your/i)).toBeInTheDocument();
    expect(screen.getByText(/TECH tier ceiling \(60 pts\)/i)).toBeInTheDocument();
  });

  it("shows near cap warning when points are within 15 points of cap", () => {
    render(<CapProgressBar raw={50} capped={50} tierCap={60} tier="tech" />);
    
    expect(screen.getByText(/Near Cap \(10 pts left\)/i)).toBeInTheDocument();
  });
});
