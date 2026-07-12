import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./components/AuthContext";
import { LoginPage } from "./components/LoginPage";
import App from "./App";
import "./index.css";

function MainGate() {
  const { isAuthenticated, isLoading, isDemo } = useAuth();
  if (isLoading) return <div className="loading-screen">Loading…</div>;
  if (!isAuthenticated && !isDemo) return <LoginPage />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <MainGate />
    </AuthProvider>
  </StrictMode>,
);
