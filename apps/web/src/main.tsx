import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app.js";
import { ApplicationErrorBoundary } from "./app/application-error-boundary.js";
import "./styles/index.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("The application root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <App />
    </ApplicationErrorBoundary>
  </StrictMode>,
);
