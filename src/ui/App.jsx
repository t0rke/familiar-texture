import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  CheckCircle2,
  Clock3,
  DollarSign,
  Eye,
  Filter,
  Gauge,
  Layers,
  ListChecks,
  Lock,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";

const RUN_START_TYPES = new Set(["STRATEGY_INPUTS", "LOCAL_TRADE_APPROVED"]);
const COMPLETION_TYPES = new Set([
  "DRY_RUN_ORDER_NOT_PLACED",
  "LIVE_ORDER_PLACED",
  "ORDER_REVIEWED_BUT_NOT_PLACED",
  "STRATEGY_HOLD",
]);
const SUCCESS_TYPES = new Set(["LIVE_ORDER_PLACED"]);
const WARNING_TYPES = new Set([
  "DRY_RUN_ORDER_NOT_PLACED",
  "ORDER_REVIEWED_BUT_NOT_PLACED",
  "RUN_ORDER_ERROR",
]);

function formatTime(value, options = {}) {
  if (!value) return "Never";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: options.dateStyle ?? "medium",
      timeStyle: options.timeStyle ?? "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatRelative(value) {
  if (!value) return "No events";

  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(delta / 60000));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function formatCurrency(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "None";

  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(number);
}

function formatQuantity(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return value ?? "None";

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 6,
  }).format(number);
}

function humanizeType(type) {
  return String(type ?? "UNKNOWN").replaceAll("_", " ").toLowerCase();
}

function getEventTone(type) {
  if (SUCCESS_TYPES.has(type)) return "success";
  if (WARNING_TYPES.has(type)) return "warning";
  if (type === "STRATEGY_HOLD") return "neutral";
  if (type === "ORDER_REVIEW") return "accent";
  if (type === "LOCAL_TRADE_APPROVED") return "trade";
  return "default";
}

function getEventSummary(event) {
  if (!event) return "No event selected";

  if (event.type === "STRATEGY_DECISION") {
    const decision = event.decision ?? {};
    if (decision.action === "trade") {
      const amount =
        decision.dollars != null ? `$${decision.dollars}` : decision.quantity;
      return `${decision.side ?? "trade"} ${amount ?? ""} ${
        decision.symbol ?? ""
      }`.trim();
    }

    return decision.reason ?? decision.action ?? "Strategy decision";
  }

  if (event.type === "LOCAL_TRADE_APPROVED") {
    const trade = event.trade ?? {};
    return `${trade.side ?? "trade"} ${trade.symbol ?? ""} approved`.trim();
  }

  if (event.type === "ORDER_REVIEW") {
    const order = event.order ?? {};
    return `${order.side ?? "order"} ${order.symbol ?? ""} reviewed`.trim();
  }

  if (event.type === "LIVE_ORDER_PLACED") {
    const order = event.order ?? {};
    return `${order.side ?? "order"} ${order.symbol ?? ""} placed`.trim();
  }

  if (event.reason) return event.reason;
  if (event.message) return event.message;
  if (event.symbol) return String(event.symbol);
  if (event.order?.symbol) return `${event.order.side ?? "order"} ${event.order.symbol}`;
  if (event.trade?.symbol) return `${event.trade.side ?? "trade"} ${event.trade.symbol}`;

  return humanizeType(event.type);
}

function getSymbol(event) {
  return (
    event?.symbol ??
    event?.decision?.symbol ??
    event?.trade?.symbol ??
    event?.order?.symbol ??
    ""
  );
}

function getAmount(event) {
  const dollarValue =
    event?.decision?.dollars ?? event?.trade?.dollars ?? event?.order?.dollar_amount;
  const shareValue =
    event?.decision?.quantity ?? event?.trade?.quantity ?? event?.order?.quantity;
  const value = dollarValue ?? shareValue;

  if (value == null || value === "") return "";

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    const prefix = dollarValue != null ? "$" : "";
    return `${prefix}${asNumber}`;
  }

  return String(value);
}

function groupRuns(events) {
  const runs = [];
  let current = null;

  events.forEach((event, index) => {
    if (!current || (RUN_START_TYPES.has(event.type) && current.events.length > 0)) {
      current = {
        id: `run-${runs.length + 1}`,
        index: runs.length + 1,
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        events: [],
      };
      runs.push(current);
    }

    current.events.push({ ...event, eventIndex: index });
    current.endedAt = event.timestamp ?? current.endedAt;
  });

  return runs.map((run) => {
    const last = run.events.at(-1);
    const decision = [...run.events]
      .reverse()
      .find((event) => event.type === "STRATEGY_DECISION")?.decision;
    const approvedTrade = [...run.events]
      .reverse()
      .find((event) => event.type === "LOCAL_TRADE_APPROVED")?.trade;
    const placedOrder = [...run.events]
      .reverse()
      .find((event) => event.type === "LIVE_ORDER_PLACED")?.order;
    const completed = run.events.some((event) => COMPLETION_TYPES.has(event.type));
    const errored = run.events.some((event) => event.type === "RUN_ORDER_ERROR");
    const live = run.events.some((event) => event.type === "LIVE_ORDER_PLACED");
    const held = run.events.some((event) => event.type === "STRATEGY_HOLD");
    const dry =
      run.events.some((event) => event.type === "DRY_RUN_ORDER_NOT_PLACED") ||
      run.events.some((event) => event.type === "ORDER_REVIEWED_BUT_NOT_PLACED");

    return {
      ...run,
      decision,
      errored,
      held,
      live,
      dry,
      completed,
      lastType: last?.type,
      symbol: getSymbol({ decision, trade: approvedTrade, order: placedOrder }) || "VOO",
      summary:
        getEventSummary(last) ||
        decision?.reason ||
        approvedTrade?.reason ||
        "No summary",
    };
  });
}

