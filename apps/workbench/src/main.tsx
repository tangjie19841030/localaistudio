import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import { initTheme } from "./state/themeStore";
import { setSvgParser } from "@studio/schema-core";
// W5 T73: bind the browser DOMParser before any render/validation path runs.
setSvgParser((s) => new DOMParser().parseFromString(s, "image/svg+xml").documentElement);
import "./index.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
