import { useState, useEffect } from "react";
import { UserAuth } from "./types.js";
import { fetchAuthMe, postLogout } from "./api.js";
import { Header } from "./components/Header.js";
import { TeamLeaderboard } from "./pages/TeamLeaderboard.js";
import { MemberLeaderboard } from "./pages/MemberLeaderboard.js";
import { IssueBoard } from "./pages/IssueBoard.js";
import { MemberDashboard } from "./pages/MemberDashboard.js";
import { RegisterPage } from "./pages/RegisterPage.js";

export function App() {
  const [activeTab, setActiveTab] = useState<"teams" | "members" | "issues" | "dashboard">("teams");
  const [user, setUser] = useState<UserAuth | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    // Check current path or default
    const path = window.location.pathname;
    if (path.includes("members")) setActiveTab("members");
    else if (path.includes("issues")) setActiveTab("issues");
    else if (path.includes("dashboard")) setActiveTab("dashboard");
    else if (path.includes("register")) {
      setIsRegistering(true);
      setActiveTab("dashboard");
    }

    // Check auth status
    fetchAuthMe().then((u) => {
      setUser(u);
    });
  }, []);

  const handleSelectTab = (tab: "teams" | "members" | "issues" | "dashboard") => {
    setActiveTab(tab);
    setIsRegistering(false);
    window.history.pushState({}, "", `/${tab === "teams" ? "" : tab}`);
  };

  const handleLogout = async () => {
    await postLogout();
    setUser(null);
    setActiveTab("teams");
    window.history.pushState({}, "", "/");
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        user={user}
        onLogout={handleLogout}
      />

      <main style={{ flex: 1, paddingBottom: "3rem" }}>
        {isRegistering ? (
          <RegisterPage
            onComplete={() => {
              setIsRegistering(false);
              fetchAuthMe().then((u) => {
                setUser(u);
                setActiveTab("dashboard");
              });
            }}
          />
        ) : (
          <>
            {activeTab === "teams" && <TeamLeaderboard />}
            {activeTab === "members" && <MemberLeaderboard />}
            {activeTab === "issues" && <IssueBoard user={user} />}
            {activeTab === "dashboard" && <MemberDashboard user={user} />}
          </>
        )}
      </main>

      <footer style={{
        borderTop: "1px solid #1e293b",
        padding: "1.5rem 1rem",
        textAlign: "center",
        fontSize: "0.8rem",
        color: "#64748b",
        background: "rgba(15, 23, 42, 0.95)",
      }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <strong>Patch Wars 2026</strong> • Tech Sprint Journey (TSJ)
          </div>
          <div>
            Official Open-Source Competition • All claim matching via GitHub OAuth
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
