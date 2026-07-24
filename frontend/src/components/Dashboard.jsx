import { useState } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";

import MissionPanel from "./MissionPanel";
import CloudOperationsPanel from "./CloudOperationsPanel";
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

function SSXProjects() {
  const projects = [
    { name: "SubSource Exchange™", type: "Construction Procurement Operating System", status: "Active", phase: "Platform Development" },
    { name: "Mason Forge™", type: "AI Engineering Operating System", status: "Active", phase: "Cloud Operations" },
    { name: "SSX Upload Portal", type: "Project Document Intake", status: "Ready", phase: "Foundation Complete" },
    { name: "SSX Project Navigator™", type: "Adaptive Scheduling and Project Intelligence", status: "Planned", phase: "Product Roadmap" },
  ];
  return <section className="engineering-planner"><div className="engineering-planner-header"><div><p className="section-label">SSX Platform</p><h2>SSX Projects</h2><p className="engineering-planner-subtitle">Manage active SubSource Exchange™ platform builds from Mason Forge.</p></div><div className="engineering-planner-status">{projects.length} Projects</div></div><div className="engineering-planner-workspace"><table className="planner-table"><thead><tr><th>Project</th><th>Product Type</th><th>Status</th><th>Current Phase</th></tr></thead><tbody>{projects.map((project) => <tr key={project.name}><td><strong>{project.name}</strong></td><td>{project.type}</td><td>{project.status}</td><td>{project.phase}</td></tr>)}</tbody></table></div></section>;
}

function PlatformSettings() {
  const settings = [
    { name: "Human Approval Gate", value: "Required" },
    { name: "Engineering Environment", value: "Cloud + Local Bridge" },
    { name: "Default Repository Branch", value: "main" },
    { name: "Knowledge Retention", value: "Continuity Ledger Enabled" },
    { name: "Automated Verification", value: "Required" },
    { name: "Production Deployment", value: "Human Approval Required" },
  ];
  return <section className="engineering-planner"><div className="engineering-planner-header"><div><p className="section-label">Platform Administration</p><h2>Platform Settings</h2><p className="engineering-planner-subtitle">Review Mason Forge operating safeguards and engineering defaults.</p></div><div className="engineering-planner-status">Protected</div></div><div className="engineering-planner-workspace"><table className="planner-table"><thead><tr><th>Setting</th><th>Current Configuration</th></tr></thead><tbody>{settings.map((setting) => <tr key={setting.name}><td><strong>{setting.name}</strong></td><td>{setting.value}</td></tr>)}</tbody></table></div></section>;
}

export default function Dashboard() {
  const [page, setPage] = useState("mission");
  const renderRightPanel = () => <div className="dashboard-right"><ActivityFeed /><AIEngineeringTeam /><CoreStatusPanel /></div>;
  const renderStandardPage = (component) => <div className="dashboard-row"><div className="dashboard-left">{component}</div>{renderRightPanel()}</div>;
  const renderPage = () => {
    switch (page) {
      case "engineering": return <div className="dashboard-row"><div className="dashboard-left"><KnowledgeEngine /></div><div className="dashboard-right"><KnowledgePanel /></div></div>;
      case "planner": return renderStandardPage(<EngineeringPlanner />);
      case "workforce": return renderStandardPage(<AIWorkforceManager />);
      case "approvals": return renderStandardPage(<ApprovalQueue />);
      case "prompts": return renderStandardPage(<PromptLibrary />);
      case "pipeline": return renderStandardPage(<GitBridge />);
      case "vscode": return renderStandardPage(<VSCodeBridge />);
      case "analytics": return renderStandardPage(<VerificationEngine />);
      case "deployments": return renderStandardPage(<DeploymentBridge />);
      case "localai": return renderStandardPage(<LocalAIBridge />);
      case "forge-status": return renderStandardPage(<ForgeStatusPanel />);
      case "projects": return renderStandardPage(<SSXProjects />);
      case "settings": return renderStandardPage(<PlatformSettings />);
      default: return <div className="dashboard-row"><div className="dashboard-left"><MissionPanel /><CloudOperationsPanel /><BuildQueue /></div>{renderRightPanel()}</div>;
    }
  };
  return <div className="dashboard-layout"><Sidebar page={page} setPage={setPage} /><main className="dashboard-main"><Header /><div className="dashboard-content">{renderPage()}</div></main></div>;
}
