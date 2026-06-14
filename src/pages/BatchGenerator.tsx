import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Layers3,
  Play,
  Download,
  RefreshCw,
  Eye,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileText,
  Link2,
  Hash,
  Palette,
  Maximize2,
  BarChart3,
  Filter,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  MonitorSmartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/api";
import {
  evaluateBatchItems,
  getScoreColor,
  getScoreBgColor,
  getGradeBgColor,
} from "@/lib/qualityScore";
import type {
  BatchTask,
  BatchGenerateRequest,
  BatchItemScore,
  ErrorLevel,
} from "@shared/types";

interface PreviewRow {
  id: string;
  value: string;
  url: string;
}

interface TemplateConfig {
  size: number;
  foreground: string;
  background: string;
  errorLevel: ErrorLevel;
}

type SortField = "index" | "score" | "readability" | "aesthetics" | "compatibility";
type SortOrder = "asc" | "desc";
type FilterLevel = "all" | "low" | "medium" | "high";

const sizeOptions = [128, 192, 256, 384, 512];
const errorLevelOptions: { value: ErrorLevel; label: string }[] = [
  { value: "L", label: "低 L (~7%)" },
  { value: "M", label: "中 M (~15%)" },
  { value: "Q", label: "较高 Q (~25%)" },
  { value: "H", label: "高 H (~30%)" },
];

const defaultTemplate: TemplateConfig = {
  size: 256,
  foreground: "#0F172A",
  background: "#FFFFFF",
  errorLevel: "M",
};

