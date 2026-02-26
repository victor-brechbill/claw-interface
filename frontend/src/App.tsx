import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import StatusDashboard from "./components/StatusDashboard";
import Board from "./components/Board";
import System from "./components/System";
import BriefArchive from "./components/BriefArchive";
import InspectPage from "./components/InspectPage";
import Navigation from "./components/Navigation";
import ErrorBoundary from "./components/ErrorBoundary";
import { NotificationProvider } from "./components/Notification";

function App() {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <div className="app">
          <Navigation />
          <main className="app-content">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<StatusDashboard />} />
                <Route path="/kanban" element={<Board />} />
                <Route path="/system" element={<System />} />
                <Route path="/briefs" element={<BriefArchive />} />
                <Route path="/inspect" element={<InspectPage />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </div>
      </NotificationProvider>
    </BrowserRouter>
  );
}

export default App;
