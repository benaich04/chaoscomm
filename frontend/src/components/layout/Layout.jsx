import Sidebar from "./Sidebar.jsx";
import Header from "./Header.jsx";

/**
 * Layout — persistent shell.
 *
 *   ┌──────────┬────────────────────────────────┐
 *   │          │            Header              │
 *   │ Sidebar  ├────────────────────────────────┤
 *   │          │                                │
 *   │          │       <main scrollable>        │
 *   │          │       (page content)           │
 *   │          │                                │
 *   └──────────┴────────────────────────────────┘
 *
 * Only `main` scrolls; header and sidebar stay fixed for orientation.
 */
export default function Layout({ children }) {
  return (
    <div className="h-screen w-screen flex bg-bg-base text-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}