import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

import "./style.css";

console.log("========================================");
console.log(" Mason Forge™");
console.log(" Engineering Operating System");
console.log(" Version 0.2.0");
console.log("========================================");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);