import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./firebase";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const LATENCY_TARGETS = {
  google: { label: "Google", url: "https://www.google.com/generate_204" },
  cloudflare: { label: "Cloudflare", url: "https://www.cloudflare.com/cdn-cgi/trace" },
  api: { label: "Servidor do monitor", url: `${API}/health` },
};
const deviceId = localStorage.getItem("network-monitor-device-id") || crypto.randomUUID();
localStorage.setItem("network-monitor-device-id", deviceId);

function connectionError() {
  return `Não foi possível conectar à API em ${API}. Inicie o backend ou configure VITE_API_URL.`;
}

function percentile(values, reducer) {
  return values.length ? Number(reducer(values).toFixed(2)) : null;
}

function packetLoss(sent, received) {
  if (!sent) return null;
  return Number((((sent - received) / sent) * 100).toFixed(2));
}

async function measureLatency(target, signal) {
  const started = performance.now();
  try {
    await fetch(`${target.url}${target.url.includes("?") ? "&" : "?"}network-monitor=${Date.now()}`, {
      cache: "no-store", mode: target.url.startsWith(API) ? "cors" : "no-cors", signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Servidor de pesquisa do Google indisponível");
  }
  return performance.now() - started;
}

async function measureDownload(signal) {
  const requests = 4;
  const started = performance.now();
  const transfers = await Promise.all(Array.from({ length: requests }, (_, index) =>
    fetch(`${API}/api/measurement-download?run=${Date.now()}-${index}`, { cache: "no-store", signal })
      .then((response) => response.arrayBuffer())
  ));
  const bytes = transfers.reduce((total, data) => total + data.byteLength, 0);
  return (bytes * 8) / ((performance.now() - started) / 1000) / 1_000_000;
}

async function measureUpload(signal) {
  const requests = 4;
  const payloads = Array.from({ length: requests }, () => {
    const data = new Uint8Array(5 * 1024 * 1024);
    for (let offset = 0; offset < data.length; offset += 65_536) {
      crypto.getRandomValues(data.subarray(offset, Math.min(offset + 65_536, data.length)));
    }
    return data;
  });
  const started = performance.now();
  await Promise.all(payloads.map((data) =>
    fetch(`${API}/api/measurement-upload?run=${Date.now()}`, {
      method: "POST", body: data, cache: "no-store", signal,
    })
  ));
  const bytes = payloads.reduce((total, data) => total + data.byteLength, 0);
  return (bytes * 8) / ((performance.now() - started) / 1000) / 1_000_000;
}

function App() {
  const [page, setPage] = useState("collect");
  const [interval, setIntervalValue] = useState(60);
  const [samples, setSamples] = useState(4);
  const [speed, setSpeed] = useState(false);
  const [deviceType, setDeviceType] = useState("notebook");
  const [connectionType, setConnectionType] = useState("wifi");
  const [targetKey, setTargetKey] = useState("google");
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState(null);
  const [error, setError] = useState("");
  const loopTask = useRef(null);
  const controller = useRef(null);
  const runToken = useRef(0);
  const runningRef = useRef(false);

  async function runMeasurement() {
    const token = runToken.current;
    controller.current = new AbortController();
    const { signal } = controller.current;
    const latencies = [];
    for (let index = 0; index < Number(samples); index += 1) {
      if (token !== runToken.current) return;
      try { latencies.push(await measureLatency(LATENCY_TARGETS[targetKey], signal)); } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    if (token !== runToken.current) return;
    const average = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null;
    const jitter = latencies.length > 1 ? Math.sqrt(latencies.reduce((sum, value) => sum + (value - average) ** 2, 0) / latencies.length) : null;
    const measurement = {
      device_id: deviceId, device_type: deviceType,
      connection_type: connectionType, latency_target: LATENCY_TARGETS[targetKey].label,
      latency_target_url: LATENCY_TARGETS[targetKey].url,
      timestamp: new Date().toISOString(),
      samples_sent: Number(samples), samples_received: latencies.length,
      latency_min_ms: percentile(latencies, Math.min), latency_avg_ms: average === null ? null : Number(average.toFixed(2)),
      latency_max_ms: percentile(latencies, Math.max), jitter_ms: jitter === null ? null : Number(jitter.toFixed(2)),
      download_mbps: null,
      upload_mbps: null,
    };
    if (speed) {
      try {
        measurement.download_mbps = Number((await measureDownload(signal)).toFixed(2));
        measurement.upload_mbps = Number((await measureUpload(signal)).toFixed(2));
      } catch (error) {
        if (error.name === "AbortError") return;
        throw error;
      }
    }
    if (token !== runToken.current) return;
    let response;
    try {
      response = await fetch(`${API}/api/client-measurements`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(measurement), signal,
      });
    } catch (error) {
      if (error.name === "AbortError") return;
      throw new Error(connectionError());
    }
    if (!response.ok) throw new Error("Não foi possível enviar a medição.");
    setLast(measurement);
  }

  async function start(event) {
    event.preventDefault();
    if (runningRef.current) return;
    setError(""); setRunning(true); runToken.current += 1;
    runningRef.current = true;
    const token = runToken.current;
    loopTask.current = (async () => {
      try {
        while (token === runToken.current) {
          await runMeasurement();
          if (token !== runToken.current) return;
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, Number(interval) * 1000);
            controller.current?.signal.addEventListener("abort", () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
        }
      } catch (error) {
        if (token === runToken.current && error.name !== "AbortError") {
          setError(error.message);
          runningRef.current = false;
          setRunning(false);
        }
      }
    })();
  }

  function stop() {
    runToken.current += 1;
    loopTask.current = null;
    controller.current?.abort(); controller.current = null;
    runningRef.current = false;
    setRunning(false);
  }

  useEffect(() => () => { runToken.current += 1; controller.current?.abort(); }, []);

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">Web</span><span>LinkWeb</span></div><nav><button className={page === "collect" ? "nav-active" : ""} onClick={() => setPage("collect")}>Coletar dados</button><button className={page === "dashboard" ? "nav-active" : ""} onClick={() => setPage("dashboard")}>Dashboard</button></nav><span className={`connection-pill ${running ? "is-live" : ""}`}><span className="status-dot" />{running ? "Coleta ativa" : "Pronto"}</span></header>
      {page === "collect" ? <Collector {...{ interval, setIntervalValue, samples, setSamples, speed, setSpeed, deviceType, setDeviceType, connectionType, setConnectionType, targetKey, setTargetKey, running, last, error, start, stop }} /> : <Dashboard />}
      <footer>LinkWeb <span>•</span> Google como destino de latência</footer>
    </div>
  );
}

function Collector({ interval, setIntervalValue, samples, setSamples, speed, setSpeed, deviceType, setDeviceType, connectionType, setConnectionType, targetKey, setTargetKey, running, last, error, start, stop }) {
  return <main className="content"><section className="hero"><div><p className="eyebrow">MONITORAMENTO DO DISPOSITIVO</p><h1>Teste a qualidade da sua rede</h1><p className="hero-text">O navegador mede a conexão até o servidor de pesquisa do Google e envia os resultados para análise.</p></div><div className="device-badge"><span className="device-icon">⌁</span><div><strong>Dispositivo identificado</strong><small>{deviceTypeLabel(deviceType)} • {connectionTypeLabel(connectionType)}</small></div></div></section><div className="layout-grid"><section className="card setup-card"><div className="card-heading"><div><p className="eyebrow">CONFIGURAÇÃO</p><h2>Configuração</h2></div><span className="step-number">01</span></div><form onSubmit={running ? (e) => { e.preventDefault(); stop(); } : start}><div className="form-row"><label>Dispositivo<select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}><option value="tablet">Tablet</option><option value="notebook">Notebook</option><option value="desktop">Desktop</option></select></label><label>Conexão<select value={connectionType} onChange={(e) => setConnectionType(e.target.value)}><option value="wifi">Wi-Fi</option><option value="cabled">Internet cabeada</option></select></label>  </div><label>Servidor de teste<select value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>{Object.entries(LATENCY_TARGETS).map(([key, target]) => <option key={key} value={key}>{target.label}</option>)}</select></label><div className="form-row"><label>Intervalo<div className="input-suffix"><input type="number" min="1" max="3600" value={interval} onChange={(e) => setIntervalValue(e.target.value)} /><span>seg.</span></div></label><label>Amostras<div className="input-suffix"><input type="number" min="1" max="20" value={samples} onChange={(e) => setSamples(e.target.value)} /><span>pings</span></div></label></div><label className="toggle-row"><input type="checkbox" checked={speed} onChange={(e) => setSpeed(e.target.checked)} /><span className="toggle" /><span><strong>Testar velocidade</strong><small>Inclui download e upload</small></span></label>  <button className={`primary-button ${running ? "stop-button" : ""}`} type="submit"><span>{running ? "■" : "▶"}</span>{running ? "Parar coleta" : "Iniciar coleta online"}</button></form>{error && <p className="error-message" role="alert">{error}</p>}</section><section className="card result-card"><div className="card-heading"><div>  <p className="eyebrow">{last?.latency_target || LATENCY_TARGETS[targetKey].label}</p><h2>Última medição</h2></div><span className={`result-status ${last ? "has-result" : ""}`}><span className="status-dot" />{last ? "Recebido" : "Aguardando"}</span></div>{last ? <div className="metrics"><Metric label="Data e hora" value={formatTimestamp(last.timestamp)} unit="" icon="◷" /><Metric label="Latência média" value={last.latency_avg_ms} unit="ms" icon="↔" /><Metric label="Jitter" value={last.jitter_ms} unit="ms" icon="≋" />  <Metric label="Perda de pacotes" value={packetLoss(last.samples_sent, last.samples_received)} unit="%" icon="◌" /><Metric label="Download" value={last.download_mbps} unit="Mbps" icon="↓" /><Metric label="Upload" value={last.upload_mbps} unit="Mbps" icon="↑" /></div> : <div className="empty-state"><div className="empty-icon">◌</div><h3>Nenhuma medição ainda</h3><p>Configure o teste e inicie a coleta.</p></div>}{running && <div className="live-message"><span className="pulse" /> Coleta repetida a cada <strong>{interval} segundos</strong>.</div>}</section></div></main>;
}