function eventMatches(event, query) {
  if (!query) return true;

  const haystack = JSON.stringify(event).toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function updateNestedValue(object, path, value) {
  const [head, ...rest] = path.split(".");

  if (!head) return object;

  return {
    ...object,
    [head]: rest.length
      ? updateNestedValue(object?.[head] ?? {}, rest.join("."), value)
      : value,
  };
}

function normalizeSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isLiveMode(settings) {
  return Boolean(
    settings?.mode?.tradingEnabled &&
      !settings?.mode?.dryRun &&
      settings?.mode?.confirmLiveOrder
  );
}

function getPortfolioData(snapshot) {
  return snapshot?.portfolio?.json?.data ?? {};
}

function getPositions(snapshot) {
  return snapshot?.positions?.json?.data?.positions ?? [];
}

function getQuotes(snapshot) {
  return snapshot?.quotes?.json?.data?.results ?? [];
}

function getRecentOrders(snapshot) {
  return snapshot?.recentOrders?.json?.data?.orders ?? [];
}

function getOrderAmount(order) {
  if (order?.dollar_based_amount?.amount != null) {
    return formatCurrency(order.dollar_based_amount.amount);
  }

  if (order?.quantity != null) {
    return `${formatQuantity(order.quantity)} shares`;
  }

  return "None";
}

const ROUTES = [
  {
    description: "Account snapshot, portfolio metrics, safety status, and recent activity.",
    icon: BarChart3,
    label: "Dashboard",
    path: "/dashboard",
  },
  {
    description: "Audit trail, run history, event timeline, and raw JSON details.",
    icon: ListChecks,
    label: "Ledger",
    path: "/ledger",
  },
  {
    description: "Strategy selection, model tuning, and simulation preview.",
    icon: SlidersHorizontal,
    label: "Strategy",
    path: "/strategy",
  },
  {
    description: "Symbol lists, hard limits, allocation caps, and trade gates.",
    icon: Gauge,
    label: "Risk",
    path: "/risk",
  },
  {
    description: "Dry-run/live controls, kill switch, and order execution review.",
    icon: Power,
    label: "Execution",
    path: "/execution",
  },
  {
    description: "Application preferences, config health, and persistence controls.",
    icon: Settings,
    label: "Settings",
    path: "/settings",
  },
];

function normalizeRoute(pathname) {
  if (pathname === "/") return "/dashboard";
  return ROUTES.some((route) => route.path === pathname) ? pathname : "/dashboard";
}

function useRoute() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/dashboard");
    }

    function handlePopState() {
      setRoute(normalizeRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(path) {
    const nextRoute = normalizeRoute(path);
    if (nextRoute === route) return;
    window.history.pushState(null, "", nextRoute);
    setRoute(nextRoute);
  }

  return [route, navigate];
}

function App() {
  const [route, navigate] = useRoute();
  const [ledger, setLedger] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [settingsPayload, setSettingsPayload] = useState(null);
  const [draftSettings, setDraftSettings] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [liveConfirmationOpen, setLiveConfirmationOpen] = useState(false);
  const [liveConfirmationText, setLiveConfirmationText] = useState("");
  const [strategyRunning, setStrategyRunning] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeRunId, setActiveRunId] = useState("");
  const [selectedEventIndex, setSelectedEventIndex] = useState(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeView, setActiveView] = useState("runs");

  async function loadLedger({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ledger");
      if (!response.ok) {
        throw new Error(`Ledger API returned ${response.status}`);
      }

      const data = await response.json();
      setLedger(data);
    } catch (err) {
      setError(err.message ?? "Unable to load ledger");
    } finally {
      setLoading(false);
    }
  }

  async function loadAccount({ sync = false } = {}) {
    setAccountError("");
    if (sync) setAccountLoading(true);

    try {
      const response = await fetch(sync ? "/api/account/sync" : "/api/account", {
        method: sync ? "POST" : "GET",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Account API returned ${response.status}`);
      }

      setAccount(data);
    } catch (err) {
      setAccountError(err.message ?? "Unable to load account snapshot");
    } finally {
      setAccountLoading(false);
    }
  }

  async function loadSettings() {
    setSettingsError("");

    try {
      const response = await fetch("/api/settings");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Settings API returned ${response.status}`);
      }

      setSettingsPayload(data);
      setDraftSettings(data.settings);
    } catch (err) {
      setSettingsError(err.message ?? "Unable to load settings");
    }
  }

  function patchDraft(path, value) {
    setDraftSettings((current) => updateNestedValue(current, path, value));
  }

  async function saveSettings({ confirmation } = {}) {
    setSettingsError("");
    setSettingsSaving(true);

    try {
      const response = await fetch("/api/settings", {
        body: JSON.stringify({
          confirmation,
          patch: draftSettings,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "PATCH",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Settings API returned ${response.status}`);
      }

      setSettingsPayload(data);
      setDraftSettings(data.settings);
      setLiveConfirmationOpen(false);
      setLiveConfirmationText("");
      await loadLedger({ quiet: true });
    } catch (err) {
      setSettingsError(err.message ?? "Unable to save settings");
    } finally {
      setSettingsSaving(false);
    }
  }

  function requestSettingsSave() {
    const currentLive = isLiveMode(settingsPayload?.settings);
    const draftLive = isLiveMode(draftSettings);

    if (draftLive && !currentLive) {
      setLiveConfirmationOpen(true);
      return;
    }

    saveSettings();
  }

  async function resetSettings() {
    setSettingsError("");
    setSettingsSaving(true);

    try {
      const response = await fetch("/api/settings/reset", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Settings API returned ${response.status}`);
      }

      setSettingsPayload(data);
      setDraftSettings(data.settings);
      await loadLedger({ quiet: true });
    } catch (err) {
      setSettingsError(err.message ?? "Unable to reset settings");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function setKillSwitch(enabled) {
    setSettingsError("");

    try {
      const response = await fetch(
        enabled ? "/api/kill-switch/enable" : "/api/kill-switch/disable",
        { method: "POST" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Kill switch API returned ${response.status}`);
      }

      await loadLedger({ quiet: true });
      setLedger((current) =>
        current
          ? {
              ...current,
              status: data.status,
            }
          : current
      );
    } catch (err) {
      setSettingsError(err.message ?? "Unable to update kill switch");
    }
  }

  async function runStrategy() {
    setSettingsError("");
    setStrategyRunning(true);

    try {
      const response = await fetch("/api/run-strategy", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Run strategy API returned ${response.status}`);
      }
    } catch (err) {
      setSettingsError(err.message ?? "Unable to run strategy");
    } finally {
      setTimeout(() => setStrategyRunning(false), 1500);
    }
  }

  useEffect(() => {
    loadLedger();
    loadAccount();
    loadSettings();
    const timer = window.setInterval(() => loadLedger({ quiet: true }), 6000);
    return () => window.clearInterval(timer);
  }, []);

  const events = ledger?.events ?? [];
  const runs = useMemo(() => groupRuns(events), [events]);
  const newestRun = runs.at(-1);

  useEffect(() => {
    if (!activeRunId && newestRun) {
      setActiveRunId(newestRun.id);
    }
  }, [activeRunId, newestRun]);

  const eventTypes = useMemo(
    () => ["all", ...Array.from(new Set(events.map((event) => event.type))).sort()],
    [events]
  );

  const filteredEvents = useMemo(
    () =>
      events
        .map((event, index) => ({ ...event, eventIndex: index }))
        .filter((event) => typeFilter === "all" || event.type === typeFilter)
        .filter((event) => eventMatches(event, query)),
    [events, query, typeFilter]
  );

  const activeRun = runs.find((run) => run.id === activeRunId) ?? newestRun;
  const selectedEvent =
    selectedEventIndex == null
      ? activeRun?.events.at(-1) ?? filteredEvents.at(-1)
      : events[selectedEventIndex];

  const metrics = useMemo(() => {
    const liveOrders = events.filter((event) => event.type === "LIVE_ORDER_PLACED");
    const holds = events.filter((event) => event.type === "STRATEGY_HOLD");
    const reviews = events.filter((event) => event.type === "ORDER_REVIEW");
    const decisions = events.filter((event) => event.type === "STRATEGY_DECISION");
    const tradeDecisions = decisions.filter(
      (event) => event.decision?.action === "trade"
    );

    return [
      {
        icon: TrendingUp,
        label: "Runs",
        value: runs.length,
        detail: `${events.length} events`,
        tone: "accent",
      },
      {
        icon: ArrowDownUp,
        label: "Trades",
        value: tradeDecisions.length,
        detail: `${reviews.length} reviews`,
        tone: "trade",
      },
      {
        icon: CheckCircle2,
        label: "Live",
        value: liveOrders.length,
        detail: `${holds.length} holds`,
        tone: "success",
      },
      {
        icon: Clock3,
        label: "Latest",
        value: formatRelative(events.at(-1)?.timestamp),
        detail: formatTime(events.at(-1)?.timestamp, {
          dateStyle: "short",
          timeStyle: "short",
        }),
        tone: "neutral",
      },
    ];
  }, [events, runs.length]);

  const status = ledger?.status ?? {};
  const safeMode =
    status.killSwitchActive || status.dryRun || !status.tradingEnabled || !status.confirmLiveOrder;
  const currentRoute = ROUTES.find((item) => item.path === route) ?? ROUTES[0];
  const shellProps = {
    currentRoute,
    loading,
    navigate,
    onRefresh: () => {
      loadLedger();
      loadSettings();
      loadAccount();
    },
    routes: ROUTES,
    safeMode,
    status,
  };
  const controlProps = {
    account,
    error: settingsError,
    liveConfirmationText: settingsPayload?.liveConfirmationText,
    onKillSwitch: setKillSwitch,
    onPatch: patchDraft,
    onReset: resetSettings,
    onRunStrategy: runStrategy,
    onSave: requestSettingsSave,
    saving: settingsSaving,
    settings: draftSettings,
    status,
    strategies: settingsPayload?.strategies ?? {},
    strategyRunning,
    validation: settingsPayload?.validation,
  };
  const ledgerProps = {
    activeRun,
    activeRunId: activeRun?.id,
    activeView,
    eventTypes,
    filteredEvents,
    invalidLines: ledger?.invalidLines ?? 0,
    logFile: ledger?.logFile,
    onSelectEvent: (event) => {
      setSelectedEventIndex(event.eventIndex);
      const run = runs.find((item) =>
        item.events.some((runEvent) => runEvent.eventIndex === event.eventIndex)
      );
      if (run) setActiveRunId(run.id);
    },
    onSelectRun: (run) => {
      setActiveRunId(run.id);
      setSelectedEventIndex(null);
    },
    onViewChange: setActiveView,
    query,
    runs,
    selectedEvent,
    selectedEventIndex,
    setQuery,
    setTypeFilter,
    status,
    typeFilter,
    updatedAt: ledger?.updatedAt,
  };

  return (
    <main className="app-frame">
      <AppShell {...shellProps}>
      {isLiveMode(settingsPayload?.settings) ? <LiveModeBanner /> : null}

        {error ? (
          <section className="notice error">
            <XCircle size={18} />
            <span>{error}</span>
          </section>
        ) : null}

        {route === "/dashboard" ? (
          <DashboardPage
            account={account}
            accountError={accountError}
            accountLoading={accountLoading}
            metrics={metrics}
            onSync={() => loadAccount({ sync: true })}
            runs={runs}
            status={status}
          />
        ) : null}

        {route === "/ledger" ? <LedgerPage {...ledgerProps} /> : null}

        {route === "/strategy" ? (
          <StrategyPage {...controlProps} visibleSections={["strategy", "preview"]} />
        ) : null}

        {route === "/risk" ? (
          <RiskPage {...controlProps} visibleSections={["symbols", "risk", "preview"]} />
        ) : null}

        {route === "/execution" ? (
          <ExecutionPage {...controlProps} visibleSections={["execution", "preview"]} />
        ) : null}

        {route === "/settings" ? (
          <SettingsPage
            {...controlProps}
            health={settingsPayload?.health}
            invalidLines={ledger?.invalidLines ?? 0}
            logFile={ledger?.logFile}
            onPatch={patchDraft}
            updatedAt={ledger?.updatedAt}
          />
        ) : null}
      </AppShell>

      <ConfirmationModal
        confirmationText={settingsPayload?.liveConfirmationText ?? "ENABLE LIVE TRADING"}
        onCancel={() => {
          setLiveConfirmationOpen(false);
          setLiveConfirmationText("");
        }}
        onConfirm={() => saveSettings({ confirmation: liveConfirmationText })}
        open={liveConfirmationOpen}
        saving={settingsSaving}
        value={liveConfirmationText}
        onChange={setLiveConfirmationText}
      />
    </main>
  );
}

function AppShell({
  children,
  currentRoute,
  loading,
  navigate,
  onRefresh,
  routes,
  safeMode,
  status,
}) {
  return (
    <div className="app-shell">
      <aside className="shell-rail">
        <div className="brand-mark">
          <span>FT</span>
        </div>
        <LiquidNav currentPath={currentRoute.path} onNavigate={navigate} routes={routes} />
      </aside>

      <section className={`shell-main route-${currentRoute.path.slice(1)}`}>
        <header className="shell-header">
          <div>
            <p className="eyebrow">familiar texture</p>
            <h1>{currentRoute.label}</h1>
            <p className="page-subtitle">{currentRoute.description}</p>
          </div>

          <div className="toolbar">
            <div className={`mode-pill ${safeMode ? "safe" : "live"}`}>
              {safeMode ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
              <span>{safeMode ? "Guarded" : "Live-ready"}</span>
            </div>
            <div className={`mode-pill ${status.killSwitchActive ? "live" : "safe"}`}>
              <ShieldAlert size={16} />
              <span>{status.killSwitchActive ? "Kill active" : "Kill clear"}</span>
            </div>
            <button
              className="icon-button"
              onClick={onRefresh}
              title="Refresh data"
              aria-label="Refresh data"
            >
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>

        <div className="page-content">{children}</div>
      </section>
    </div>
  );
}

function LiquidNav({ currentPath, onNavigate, routes }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const activeIndex = routes.findIndex((route) => route.path === currentPath);
  const magneticIndex = hoveredIndex ?? activeIndex;

  return (
    <nav
      className="liquid-nav"
      onMouseLeave={() => setHoveredIndex(null)}
      aria-label="Primary"
    >
      <span
        className="liquid-nav-blob"
        style={{
          "--active-index": activeIndex < 0 ? 0 : activeIndex,
          "--hover-index": magneticIndex < 0 ? 0 : magneticIndex,
        }}
      />
      {routes.map((route, index) => {
        const Icon = route.icon;
        const distance = magneticIndex == null ? 9 : Math.abs(index - magneticIndex);
        const scale = distance === 0 ? 1.1 : distance === 1 ? 1.04 : 1;
        const offset =
          magneticIndex == null || distance > 1
            ? 0
            : index < magneticIndex
              ? 4
              : index > magneticIndex
                ? -4
                : 0;
        const active = route.path === currentPath;

        return (
          <a
            aria-current={active ? "page" : undefined}
            aria-label={route.label}
            className={`liquid-nav-item ${active ? "active" : ""}`}
            href={route.path}
            key={route.path}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(route.path);
            }}
            onFocus={() => setHoveredIndex(index)}
            onMouseEnter={() => setHoveredIndex(index)}
            style={{
              "--item-offset": `${offset}px`,
              "--item-scale": scale,
            }}
          >
            <Icon size={19} />
            <span>{route.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function PageHeader({ title, subtitle }) {
  return (
    <section className="page-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </section>
  );
}

function MetricsGrid({ metrics }) {
  return (
    <section className="metrics-grid" aria-label="Ledger metrics">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <article className={`metric ${metric.tone}`} key={metric.label}>
            <Icon size={20} />
            <div>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function StatusStrip({ status }) {
  return (
    <section className="status-strip" aria-label="Runtime status">
      <StatusItem
        active={status.accountConfigured}
        icon={Lock}
        label="Account"
        value={status.accountConfigured ? "Configured" : "Missing"}
      />
      <StatusItem
        active={status.mcpConfigured}
        icon={Sparkles}
        label="MCP"
        value={status.mcpConfigured ? "Configured" : "Missing"}
      />
      <StatusItem
        active={!status.killSwitchActive}
        icon={status.killSwitchActive ? ShieldAlert : ShieldCheck}
        label="Kill switch"
        value={status.killSwitchActive ? "Active" : "Clear"}
      />
      <StatusItem
        active={status.dryRun || !status.tradingEnabled}
        icon={Gauge}
        label="Trading"
        value={
          status.tradingEnabled
            ? status.confirmLiveOrder
              ? "Enabled"
              : "Unconfirmed"
            : "Disabled"
        }
      />
    </section>
  );
}

function DashboardPage({
  account,
  accountError,
  accountLoading,
  metrics,
  onSync,
  runs,
  status,
}) {
  return (
    <>
      <AccountOverview
        error={accountError}
        loading={accountLoading}
        onSync={onSync}
        snapshot={account?.snapshot}
        status={status}
        updatedAt={account?.updatedAt}
      />
      <MetricsGrid metrics={metrics} />
      <StatusStrip status={status} />
      <section className="dashboard-grid">
        <section className="detail-section">
          <div className="section-heading">
            <span>Recent Activity</span>
            <strong>{runs.length} runs</strong>
          </div>
          <RunList activeRunId={runs.at(-1)?.id} runs={runs.slice(-4)} onSelectRun={() => {}} />
        </section>
      </section>
    </>
  );
}

function LedgerPage({
  activeRun,
  activeRunId,
  activeView,
  eventTypes,
  filteredEvents,
  invalidLines,
  logFile,
  onSelectEvent,
  onSelectRun,
  onViewChange,
  query,
  runs,
  selectedEvent,
  selectedEventIndex,
  setQuery,
  setTypeFilter,
  status,
  typeFilter,
  updatedAt,
}) {
  return (
    <>
      <PageHeader
        title="Audit Ledger"
        subtitle="Inspect strategy runs, order reviews, broker responses, and raw JSONL events."
      />
      <section className="control-row">
        <div className="segmented" aria-label="View">
          <button
            className={activeView === "runs" ? "active" : ""}
            onClick={() => onViewChange("runs")}
          >
            Runs
          </button>
          <button
            className={activeView === "events" ? "active" : ""}
            onClick={() => onViewChange("events")}
          >
            Events
          </button>
        </div>

        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ledger"
          />
        </label>

        <label className="select-box">
          <Filter size={16} />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Event type"
          >
            {eventTypes.map((type) => (
              <option value={type} key={type}>
                {type === "all" ? "All types" : humanizeType(type)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="workspace">
        <div className="primary-pane">
          {activeView === "runs" ? (
            <RunList activeRunId={activeRunId} runs={runs} onSelectRun={onSelectRun} />
          ) : (
            <EventList
              events={filteredEvents}
              selectedEventIndex={selectedEventIndex}
              onSelectEvent={onSelectEvent}
            />
          )}
        </div>

        <aside className="detail-pane">
          <DetailPanel
            activeRun={activeRun}
            event={selectedEvent}
            status={status}
            invalidLines={invalidLines}
            logFile={logFile}
            updatedAt={updatedAt}
          />
        </aside>
      </section>
    </>
  );
}

function StrategyPage(props) {
  return (
    <>
      <PageHeader
        title="Strategy Control"
        subtitle="Select the active strategy, tune model behavior, and preview what the bot may do."
      />
      <StrategyControlCenter {...props} headingTitle="Strategy Control" />
    </>
  );
}

function RiskPage(props) {
  return (
    <>
      <PageHeader
        title="Risk & Limits"
        subtitle="Configure hard server-side limits, symbol policy, and asset-class permissions."
      />
      <StrategyControlCenter {...props} headingTitle="Risk & Limits" />
    </>
  );
}

function ExecutionPage(props) {
  return (
    <>
      <PageHeader
        title="Execution"
        subtitle="Control dry-run/live mode, kill switch state, and manual execution gates."
      />
      <StrategyControlCenter {...props} headingTitle="Execution Controls" />
      <OrderReviewCard />
    </>
  );
}

function SettingsPage({
  error,
  health,
  invalidLines,
  logFile,
  onPatch,
  onReset,
  onSave,
  saving,
  settings,
  status,
  updatedAt,
}) {
  if (!settings) {
    return (
      <section className="control-center loading-panel">
        <RefreshCw size={18} className="spin" />
        <span>Loading settings</span>
      </section>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Manage local preferences, persisted config health, and audit file status."
      />
      <section className="control-center">
        <div className="control-heading">
          <div>
            <p className="eyebrow">application preferences</p>
            <h2>Settings</h2>
          </div>
          <div className="control-actions">
            <button className="secondary-button" onClick={onReset} disabled={saving}>
              <RotateCcw size={16} />
              <span>Reset Config</span>
            </button>
            <button className="primary-button light" onClick={onSave} disabled={saving}>
              <Save size={16} />
              <span>{saving ? "Saving" : "Save Settings"}</span>
            </button>
          </div>
        </div>
        {error ? (
          <div className="settings-alert error">
            <XCircle size={18} />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="settings-layout compact">
          <SettingsSection
            icon={Settings}
            title="UI Preferences"
            subtitle="Local app behavior; no secrets are stored here."
          >
            <NumberSetting
              label="Refresh Interval Seconds"
              min={5}
              onChange={(value) => onPatch("ui.refreshIntervalSeconds", value)}
              step={1}
              value={settings.ui.refreshIntervalSeconds}
            />
            <label className="select-setting">
              <span>Theme</span>
              <select
                value={settings.ui.theme}
                onChange={(event) => onPatch("ui.theme", event.target.value)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <ToggleRow
              checked={settings.ui.compactMode}
              label="Compact Mode"
              onChange={(value) => onPatch("ui.compactMode", value)}
            />
          </SettingsSection>
          <SettingsSection
            icon={ListChecks}
            title="File Health"
            subtitle="The browser sees only safe status, not secrets."
          >
            <div className="preview-list">
              <MiniStat label="Settings file" value="data/settings.json" />
              <MiniStat label="Settings health" value={health?.ok ? "Healthy" : "Recovered"} />
              <MiniStat label="Audit file" value={logFile ?? "logs/trades.jsonl"} />
              <MiniStat label="JSONL status" value={invalidLines ? `${invalidLines} invalid` : "Clean"} />
              <MiniStat label="Ledger checked" value={formatRelative(updatedAt)} />
              <MiniStat label="Account" value={status.accountConfigured ? "Configured" : "Missing"} />
              <MiniStat label="MCP" value={status.mcpConfigured ? "Configured" : "Missing"} />
            </div>
          </SettingsSection>
        </div>
      </section>
    </>
  );
}

function OrderReviewCard() {
  return (
    <section className="detail-section">
      <div className="section-heading">
        <span>Order Review Queue</span>
        <strong>Read-only</strong>
      </div>
      <div className="empty-state compact">
        <ShieldCheck size={20} />
        <span>Live placement remains disabled until review, risk checks, kill switch, and confirmation gates all pass.</span>
      </div>
    </section>
  );
}

function LiveModeBanner() {
  return (
    <section className="live-banner">
      <ShieldAlert size={18} />
      <strong>Live mode is enabled.</strong>
      <span>This can place real orders with real money.</span>
    </section>
  );
}

function StrategyControlCenter({
  account,
  error,
  headingTitle = "Strategy Control Center",
  liveConfirmationText,
  onKillSwitch,
  onPatch,
  onReset,
  onRunStrategy,
  onSave,
  saving,
  settings,
  status,
  strategies,
  strategyRunning,
  validation,
  visibleSections,
}) {
  if (!settings) {
    return (
      <section className="control-center loading-panel">
        <RefreshCw size={18} className="spin" />
        <span>Loading control settings</span>
      </section>
    );
  }

  const warnings = validation?.warnings ?? [];
  const maxDailySpend = Number(settings.risk.maxDailySpend ?? 0);
  const possibleSymbols = settings.strategy.allowedSymbols.filter(
    (symbol) => !settings.strategy.blockedSymbols.includes(symbol)
  );
  const shownSections = new Set(
    visibleSections ?? ["execution", "symbols", "risk", "strategy", "preview"]
  );

  return (
    <section className="control-center" aria-label="Strategy Control Center">
      <div className="control-heading">
        <div>
          <p className="eyebrow">persistent settings</p>
          <h2>{headingTitle}</h2>
        </div>

        <div className="control-actions">
          <button className="secondary-button" onClick={onReset} disabled={saving}>
            <RotateCcw size={16} />
            <span>Reset</span>
          </button>
          <button className="secondary-button" onClick={onRunStrategy} disabled={strategyRunning}>
            <Play size={16} />
            <span>{strategyRunning ? "Starting" : "Run Strategy"}</span>
          </button>
          <button className="primary-button light" onClick={onSave} disabled={saving}>
            <Save size={16} />
            <span>{saving ? "Saving" : "Save Settings"}</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="settings-alert error">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="settings-alert">
          <AlertTriangle size={18} />
          <span>{warnings.join(" ")}</span>
        </div>
      ) : null}

      <div className="settings-layout">
        {shownSections.has("execution") ? (
          <SettingsSection
          icon={Power}
          title="Mode & Execution"
          subtitle="Safety gates are saved locally and consumed by the trading loop."
        >
          <ToggleRow
            checked={settings.mode.dryRun}
            label="Dry Run"
            note="Keeps the bot in review-only mode."
            onChange={(value) => onPatch("mode.dryRun", value)}
          />
          <ToggleRow
            checked={settings.mode.tradingEnabled}
            label="Trading Enabled"
            note="Requires confirmation and dry run off before live placement."
            onChange={(value) => onPatch("mode.tradingEnabled", value)}
          />
          <ToggleRow
            checked={settings.mode.confirmLiveOrder}
            label="Live Confirmation Gate"
            note={`Saving live mode requires typing ${liveConfirmationText}.`}
            onChange={(value) => onPatch("mode.confirmLiveOrder", value)}
          />
          <div className="execution-grid">
            <MiniStat label="Account" value={account?.snapshot?.account ?? "masked"} />
            <MiniStat label="MCP" value={status.mcpConfigured ? "Configured" : "Missing"} />
          </div>
          <button
            className={`kill-button ${status.killSwitchActive ? "armed" : ""}`}
            onClick={() => onKillSwitch(!status.killSwitchActive)}
          >
            <ShieldAlert size={16} />
            <span>{status.killSwitchActive ? "Disable Kill Switch" : "Enable Kill Switch"}</span>
          </button>
        </SettingsSection>
        ) : null}

        {shownSections.has("symbols") ? (
          <SettingsSection
          icon={ListChecks}
          title="Symbols"
          subtitle="Edit the bot's watchlist, allowlist, and hard blocklist."
        >
          <SymbolListEditor
            label="Allowed Symbols"
            onChange={(value) => onPatch("strategy.allowedSymbols", value)}
            values={settings.strategy.allowedSymbols}
          />
          <SymbolListEditor
            label="Watchlist"
            onChange={(value) => onPatch("strategy.watchSymbols", value)}
            values={settings.strategy.watchSymbols}
          />
          <SymbolListEditor
            label="Blocked Symbols"
            onChange={(value) => onPatch("strategy.blockedSymbols", value)}
            values={settings.strategy.blockedSymbols}
          />
        </SettingsSection>
        ) : null}

        {shownSections.has("risk") ? (
          <SettingsSection
          icon={Gauge}
          title="Risk Limits"
          subtitle="Hard checks run before every order review."
        >
          <NumberSetting
            label="Max Dollars Per Trade"
            min={0.01}
            onChange={(value) => onPatch("risk.maxDollarsPerTrade", value)}
            step={0.01}
            value={settings.risk.maxDollarsPerTrade}
          />
          <NumberSetting
            label="Max Trades Per Day"
            min={0}
            onChange={(value) => onPatch("risk.maxTradesPerDay", value)}
            step={1}
            value={settings.risk.maxTradesPerDay}
          />
          <NumberSetting
            label="Max Daily Spend"
            min={0}
            onChange={(value) => onPatch("risk.maxDailySpend", value)}
            step={0.01}
            value={settings.risk.maxDailySpend}
          />
          <NumberSetting
            label="Min Buying Power After Trade"
            min={0}
            onChange={(value) => onPatch("risk.minBuyingPowerAfterTrade", value)}
            step={0.01}
            value={settings.risk.minBuyingPowerAfterTrade}
          />
          <SliderSetting
            label="Max Allocation Per Symbol"
            max={100}
            min={0}
            onChange={(value) =>
              onPatch("risk.maxPortfolioAllocationPercentPerSymbol", value)
            }
            suffix="%"
            value={settings.risk.maxPortfolioAllocationPercentPerSymbol}
          />
          <NumberSetting
            label="Cooldown Minutes"
            min={0}
            onChange={(value) => onPatch("risk.cooldownMinutesAfterTrade", value)}
            step={1}
            value={settings.risk.cooldownMinutesAfterTrade}
          />
          <ToggleRow
            checked={settings.strategy.allowBuys}
            label="Allow Buys"
            onChange={(value) => onPatch("strategy.allowBuys", value)}
          />
          <ToggleRow
            checked={settings.strategy.allowSells}
            label="Allow Sells"
            onChange={(value) => onPatch("strategy.allowSells", value)}
          />
          <ToggleRow
            checked={settings.strategy.allowOptions}
            label="Allow Options"
            note="Advanced, default off."
            onChange={(value) => onPatch("strategy.allowOptions", value)}
          />
          <ToggleRow
            checked={settings.strategy.allowCrypto}
            label="Allow Crypto"
            note="Advanced, default off."
            onChange={(value) => onPatch("strategy.allowCrypto", value)}
          />
        </SettingsSection>
        ) : null}

        {shownSections.has("strategy") ? (
          <SettingsSection
          icon={SlidersHorizontal}
          title="Model / Strategy Tuning"
          subtitle="Parameters that shape strategy proposals before risk checks."
        >
          <StrategySelector
            definitions={strategies}
            onChange={(value) => onPatch("strategy.activeStrategy", value)}
            value={settings.strategy.activeStrategy}
          />
          <NumberSetting
            label="Fixed DCA Amount"
            min={0.01}
            onChange={(value) => onPatch("strategy.fixedDcaAmount", value)}
            step={0.01}
            value={settings.strategy.fixedDcaAmount}
          />
          <SliderSetting
            label="Risk Tolerance"
            max={1}
            min={0}
            onChange={(value) => onPatch("modelTuning.riskTolerance", value)}
            step={0.01}
            value={settings.modelTuning.riskTolerance}
          />
          <SliderSetting
            label="Cash Reserve"
            max={100}
            min={0}
            onChange={(value) => onPatch("modelTuning.cashReservePercent", value)}
            suffix="%"
            value={settings.modelTuning.cashReservePercent}
          />
          <SliderSetting
            label="Dip Buy Threshold"
            max={20}
            min={0}
            onChange={(value) => onPatch("modelTuning.dipBuyThresholdPercent", value)}
            step={0.1}
            suffix="%"
            value={settings.modelTuning.dipBuyThresholdPercent}
          />
          <SliderSetting
            label="Take Profit"
            max={100}
            min={0}
            onChange={(value) => onPatch("modelTuning.takeProfitPercent", value)}
            suffix="%"
            value={settings.modelTuning.takeProfitPercent}
          />
          <SliderSetting
            label="Stop Loss"
            max={100}
            min={0}
            onChange={(value) => onPatch("modelTuning.stopLossPercent", value)}
            suffix="%"
            value={settings.modelTuning.stopLossPercent}
          />
          <SliderSetting
            label="Confidence"
            max={1}
            min={0}
            onChange={(value) => onPatch("modelTuning.confidenceThreshold", value)}
            step={0.01}
            value={settings.modelTuning.confidenceThreshold}
          />
          <label className="select-setting">
            <span>Position Sizing</span>
            <select
              value={settings.modelTuning.positionSizingMode}
              onChange={(event) =>
                onPatch("modelTuning.positionSizingMode", event.target.value)
              }
            >
              <option value="fixed_dollars">Fixed dollars</option>
              <option value="percent_of_buying_power">Percent of buying power</option>
              <option value="volatility_adjusted">Volatility adjusted</option>
              <option value="equal_weight">Equal weight</option>
            </select>
          </label>
        </SettingsSection>
        ) : null}

        {shownSections.has("preview") ? (
          <SettingsSection
          icon={Eye}
          title="Preview / Simulation"
          subtitle="A plain-English preview before saving."
        >
          <div className="preview-list">
            <MiniStat label="Example trade size" value={formatCurrency(settings.risk.maxDollarsPerTrade)} />
            <MiniStat label="Max daily spend" value={formatCurrency(maxDailySpend)} />
            <MiniStat label="Tradable symbols" value={possibleSymbols.join(", ") || "None"} />
            <MiniStat label="Sells" value={settings.strategy.allowSells ? "Allowed" : "Blocked"} />
            <MiniStat label="Live mode" value={isLiveMode(settings) ? "Enabled" : "Disabled"} />
            <MiniStat label="Manual live review" value={settings.risk.requireManualConfirmationForLive ? "Required" : "Not required"} />
          </div>
          <div className="strategy-explainer">
            {strategies[settings.strategy.activeStrategy] ?? "No explanation available."}
          </div>
        </SettingsSection>
        ) : null}
      </div>
    </section>
  );
}

function SettingsSection({ children, icon: Icon, subtitle, title }) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <Icon size={18} />
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className="settings-controls">{children}</div>
    </section>
  );
}

function ToggleRow({ checked, label, note, onChange }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {note ? <small>{note}</small> : null}
      </span>
      <input
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function NumberSetting({ label, min = 0, onChange, step = 1, value }) {
  return (
    <label className="number-setting">
      <span>{label}</span>
      <input
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function SliderSetting({ label, max, min, onChange, step = 1, suffix = "", value }) {
  return (
    <label className="slider-setting">
      <span>
        {label}
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function SymbolListEditor({ label, onChange, values }) {
  const [draft, setDraft] = useState("");

  function addSymbol() {
    const symbol = normalizeSymbol(draft);

    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) {
      return;
    }

    onChange(Array.from(new Set([...values, symbol])));
    setDraft("");
  }

  return (
    <div className="symbol-editor">
      <span>{label}</span>
      <div className="symbol-pills">
        {values.map((symbol) => (
          <button
            className="symbol-pill"
            key={symbol}
            onClick={() => onChange(values.filter((item) => item !== symbol))}
            title={`Remove ${symbol}`}
          >
            {symbol}
            <XCircle size={13} />
          </button>
        ))}
      </div>
      <div className="symbol-add">
        <input
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addSymbol();
            }
          }}
          placeholder="Add symbol"
          value={draft}
        />
        <button onClick={addSymbol}>Add</button>
      </div>
    </div>
  );
}

function StrategySelector({ definitions, onChange, value }) {
  return (
    <label className="select-setting">
      <span>Active Strategy</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {Object.keys(definitions).map((strategy) => (
          <option key={strategy} value={strategy}>
            {strategy.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function ConfirmationModal({
  confirmationText,
  onCancel,
  onChange,
  onConfirm,
  open,
  saving,
  value,
}) {
  if (!open) return null;

  const confirmed = value === confirmationText;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-modal" role="dialog" aria-modal="true">
        <ShieldAlert size={24} />
        <h2>Enable Live Trading</h2>
        <p>This can place real orders with real money.</p>
        <label>
          <span>Type {confirmationText}</span>
          <input
            autoFocus
            onChange={(event) => onChange(event.target.value)}
            value={value}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={!confirmed || saving}
            onClick={onConfirm}
          >
            Enable Live Trading
          </button>
        </div>
      </section>
    </div>
  );
}

function AccountOverview({ error, loading, onSync, snapshot, status, updatedAt }) {
  const portfolio = getPortfolioData(snapshot);
  const positions = getPositions(snapshot);
  const quotes = getQuotes(snapshot);
  const recentOrders = getRecentOrders(snapshot).slice(0, 5);
  const accountConfigured = status.accountConfigured && status.mcpConfigured;

  const accountMetrics = [
    {
      icon: Wallet,
      label: "Portfolio",
      value: formatCurrency(portfolio.total_value),
      detail: `Equity ${formatCurrency(portfolio.equity_value)}`,
    },
    {
      icon: DollarSign,
      label: "Cash",
      value: formatCurrency(portfolio.cash),
      detail: "Broker cash",
    },
    {
      icon: BarChart3,
      label: "Buying Power",
      value: formatCurrency(portfolio.buying_power?.buying_power),
      detail: portfolio.buying_power?.display_currency ?? "USD",
    },
    {
      icon: Layers,
      label: "Positions",
      value: positions.length || "None",
      detail: snapshot?.symbols?.join(", ") || "No sync yet",
    },
  ];

  return (
    <section className="account-panel" aria-label="Robinhood account snapshot">
      <div className="account-heading">
        <div>
          <p className="eyebrow">read-only snapshot</p>
          <h2>Account Overview</h2>
        </div>
        <div className="account-actions">
          <span className="sync-time">
            {snapshot ? `Synced ${formatRelative(snapshot.syncedAt)}` : "Not synced"}
          </span>
          <button
            className="primary-button"
            disabled={loading || !accountConfigured}
            onClick={onSync}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
            <span>{loading ? "Syncing" : "Sync Robinhood"}</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="account-alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="account-grid">
        {accountMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article className="account-metric" key={metric.label}>
              <Icon size={18} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          );
        })}
      </div>

      <div className="market-grid">
        <section className="market-section">
          <div className="section-heading">
            <span>Positions</span>
            <strong>{positions.length}</strong>
          </div>
          <div className="data-list">
            {positions.slice(0, 6).map((position) => (
              <div className="data-row" key={position.symbol}>
                <div>
                  <strong>{position.symbol}</strong>
                  <span>{position.type ?? "long"}</span>
                </div>
                <div>
                  <strong>{formatQuantity(position.quantity)}</strong>
                  <span>{formatCurrency(position.average_buy_price)}</span>
                </div>
              </div>
            ))}
            {!positions.length ? (
              <div className="empty-inline">
                <ListChecks size={18} />
                <span>No synced positions</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="market-section">
          <div className="section-heading">
            <span>Quotes</span>
            <strong>{quotes.length}</strong>
          </div>
          <div className="quote-strip">
            {quotes.slice(0, 6).map((entry) => {
              const quote = entry.quote ?? {};
              const previous = Number(quote.adjusted_previous_close);
              const current = Number(quote.last_trade_price);
              const change =
                Number.isFinite(previous) && Number.isFinite(current)
                  ? ((current - previous) / previous) * 100
                  : null;

              return (
                <article className="quote-card" key={quote.symbol}>
                  <span>{quote.symbol}</span>
                  <strong>{formatCurrency(quote.last_trade_price)}</strong>
                  <small className={change >= 0 ? "positive" : "negative"}>
                    {change == null ? "No change" : `${change.toFixed(2)}%`}
                  </small>
                </article>
              );
            })}
            {!quotes.length ? (
              <div className="empty-inline">
                <BarChart3 size={18} />
                <span>No synced quotes</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="market-section orders">
          <div className="section-heading">
            <span>Recent Orders</span>
            <strong>{recentOrders.length}</strong>
          </div>
          <div className="data-list">
            {recentOrders.map((order) => (
              <div className="data-row" key={order.id}>
                <div>
                  <strong>{order.symbol}</strong>
                  <span>
                    {order.side} {order.type}
                  </span>
                </div>
                <div>
                  <strong>{getOrderAmount(order)}</strong>
                  <span>{order.state ?? "unknown"}</span>
                </div>
              </div>
            ))}
            {!recentOrders.length ? (
              <div className="empty-inline">
                <ListChecks size={18} />
                <span>No synced orders</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="account-foot">
        <span>Account {snapshot?.account ?? "masked"}</span>
        <span>{updatedAt ? `Cache checked ${formatRelative(updatedAt)}` : "Cache idle"}</span>
      </div>
    </section>
  );
}

function StatusItem({ active, icon: Icon, label, value }) {
  return (
    <article className={`status-item ${active ? "active" : "inactive"}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function RunList({ activeRunId, runs, onSelectRun }) {
  if (!runs.length) {
    return (
      <div className="empty-state">
        <AlertTriangle size={22} />
        <span>No ledger events yet.</span>
      </div>
    );
  }

  return (
    <div className="run-list">
      {[...runs].reverse().map((run) => (
        <button
          className={`run-card ${activeRunId === run.id ? "selected" : ""}`}
          key={run.id}
          onClick={() => onSelectRun(run)}
        >
          <div className="run-main">
            <div className={`run-status ${run.errored ? "error" : run.live ? "live" : run.dry ? "dry" : run.held ? "hold" : "open"}`}>
              {run.errored ? <XCircle size={16} /> : run.live ? <CheckCircle2 size={16} /> : <Eye size={16} />}
              <span>
                {run.errored
                  ? "Error"
                  : run.live
                    ? "Live"
                    : run.dry
                      ? "Dry run"
                      : run.held
                        ? "Hold"
                        : "Open"}
              </span>
            </div>
            <strong>Run {run.index}</strong>
            <p>{run.summary}</p>
          </div>

          <div className="run-meta">
            <span className="symbol-chip">{run.symbol}</span>
            <span>{run.events.length} events</span>
            <time>{formatTime(run.startedAt, { dateStyle: "short" })}</time>
          </div>
        </button>
      ))}
    </div>
  );
}

function EventList({ events, selectedEventIndex, onSelectEvent }) {
  if (!events.length) {
    return (
      <div className="empty-state">
        <Search size={22} />
        <span>No matching events.</span>
      </div>
    );
  }

  return (
    <div className="event-list">
      {[...events].reverse().map((event) => (
        <button
          className={`event-row ${selectedEventIndex === event.eventIndex ? "selected" : ""}`}
          key={`${event.timestamp}-${event.eventIndex}`}
          onClick={() => onSelectEvent(event)}
        >
          <span className={`event-dot ${getEventTone(event.type)}`} />
          <div>
            <strong>{humanizeType(event.type)}</strong>
            <p>{getEventSummary(event)}</p>
          </div>
          <time>{formatTime(event.timestamp, { dateStyle: "short" })}</time>
        </button>
      ))}
    </div>
  );
}

function DetailPanel({ activeRun, event, status, invalidLines, logFile, updatedAt }) {
  const runEvents = activeRun?.events ?? [];
  const timelineMax = Math.max(1, runEvents.length - 1);

  return (
    <div className="detail-stack">
      <section className="detail-section">
        <div className="section-heading">
          <span>Selected Event</span>
          <strong>{event ? humanizeType(event.type) : "None"}</strong>
        </div>
        {event ? (
          <>
            <div className="event-focus">
              <span className={`event-dot ${getEventTone(event.type)}`} />
              <div>
                <p>{getEventSummary(event)}</p>
                <time>{formatTime(event.timestamp)}</time>
              </div>
            </div>

            <div className="detail-grid">
              <MiniStat label="Symbol" value={getSymbol(event) || "None"} />
              <MiniStat label="Amount" value={getAmount(event) || "None"} />
              <MiniStat label="Side" value={event.decision?.side ?? event.trade?.side ?? event.order?.side ?? "None"} />
              <MiniStat label="Type" value={event.order?.type ?? event.decision?.assetType ?? event.trade?.assetType ?? "None"} />
            </div>

            <pre className="json-view">{JSON.stringify(event, null, 2)}</pre>
          </>
        ) : (
          <div className="empty-state compact">
            <AlertTriangle size={20} />
            <span>Select a run or event.</span>
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <span>Run Timeline</span>
          <strong>{activeRun ? `Run ${activeRun.index}` : "None"}</strong>
        </div>
        <div className="timeline">
          {runEvents.map((item, index) => (
            <div className="timeline-item" key={`${item.type}-${index}`}>
              <span
                className={`event-dot ${getEventTone(item.type)}`}
                style={{ "--progress": `${(index / timelineMax) * 100}%` }}
              />
              <div>
                <strong>{humanizeType(item.type)}</strong>
                <small>{formatTime(item.timestamp, { dateStyle: "short" })}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <span>Limits</span>
          <strong>{status.strategy ?? "starter_voo"}</strong>
        </div>
        <div className="limit-list">
          <MiniStat label="Allowed" value={(status.allowedSymbols ?? []).join(", ") || "None"} />
          <MiniStat label="Watchlist" value={(status.watchSymbols ?? []).join(", ") || "VOO"} />
          <MiniStat label="Max dollars" value={`$${status.maxDollarsPerTrade ?? 0}`} />
          <MiniStat label="Max trades" value={status.maxTradesPerDay ?? 0} />
          <MiniStat label="Sells" value={status.allowSells ? "Allowed" : "Blocked"} />
          <MiniStat label="Options" value={status.allowOptions ? "Allowed" : "Blocked"} />
        </div>
        <div className="file-line">
          <span>{logFile ?? "logs/trades.jsonl"}</span>
          <span>{invalidLines ? `${invalidLines} invalid lines` : "JSONL clean"}</span>
          <span>{formatRelative(updatedAt)}</span>
        </div>
      </section>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
