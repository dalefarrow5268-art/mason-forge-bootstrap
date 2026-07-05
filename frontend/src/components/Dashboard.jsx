import { useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import MissionPanel from "./MissionPanel";
import ProjectStatus from "./ProjectStatus";
import BuildQueue from "./BuildQueue";
import ActivityFeed from "./ActivityFeed";
import AIEngineeringTeam from "./AIEngineeringTeam";
import CoreStatusPanel from "./CoreStatusPanel";

export default function Dashboard() {
  const [page, setPage] = useState("mission");

  return (
    <div className="dashboard-layout">
      <Sidebar page={page} setPage={setPage} />

      <main className="dashboard-main">
        <Header />

        <div className="dashboard-row">
          <div className="dashboard-left">
            <MissionPanel />
            <ProjectStatus />
            <BuildQueue />
          </div>

          <div className="dashboard-right">
            <ActivityFeed />
            <AIEngineeringTeam />
            <CoreStatusPanel />
          </div>
        </div>
      </main>
    </div>
  );
}