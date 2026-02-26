import { useState } from "react";
import { NavLink } from "react-router-dom";

interface NavItem {
  path: string;
  label: string;
}

const navItems: NavItem[] = [
  { path: "/", label: "Status" },
  { path: "/kanban", label: "Tasks" },
  { path: "/briefs", label: "Briefs" },
  { path: "/stocks", label: "Stocks" },
  { path: "/social", label: "Social" },
  { path: "/inspect", label: "Inspect" },
  { path: "/system", label: "System" },
];

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  return (
    <nav className="app-nav">
      <div className="app-title">
        <h1>
          <span className="icon">&gt;</span>
          Agent
        </h1>
      </div>

      {/* Hamburger button - mobile only */}
      <button
        className="hamburger"
        onClick={toggleMenu}
        aria-label="Toggle menu"
        aria-expanded={isOpen}
      >
        <span className={`hamburger-line ${isOpen ? "open" : ""}`}></span>
        <span className={`hamburger-line ${isOpen ? "open" : ""}`}></span>
        <span className={`hamburger-line ${isOpen ? "open" : ""}`}></span>
      </button>

      {/* Desktop nav links */}
      <div className="nav-links desktop-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Mobile dropdown */}
      {isOpen && (
        <div className="mobile-nav-overlay" onClick={closeMenu}>
          <div className="mobile-nav" onClick={(e) => e.stopPropagation()}>
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `mobile-nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMenu}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
