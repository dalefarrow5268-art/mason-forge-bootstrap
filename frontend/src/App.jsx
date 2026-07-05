import { useEffect } from "react";
import Dashboard from "./components/Dashboard";
import ForgeStatusPanel from "./components/control-center/ForgeStatusPanel";
import { masonCore } from "./core";

export default function App() {
  useEffect(() => {
    masonCore.initialize();
  }, []);

  return (
    <>
      <Dashboard />
      <ForgeStatusPanel />
    </>
  );
}