function Dashboard() {
  const [filters, setFilters] = useState({
    device_type: "", connection_type: "", date_from: "", date_to: "", sort: "newest",
  });
  const [sort, setSort] = useState("newest");
  const [data, setData] = useState([]);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selected, setSelected] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  useEffect(() => {
    const load = () => fetch(`${API}/api/client-measurements?${new URLSearchParams(filters)}`)
      .then((response) => { if (!response.ok) throw new Error("Não foi possível carregar as medições."); return response.json(); })
      .then((items) => { setData(items); setError(""); })
      .catch(() => setError(`Não foi possível carregar os dados da API em ${API}.`));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [filters]);
  const filteredData = data.filter((item) => {
    const date = item.timestamp.slice(0, 10);
    return (!filters.date_from || date >= filters.date_from) &&
      (!filters.date_to || date <= filters.date_to);
  });
  const sortedData = [...filteredData].sort((a, b) => {
    const metric = sort === "newest" || sort === "oldest" ? "timestamp" : sort.replace(/-(asc|desc)$/, "");
    const direction = sort === "oldest" || sort.endsWith("-asc") ? 1 : -1;
    const aValue = metric === "timestamp" ? new Date(a.timestamp).getTime() : metricValue(a, metric);
    const bValue = metric === "timestamp" ? new Date(b.timestamp).getTime() : metricValue(b, metric);
    if (!Number.isFinite(aValue)) return 1;
    if (!Number.isFinite(bValue)) return -1;
    return direction * (aValue - bValue);
  });
  const recent = sortedData.slice(0, 20).reverse();
  function toggleSelected(id) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }
  async function removeSelected() {
    if (!selectionMode) {
      setSelectionMode(true);
      setActionError("");
      return;
    }
    if (!selected.length || !window.confirm(`Deseja apagar ${selected.length} medição(ões) selecionada(s)?`)) return;
    const responses = await Promise.all(selected.map((id) => fetch(`${API}/api/client-measurements/${encodeURIComponent(id)}`, { method: "DELETE" })));
    if (responses.some((response) => !response.ok)) { setActionError("Não foi possível apagar uma ou mais medições. Reinicie a API e tente novamente."); return; }
    setData((items) => items.filter((item) => !selected.includes(item.id)));
    setSelected([]);
    setSelectionMode(false);
  }
  async function removeAll() {
    if (!window.confirm("Deseja apagar todas as medições coletadas? Esta ação não pode ser desfeita.")) return;
    const response = await fetch(`${API}/api/client-measurements`, { method: "DELETE" });
    if (!response.ok) { setActionError("Não foi possível apagar as medições."); return; }
    setData([]); setSelected([]);
  }
  return <main className="content">
    <section className="hero dashboard-hero"><div><p className="eyebrow">VISÃO GERAL</p><h1>Dashboard de rede</h1><p className="hero-text">Analise latência, jitter, perda de pacotes e velocidade por dispositivo.</p></div><span className="data-count">{filteredData.length} de {data.length} medições</span></section>
    {error && <p className="error-message" role="alert">{error}</p>}
    <section className="card filters">
      <label>Dispositivo<select value={filters.device_type} onChange={(e) => setFilters({ ...filters, device_type: e.target.value })}><option value="">Todos</option><option value="tablet">Tablets</option><option value="notebook">Notebooks</option><option value="desktop">Desktops</option></select></label>
      <label>Conexão<select value={filters.connection_type} onChange={(e) => setFilters({ ...filters, connection_type: e.target.value })}><option value="">Todas</option><option value="wifi">Wi-Fi</option><option value="cabled">Cabeada</option></select></label>
      <label>De<input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></label>
      <label>Até<input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></label>
      <label>Ordenar por<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Mais recentes</option><option value="oldest">Mais antigas</option><option value="download_mbps-desc">Download mais rápido</option><option value="download_mbps-asc">Download mais lento</option><option value="upload_mbps-desc">Upload mais rápido</option><option value="upload_mbps-asc">Upload mais lento</option><option value="latency_avg_ms-asc">Menor latência</option><option value="latency_avg_ms-desc">Maior latência</option><option value="jitter_ms-asc">Menor jitter</option><option value="jitter_ms-desc">Maior jitter</option><option value="packet_loss_percent-asc">Menor perda</option><option value="packet_loss_percent-desc">Maior perda</option></select></label>
    </section>
    <div className="dashboard-grid"><Chart title="Latência média (ms)" data={recent} field="latency_avg_ms" color="#4779e9" /><Chart title="Jitter (ms)" data={recent} field="jitter_ms" color="#9b73e8" /><Chart title="Download (Mbps)" data={recent} field="download_mbps" color="#1aac80" /><Chart title="Upload (Mbps)" data={recent} field="upload_mbps" color="#ed9b4b" /></div>
    <Heatmap data={filteredData} />
    <section className="card table-card"><div className="card-heading"><div><p className="eyebrow">MEDIÇÕES RECEBIDAS</p><h2>Aparelhos monitorados</h2></div><span className="muted">Exibindo até 50 resultados</span></div><div className="table-wrap"><table><thead><tr><th>Data e hora</th><th>Tipo</th><th>Conexão</th><th>Latência</th><th>Jitter</th><th>Perda</th><th>Download</th><th>Upload</th><th>Selecionar</th></tr></thead><tbody>{sortedData.slice(0, 50).map((item, i) => <tr className={packetLoss(item.samples_sent, item.samples_received) > 0 ? "loss-row" : ""} key={`${item.device_id}-${item.timestamp}-${i}`}><td>{formatTimestamp(item.timestamp)}</td><td>{deviceTypeLabel(item.device_type)}</td><td>{connectionTypeLabel(item.connection_type)}</td><td>{formatMetric(item.latency_avg_ms, "ms")}</td><td>{formatMetric(item.jitter_ms, "ms")}</td><td className={packetLoss(item.samples_sent, item.samples_received) > 0 ? "loss-cell" : ""}>{formatMetric(packetLoss(item.samples_sent, item.samples_received), "%")}</td><td>{formatMetric(item.download_mbps, "Mbps")}</td><td>{formatMetric(item.upload_mbps, "Mbps")}</td><td>{selectionMode && <input className="row-checkbox" type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} aria-label="Selecionar medição" />}</td></tr>)}</tbody></table>{!filteredData.length && <p className="muted empty-table">Nenhuma medição encontrada para os filtros.</p>}</div><div className="bulk-actions">{actionError && <p className="error-message" role="alert">{actionError}</p>}<button className="delete-button" onClick={removeSelected} disabled={!filteredData.length}>{selectionMode ? "Confirmar exclusão" : "Apagar selecionadas"}</button>{selectionMode && <button className="cancel-button" onClick={() => { setSelectionMode(false); setSelected([]); }}>Cancelar</button>}<button className="delete-all-button" onClick={removeAll} disabled={!data.length}>Apagar tudo</button></div></section>
  </main>;
}

