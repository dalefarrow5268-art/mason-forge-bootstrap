import { useState } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";

import MissionPanel from "./MissionPanel";
import ProjectStatus from "./ProjectStatus";
import BuildQueue from "./BuildQueue";

import ActivityFeed from "./ActivityFeed";
import AIEngineeringTeam from "./AIEngineeringTeam";
import CoreStatusPanel from "./CoreStatusPanel";

import KnowledgeEngine from "./KnowledgeEngine";
import KnowledgePanel from "./KnowledgePanel";

import EngineeringPlanner from "./EngineeringPlanner";
import AIWorkforceManager from "./AIWorkforceManager";
import ApprovalQueue from "./ApprovalQueue";
import PromptLibrary from "./PromptLibrary";
import GitBridge from "./GitBridge";
import VSCodeBridge from "./VSCodeBridge";
import VerificationEngine from "./VerificationEngine";
import DeploymentBridge from "./DeploymentBridge";
import LocalAIBridge from "./LocalAIBridge";
import ForgeStatusPanel from "./control-center/ForgeStatusPanel";

export default function Dashboard() {
  const [page, setPage] = useState("mission");

  const renderRightPanel = () => {
    return (
      <aside className="dashboard-right">
        <ActivityFeed />
        <AIEngineeringTeam />
        <CoreStatusPanel />
      </aside>
    );
  };

  const renderStandardPage = (component) => {
    return (
      <div className="dashboard-row">
        <section className="dashboard-left">{component}</section>

        {renderRightPanel()}
      </div>
    );
  };

  const renderPage = () => {
    switch (page) {
      case "engineering":
        return (
          <div className="dashboard-row">
            <section className="dashboard-left">
              <KnowledgeEngine />
            </section>

            <aside className="dashboard-right">
              <KnowledgePanel />
            </aside>
          </div>
        );

      case "planner":
        return renderStandardPage(<EngineeringPlanner />);

      case "workforce":
        return renderStandardPage(<AIWorkforceManager />);

      case "approvals":
        return renderStandardPage(<ApprovalQueue />);

      case "prompts":
        return renderStandardPage(<PromptLibrary />);

      case "pipeline":
        return renderStandardPage(<GitBridge />);

      case "vscode":
        return renderStandardPage(<VSCodeBridge />);

      case "analytics":
        return renderStandardPage(<VerificationEngine />);

      case "deployments":
        return renderStandardPage(<DeploymentBridge />);

      case "localai":
        return renderStandardPage(<LocalAIBridge />);

      case "forge-status":
        return renderStandardPage(<ForgeStatusPanel />);

      default:
        return (
          <div className="dashboard-row">
            <section className="dashboard-left">
              <MissionPanel />
              <ProjectStatus />
              <BuildQueue />
            </section>

            {renderRightPanel()}
          </div>
        );
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar page={page} setPage={setPage} />

      <main className="dashboard-main">
        <Header />

        <div className="dashboard-content">{renderPage()}</div>
      </main>
    </div>
  );
}