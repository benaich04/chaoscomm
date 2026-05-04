import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout.jsx";
import PlaceholderPage from "./pages/_PlaceholderPage.jsx";
import ChaoticMapsPage from "./pages/ChaoticMapsPage.jsx";
import BifurcationPage from "./pages/BifurcationPage.jsx";
import PhasePage from "./pages/PhasePage.jsx";
import QuantizationPage from "./pages/QuantizationPage.jsx";
import SignalPage from "./pages/SignalPage.jsx";
import CSKPage from "./pages/CSKPage.jsx";
import MatchedFilterPage from "./pages/MatchedFilterPage.jsx";
import CorrelationPage from "./pages/CorrelationPage.jsx";
import SpectrumPage from "./pages/SpectrumPage.jsx";
import BERPage from "./pages/BERPage.jsx";
import RadarPage from "./pages/RadarPage";
import ChannelPage from "./pages/ChannelPage.jsx";
import MetricsPage from "./pages/MetricsPage.jsx";
import MissionPage from "./pages/MissionPage.jsx";

const PAGES = [
  { path: "/", title: "Mission Overview", subtitle: "System flowchart and pipeline navigation hub", isLanding: true },
  { path: "/channel", title: "Channel Models",          subtitle: "AWGN, Rayleigh, Rician, multipath, jamming" },
  { path: "/radar",   title: "Chaotic Radar",           subtitle: "Range, Doppler, ambiguity function, CFAR detection" },
  { path: "/metrics", title: "Metrics Dashboard",       subtitle: "Lyapunov, entropy, NIST suite, CLQ, BCR" },
  { path: "/mission", title: "Operation Phantom Signal", subtitle: "10-step interactive mission integrating every concept" },
];

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/maps"           element={<ChaoticMapsPage />} />
        <Route path="/bifurcation"    element={<BifurcationPage />} />
        <Route path="/phase"          element={<PhasePage />} />
        <Route path="/quantization"   element={<QuantizationPage />} />
        <Route path="/signal"         element={<SignalPage />} />
        <Route path="/csk"            element={<CSKPage />} />
        <Route path="/matched-filter" element={<MatchedFilterPage />} />
        <Route path="/correlation"    element={<CorrelationPage />} />
        <Route path="/spectrum"       element={<SpectrumPage />} />
        <Route path="/ber"            element={<BERPage />} />
        <Route path="/channel" element={<ChannelPage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/mission"        element={<MissionPage />} />
        <Route path="/mission"        element={<MissionPage />} />
        {PAGES.map((p) => (
          <Route key={p.path} path={p.path} element={<PlaceholderPage meta={p} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}