export default function BatchGenerator() {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://example.com/product?id=");
  const [paramName, setParamName] = useState("id");
  const [valuesText, setValuesText] = useState("P001\nP002\nP003\nP004\nP005");
  const [template, setTemplate] = useState<TemplateConfig>(defaultTemplate);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [task, setTask] = useState<BatchTask | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string>("");
  const pollTimerRef = useRef<number | null>(null);

  const [showTemplate, setShowTemplate] = useState(false);
  const [sortField, setSortField] = useState<SortField>("index");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filterLevel, setFilterLevel] = useState<FilterLevel>("all");
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const values = useMemo(() => {
    return valuesText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }, [valuesText]);

  const allUrlItems = useMemo(() => {
    return values.map((v, i) => {
      const sep = baseUrl.includes("?") ? "&" : "?";
      const url = baseUrl + (paramName ? `${sep}${encodeURIComponent(paramName)}=` : "") + encodeURIComponent(v);
      return { index: i, value: v, url };
    });
  }, [values, baseUrl, paramName]);

  const previewRows: PreviewRow[] = useMemo(() => {
    return allUrlItems.slice(0, 6).map((item) => ({
      id: `p-${item.index}`,
      value: item.value,
      url: item.url,
    }));
  }, [allUrlItems]);

  const batchScores: BatchItemScore[] = useMemo(() => {
    return evaluateBatchItems(
      allUrlItems.map((item) => ({ value: item.value, url: item.url })),
      {
        size: template.size,
        foreground: template.foreground,
        background: template.background,
        errorLevel: template.errorLevel,
        hasLogo: false,
      }
    );
  }, [allUrlItems, template]);

  const filteredAndSorted = useMemo(() => {
    let items = [...batchScores];
    if (filterLevel === "low") {
      items = items.filter((s) => s.quality.overall < 60);
    } else if (filterLevel === "medium") {
      items = items.filter((s) => s.quality.overall >= 60 && s.quality.overall < 80);
    } else if (filterLevel === "high") {
      items = items.filter((s) => s.quality.overall >= 80);
    }
    items.sort((a, b) => {
      let va: number, vb: number;
      switch (sortField) {
        case "score":
          va = a.quality.overall;
          vb = b.quality.overall;
          break;
        case "readability":
          va = a.quality.dimensions.find((d) => d.key === "readability")?.score ?? 0;
          vb = b.quality.dimensions.find((d) => d.key === "readability")?.score ?? 0;
          break;
        case "aesthetics":
          va = a.quality.dimensions.find((d) => d.key === "aesthetics")?.score ?? 0;
          vb = b.quality.dimensions.find((d) => d.key === "aesthetics")?.score ?? 0;
          break;
        case "compatibility":
          va = a.quality.dimensions.find((d) => d.key === "compatibility")?.score ?? 0;
          vb = b.quality.dimensions.find((d) => d.key === "compatibility")?.score ?? 0;
          break;
        default:
          va = a.index;
          vb = b.index;
      }
      return sortOrder === "asc" ? va - vb : vb - va;
    });
    return items;
  }, [batchScores, filterLevel, sortField, sortOrder]);

  const scoreSummary = useMemo(() => {
    if (batchScores.length === 0) return null;
    const avg = Math.round(batchScores.reduce((s, b) => s + b.quality.overall, 0) / batchScores.length);
    const lowCount = batchScores.filter((s) => s.quality.overall < 70).length;
    const highCount = batchScores.filter((s) => s.quality.overall >= 80).length;
    return { avg, lowCount, highCount, total: batchScores.length };
  }, [batchScores]);

  const updateTemplate = useCallback(<K extends keyof TemplateConfig>(key: K, value: TemplateConfig[K]) => {
    setTemplate((t) => ({ ...t, [key]: value }));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortOrder("desc");
      }
      return field;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!task || task.status === "done" || task.status === "failed") {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setPolling(false);
      return;
    }
    if (pollTimerRef.current) return;
    setPolling(true);
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const latest = await api.getBatchTask(task.id);
        setTask(latest);
        const pct = latest.totalCount > 0 ? Math.round((latest.successCount / latest.totalCount) * 100) : 0;
        setProgress(pct);
        if (latest.status === "done" || latest.status === "failed") {
          if (pollTimerRef.current) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setPolling(false);
          if (latest.status === "failed") {
            setError("批量任务执行失败");
          }
        }
      } catch {
        // 轮询失败不中断
      }
    }, 1500);
  }, [task]);

  const canGenerate =
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    baseUrl.startsWith("http") &&
    values.length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setProgress(0);
    setError("");
    setTask(null);

    try {
      const payload: BatchGenerateRequest = {
        name,
        baseUrl,
        paramName,
        paramValues: values,
        template: {
          size: template.size,
          foreground: template.foreground,
          background: template.background,
          errorLevel: template.errorLevel,
        },
      };
      const created = await api.createBatchTask(payload);
      setTask(created);
      setProgress(created.totalCount > 0 ? Math.round((created.successCount / created.totalCount) * 100) : 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "批量生成失败";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!task) return;
    if (task.status !== "done") {
      alert("任务尚未完成，请等待生成完毕后再下载");
      return;
    }
    try {
      const blob = await api.downloadBatchZip(task.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${task.name || "batch"}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("下载失败");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-dark-500" />;
    return sortOrder === "asc" ? (
      <ChevronUp className="w-3 h-3 text-brand-400" />
    ) : (
      <ChevronDown className="w-3 h-3 text-brand-400" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
            <Layers3 className="w-6 h-6 text-brand-400" />
            批量生成二维码
          </h1>
          <p className="text-dark-400 mt-1 text-sm">
            根据参数值批量生成动态二维码，生成后打包下载
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-5">
          <div className="card p-5 space-y-5">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-400" />
              任务配置
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label">
                  <Hash className="w-3.5 h-3.5 inline mr-1" />
                  任务名称 *
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="例如：产品码批量生成-2024春季"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="md:col-span-2">
                <label className="label">
                  <Link2 className="w-3.5 h-3.5 inline mr-1" />
                  基础URL *
                </label>
                <input
                  type="text"
                  className="input font-mono text-sm"
                  placeholder="https://example.com/product?id="
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>

              <div className="md:col-span-2">
                <label className="label">参数名（可选）</label>
                <input
                  type="text"
                  className="input"
                  placeholder="留空则直接拼接值，例如：id / sku / ref"
                  value={paramName}
                  onChange={(e) => setParamName(e.target.value)}
                />
                <p className="text-xs text-dark-500 mt-1">
                  最终URL = 基础URL + 参数名=参数值（参数名留空时直接拼接参数值）
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="label">
                  参数值（每行一个）*
                  <span className={`ml-2 ${values.length > 0 ? "text-brand-400" : "text-dark-500"}`}>
                    共 {values.length} 条
                  </span>
                </label>
                <textarea
                  className="input font-mono text-sm min-h-[220px] resize-y"
                  placeholder={"SKU001\nSKU002\nSKU003\n..."}
                  value={valuesText}
                  onChange={(e) => setValuesText(e.target.value)}
                  spellCheck={false}
                />
                <p className="text-xs text-dark-500 mt-1">
                  支持最大 1000 条；每行一个参数值，空行会被忽略
                </p>
              </div>
            </div>

            <div className="border-t border-dark-700 pt-4">
              <button
                type="button"
                onClick={() => setShowTemplate(!showTemplate)}
                className="flex items-center gap-2 text-sm text-dark-300 hover:text-white transition-colors"
              >
                <Palette className="w-4 h-4 text-brand-400" />
                样式模板配置
                {showTemplate ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span className="text-xs text-dark-500 ml-1">
                  当前：{template.size}px / {template.errorLevel}级容错
                </span>
              </button>

              {showTemplate && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-up">
                  <div>
                    <label className="label">
                      <Maximize2 className="w-3.5 h-3.5 inline mr-1" />
                      尺寸
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {sizeOptions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateTemplate("size", s)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                            template.size === s
                              ? "bg-brand-gradient text-white shadow-glow-sm"
                              : "bg-dark-700 text-dark-300 hover:bg-dark-600"
                          }`}
                        >
                          {s}px
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="label">容错级别</label>
                    <select
                      className="input"
                      value={template.errorLevel}
                      onChange={(e) => updateTemplate("errorLevel", e.target.value as ErrorLevel)}
                    >
                      {errorLevelOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">前景色</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        className="w-12 h-10 rounded-lg bg-dark-700 border border-dark-600 cursor-pointer p-1"
                        value={template.foreground}
                        onChange={(e) => updateTemplate("foreground", e.target.value)}
                      />
                      <input
                        type="text"
                        className="input flex-1 font-mono text-sm"
                        value={template.foreground}
                        onChange={(e) => updateTemplate("foreground", e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label">背景色</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        className="w-12 h-10 rounded-lg bg-dark-700 border border-dark-600 cursor-pointer p-1"
                        value={template.background}
                        onChange={(e) => updateTemplate("background", e.target.value)}
                      />
                      <input
                        type="text"
                        className="input flex-1 font-mono text-sm"
                        value={template.background}
                        onChange={(e) => updateTemplate("background", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {(progress > 0 || generating || error || task) && (
              <div className="pt-4 border-t border-dark-700">
                {error && (
                  <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-500 text-sm flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    {error}
                  </div>
                )}

                {task ? (
                  task.status === "done" ? (
                    <div className="p-4 rounded-xl bg-success-500/10 border border-success-500/30">
                      <div className="flex items-center gap-2 text-success-500 font-medium mb-3">
                        <CheckCircle2 className="w-5 h-5" />
                        生成成功！共完成 {task.successCount} / {task.totalCount} 个二维码
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                        <div>
                          <span className="text-dark-400">任务ID：</span>
                          <span className="text-white font-mono">{task.id.slice(0, 12)}...</span>
                        </div>
                        <div>
                          <span className="text-dark-400">成功数量：</span>
                          <span className="text-success-500 font-semibold">
                            {task.successCount} / {task.totalCount}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-dark-400">任务名称：</span>
                          <span className="text-white">{task.name}</span>
                        </div>
                      </div>
                      <button onClick={handleDownloadZip} className="btn-success w-full">
                        <Download className="w-4 h-4" />
                        下载 ZIP 压缩包（含全部二维码图片）
                      </button>
                    </div>
                  ) : task.status === "failed" ? (
                    <div className="p-4 rounded-xl bg-danger-500/10 border border-danger-500/30">
                      <div className="flex items-center gap-2 text-danger-500 font-medium mb-2">
                        <AlertCircle className="w-5 h-5" />
                        任务失败
                      </div>
                      <p className="text-sm text-dark-300 mb-3">
                        成功 {task.successCount} / {task.totalCount} 个，请检查参数后重试。
                      </p>
                      <button
                        onClick={() => {
                          setTask(null);
                          setProgress(0);
                        }}
                        className="btn-secondary w-full"
                      >
                        <RefreshCw className="w-4 h-4" />
                        重新生成
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-dark-300 flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                          {polling ? "后台正在生成二维码，请勿关闭页面..." : "准备中..."}
                        </span>
                        <span className="text-brand-400 font-semibold">
                          {task.successCount} / {task.totalCount} ({Math.round(progress)}%)
                        </span>
                      </div>
                      <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-gradient rounded-full transition-all duration-300 relative"
                          style={{ width: `${progress}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-pulse" />
                        </div>
                      </div>
                      <p className="text-xs text-dark-500">
                        任务 ID：<span className="font-mono">{task.id}</span> · 状态：
                        <span className="text-brand-300 ml-1">
                          {task.status === "running" ? "运行中" : task.status === "pending" ? "等待中" : task.status}
                        </span>
                      </p>
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-dark-300 flex items-center gap-2">
                        {generating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                            正在生成 {values.length} 个二维码...
                          </>
                        ) : (
                          progress > 0 ? "准备中..." : "等待开始"
                        )}
                      </span>
                      <span className="text-brand-400 font-semibold">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-gradient rounded-full transition-all duration-300 relative"
                        style={{ width: `${progress}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2 flex-wrap">
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || generating}
                className="btn-primary flex-1 min-w-[180px]"
              >
                {generating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {generating ? "生成中..." : `开始生成 (${values.length} 个)`}
              </button>
              <button
                onClick={() => {
                  setName("");
                  setValuesText("");
                  setProgress(0);
                  setTask(null);
                  setError("");
                  setTemplate(defaultTemplate);
                }}
                className="btn-secondary"
                disabled={generating}
              >
                <RefreshCw className="w-4 h-4" />
                清空
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <div className="card p-5">
            <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
              <Eye className="w-4 h-4 text-brand-400" />
              预览（前 {previewRows.length} 条）
            </h3>

            {previewRows.length === 0 ? (
              <div className="text-center py-12 text-dark-500 text-sm">
                请输入参数值以预览
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {previewRows.map((row, idx) => {
                  const score = batchScores[idx];
                  return (
                    <div
                      key={row.id}
                      className="p-3 rounded-xl bg-dark-900/40 border border-dark-700 flex items-center gap-3 animate-fade-up"
                      style={{ animationDelay: `${idx * 40}ms` }}
                    >
                      <div className="w-16 h-16 rounded-lg bg-white p-1.5 flex-shrink-0 border border-dark-600">
                        <QRCodeSVG value={row.url} size={48} level="M" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-dark-700 text-dark-300 font-mono">
                            #{idx + 1}
                          </span>
                          <span className="font-medium text-white truncate">{row.value}</span>
                          {score && (
                            <span className={`text-xs font-bold ml-auto ${getScoreColor(score.quality.overall)}`}>
                              {score.quality.overall}分
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-dark-400 truncate font-mono" title={row.url}>
                          {row.url}
                        </p>
                        {score && score.quality.lowScore && (
                          <div className="flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3 text-warning-500" />
                            <span className="text-xs text-warning-500">评分偏低</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {values.length > previewRows.length && (
                  <p className="text-center text-xs text-dark-500 pt-2 pb-1">
                    ... 还有 {values.length - previewRows.length} 条未显示
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="card p-5 bg-gradient-to-br from-brand-500/5 to-accent-500/5 border-brand-500/20">
            <h4 className="font-medium text-white mb-2 text-sm">💡 使用提示</h4>
            <ul className="text-xs text-dark-400 space-y-1.5 leading-relaxed">
              <li>• 动态码支持后续修改目标URL，旧二维码依然有效</li>
              <li>• 展开样式模板可配置尺寸、颜色和容错级别</li>
              <li>• ZIP 中包含 PNG 图片和索引 CSV 文件</li>
              <li>• 质量评分基于可读性、美观度、兼容性三维度评估</li>
            </ul>
          </div>
        </div>
      </div>

      {batchScores.length > 0 && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-brand-400" />
              质量评分报告
            </h3>
            {scoreSummary && (
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-dark-400">平均分</span>
                  <span className={`font-bold text-lg ${getScoreColor(scoreSummary.avg)}`}>
                    {scoreSummary.avg}
                  </span>
                </div>
                <div className="h-4 w-px bg-dark-700" />
                <div className="flex items-center gap-1.5">
                  <span className="text-dark-400">优质</span>
                  <span className="text-success-500 font-semibold">{scoreSummary.highCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-dark-400">待优化</span>
                  <span className="text-warning-500 font-semibold">{scoreSummary.lowCount}</span>
                </div>
              </div>
            )}
          </div>

          {scoreSummary && scoreSummary.lowCount > 0 && (
            <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/30 text-warning-500 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                共 <strong>{scoreSummary.lowCount}</strong> 个二维码评分低于 70 分，建议根据下方优化建议调整参数
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-dark-400" />
              <span className="text-sm text-dark-400">筛选：</span>
              {([
                { value: "all", label: "全部" },
                { value: "high", label: "优质 (≥80)" },
                { value: "medium", label: "中等 (60-79)" },
                { value: "low", label: "低分 (<60)" },
              ] as { value: FilterLevel; label: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilterLevel(opt.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    filterLevel === opt.value
                      ? "bg-brand-gradient text-white"
                      : "bg-dark-700 text-dark-300 hover:bg-dark-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-dark-600 text-xs">|</span>
            <span className="text-xs text-dark-500">
              显示 {filteredAndSorted.length} / {batchScores.length} 条
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium w-12">
                    <button onClick={() => handleSort("index")} className="flex items-center gap-1 hover:text-white transition-colors">
                      # <SortIcon field="index" />
                    </button>
                  </th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium">参数值</th>
                  <th className="text-left py-2.5 px-3 text-dark-400 font-medium hidden md:table-cell">URL</th>
                  <th className="text-center py-2.5 px-3 text-dark-400 font-medium w-20">
                    <button onClick={() => handleSort("score")} className="flex items-center gap-1 mx-auto hover:text-white transition-colors">
                      综合评分 <SortIcon field="score" />
                    </button>
                  </th>
                  <th className="text-center py-2.5 px-3 text-dark-400 font-medium w-16">
                    <button onClick={() => handleSort("readability")} className="flex items-center gap-1 mx-auto hover:text-white transition-colors" title="可读性">
                      <ShieldCheck className="w-3.5 h-3.5" /> <SortIcon field="readability" />
                    </button>
                  </th>
                  <th className="text-center py-2.5 px-3 text-dark-400 font-medium w-16">
                    <button onClick={() => handleSort("aesthetics")} className="flex items-center gap-1 mx-auto hover:text-white transition-colors" title="美观度">
                      <Sparkles className="w-3.5 h-3.5" /> <SortIcon field="aesthetics" />
                    </button>
                  </th>
                  <th className="text-center py-2.5 px-3 text-dark-400 font-medium w-16">
                    <button onClick={() => handleSort("compatibility")} className="flex items-center gap-1 mx-auto hover:text-white transition-colors" title="兼容性">
                      <MonitorSmartphone className="w-3.5 h-3.5" /> <SortIcon field="compatibility" />
                    </button>
                  </th>
                  <th className="text-center py-2.5 px-3 text-dark-400 font-medium w-14">等级</th>
                  <th className="text-center py-2.5 px-3 text-dark-400 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((item) => {
                  const readability = item.quality.dimensions.find((d) => d.key === "readability")!;
                  const aesthetics = item.quality.dimensions.find((d) => d.key === "aesthetics")!;
                  const compatibility = item.quality.dimensions.find((d) => d.key === "compatibility")!;
                  const isExpanded = expandedItem === item.index;
                  const allSuggestions = item.quality.suggestions;

                  return (
                    <tbody key={item.index}>
                      <tr
                        className={`border-b border-dark-800 hover:bg-dark-800/50 transition-colors cursor-pointer ${
                          item.quality.lowScore ? "bg-warning-500/5" : ""
                        }`}
                        onClick={() => setExpandedItem(isExpanded ? null : item.index)}
                      >
                        <td className="py-2.5 px-3">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-dark-700 text-dark-300 font-mono">
                            {item.index + 1}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium truncate max-w-[120px]">{item.value}</span>
                            {item.quality.lowScore && (
                              <AlertTriangle className="w-3.5 h-3.5 text-warning-500 flex-shrink-0" />
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 hidden md:table-cell">
                          <p className="text-xs text-dark-400 truncate max-w-[200px] font-mono" title={item.url}>
                            {item.url}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center">
                            <div className={`inline-flex items-center justify-center w-12 h-7 rounded-md text-xs font-bold ${getScoreBgColor(item.quality.overall)} border`}>
                              {item.quality.overall}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-xs font-semibold ${getScoreColor(readability.score)}`}>
                            {readability.score}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-xs font-semibold ${getScoreColor(aesthetics.score)}`}>
                            {aesthetics.score}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-xs font-semibold ${getScoreColor(compatibility.score)}`}>
                            {compatibility.score}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${getGradeBgColor(item.quality.grade)}`}>
                            {item.quality.grade}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-dark-400 mx-auto" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-dark-400 mx-auto" />
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-dark-800">
                          <td colSpan={9} className="py-3 px-4 bg-dark-900/30">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                              {item.quality.dimensions.map((dim) => (
                                <div key={dim.key} className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-dark-300">{dim.label}</span>
                                    <span className={`text-xs font-bold ${getScoreColor(dim.score)}`}>
                                      {dim.score}/{dim.maxScore}
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${
                                        dim.score >= 80
                                          ? "bg-success-500"
                                          : dim.score >= 60
                                          ? "bg-warning-500"
                                          : "bg-danger-500"
                                      }`}
                                      style={{ width: `${dim.score}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {allSuggestions.length > 0 && (
                              <div className="pt-2 border-t border-dark-700">
                                <p className="text-xs text-dark-400 mb-1.5 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-brand-400" />
                                  优化建议
                                </p>
                                <ul className="space-y-1">
                                  {allSuggestions.map((suggestion, si) => (
                                    <li key={si} className="text-xs text-dark-300 flex items-start gap-1.5">
                                      <span className="text-brand-400 mt-0.5">•</span>
                                      {suggestion}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {allSuggestions.length === 0 && (
                              <p className="text-xs text-success-500 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                此二维码各项指标优良，无需优化
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredAndSorted.length === 0 && (
            <div className="text-center py-8 text-dark-500 text-sm">
              当前筛选条件下没有匹配的二维码
            </div>
          )}
        </div>
      )}
    </div>
  );
}
