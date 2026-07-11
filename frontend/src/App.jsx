import { useEffect } from "react";
import Dashboard from "./components/Dashboard";
import { masonCore } from "./core";

export default function App() {
  useEffect(() => {
    console.clear();

    masonCore.initialize();

    const status = masonCore.getStatus();

    console.log("==============================================");
    console.log("              Mason Forge™");
    console.log("      Engineering Operating System");
    console.log("==============================================");
    console.log(`Version: ${status.version}`);
    console.log("Milestone: 3");
    console.log(`Status: ${status.status}`);
    console.log(`Ready: ${status.ready ? "Yes" : "No"}`);
    console.log("----------------------------------------------");
    console.log(`Engineering Systems: 11`);
    console.log(`AI Workforce: ${status.metrics.engineeringAgents}`);
    console.log(`Engineering Jobs: ${status.metrics.engineeringJobs}`);
    console.log(`Approval Queue: ${status.metrics.approvalQueue}`);
    console.log(`Knowledge Records: ${status.knowledge.records}`);
    console.log(`Environment: ${status.metrics.environment}`);
    console.log(`Deployment: ${status.metrics.deployment}`);
    console.log("----------------------------------------------");
    console.log("Mission:");
    console.log("Build the Engineering Operating System");
    console.log("for SubSource Exchange™");
    console.log("----------------------------------------------");
    console.log("Forge it once. Reuse it forever.™");
    console.log("We Build People.");
    console.log("==============================================");

    console.log(status);
  }, []);

  return <Dashboard />;
}