function Chart({ title, data, field, color }) { const values = data.map((item) => item[field]).filter((value) => value !== null); const max = Math.max(...values, 1); return <section className="card chart-card"><h3>{title}</h3><div className="chart">{values.length ? values.map((value, i) => <span key={i} title={`${value}`} style={{ height: `${Math.max((value / max) * 100, 4)}%`, background: color }} />) : <p className="muted">Sem dados</p>}</div><strong className="chart-average">{values.length ? `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)}` : "—"}</strong></section>; }
function Heatmap({ data }) {
  const [metric, setMetric] = useState("download_mbps");
  const metricInfo = {
    download_mbps: { label: "Download", unit: "Mbps", higherIsBetter: true },
    upload_mbps: { label: "Upload", unit: "Mbps", higherIsBetter: true },
    latency_avg_ms: { label: "Latência", unit: "ms", higherIsBetter: false },
    jitter_ms: { label: "Jitter", unit: "ms", higherIsBetter: false },
    loss: { label: "Perda", unit: "%", higherIsBetter: false },
  }[metric];
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const cells = Array.from({ length: 7 * 24 }, () => []);
  data.forEach((item) => {
    const date = new Date(item.timestamp);
    const value = metric === "loss" ? packetLoss(item.samples_sent, item.samples_received) : item[metric];
    if (Number.isFinite(Number(value))) cells[date.getDay() * 24 + date.getHours()].push(Number(value));
  });
  const averages = cells.map((values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const values = averages.filter((value) => value !== null);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  function color(value) {
    if (value === null) return "#eef2f7";
    if ((metric === "download_mbps" || metric === "upload_mbps")) {
      if (value < 1) return "#f5b5b5";
      if (value < 5) return "#f8d39b";
      return "#b7e5ce";
    }
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const quality = metricInfo.higherIsBetter ? 1 - ratio : ratio;
    return `hsl(${Math.round(135 - quality * 115)} 72% ${Math.round(76 - quality * 18)}%)`;
  }
  return <section className="card heatmap-card">
    <div className="card-heading"><div><p className="eyebrow">QUALIDADE POR HORÁRIO</p><h2>Mapa de qualidade do horário</h2><p className="muted">Média das medições por dia da semana e hora local.</p></div><select className="heatmap-select" value={metric} onChange={(event) => setMetric(event.target.value)}>{Object.entries({ download_mbps: "Download", upload_mbps: "Upload", latency_avg_ms: "Latência", jitter_ms: "Jitter", loss: "Perda de pacotes" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="heatmap-scroll"><div className="heatmap"><div className="heatmap-corner" />{Array.from({ length: 24 }, (_, hour) => <span className="heatmap-hour" key={hour}>{String(hour).padStart(2, "0")}h</span>)}{days.map((day, dayIndex) => <React.Fragment key={day}><span className="heatmap-day">{day}</span>{Array.from({ length: 24 }, (_, hour) => { const index = dayIndex * 24 + hour; const value = averages[index]; return <span className="heatmap-cell" key={hour} title={value === null ? `${day}, ${hour}h: sem dados` : `${day}, ${hour}h: ${value.toFixed(2)} ${metricInfo.unit} (${cells[index].length} medição${cells[index].length === 1 ? "" : "ões"})`} style={{ background: color(value) }}>{value === null ? "" : value.toFixed(1)}</span>; })}</React.Fragment>)}</div></div>
    {!values.length && <p className="muted">Ainda não há medições para montar o mapa.</p>}
  </section>;
}
function Metric({ label, value, unit, icon }) { return <div className="metric"><span className="metric-icon">{icon}</span><div><small>{label}</small><strong>{value ?? "—"} <em>{unit}</em></strong></div></div>; }
function formatMetric(value, unit) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${value} ${unit}`; }
function metricValue(item, metric) {
  if (metric === "packet_loss_percent") return packetLoss(item.samples_sent, item.samples_received);
  if (item[metric] === null || item[metric] === undefined) return null;
  return Number(item[metric]);
}
function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(timestamp));
}
function deviceTypeLabel(type) { return { tablet: "Tablet", notebook: "Notebook", desktop: "Desktop" }[type] || "Dispositivo"; }
function connectionTypeLabel(type) { return { wifi: "Wi-Fi", cabled: "Cabeada", unknown: "Não informada" }[type] || "Não informada"; }
createRoot(document.getElementById("root")).render(<App />);
