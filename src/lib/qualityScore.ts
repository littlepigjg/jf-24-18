import type { QualityScore, QualityDimensionScore, BatchItemScore, ErrorLevel } from "@shared/types";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return null;
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(fg: string, bg: string): number {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return 1;
  const l1 = relativeLuminance(fgRgb.r, fgRgb.g, fgRgb.b);
  const l2 = relativeLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getUrlComplexity(url: string): { modules: number; level: string } {
  const len = url.length;
  if (len <= 30) return { modules: 21, level: "low" };
  if (len <= 60) return { modules: 25, level: "low" };
  if (len <= 100) return { modules: 29, level: "medium" };
  if (len <= 150) return { modules: 33, level: "medium" };
  if (len <= 200) return { modules: 37, level: "high" };
  return { modules: 41 + Math.floor((len - 200) / 50) * 4, level: "high" };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

interface ScoringParams {
  url: string;
  size: number;
  foreground: string;
  background: string;
  errorLevel: ErrorLevel;
  hasLogo: boolean;
}

function scoreReadability(params: ScoringParams): QualityDimensionScore {
  const suggestions: string[] = [];
  let score = 100;
  const { url, size, errorLevel } = params;
  const complexity = getUrlComplexity(url);

  if (complexity.level === "high") {
    score -= 20;
    if (errorLevel === "L") {
      score -= 10;
      suggestions.push("URL 过长，容错级别 L 无法保证可靠扫描，建议提升至 M 或 Q");
    } else if (errorLevel === "M") {
      score -= 5;
      suggestions.push("URL 较长，建议提升容错级别至 Q 以增强可读性");
    }
  } else if (complexity.level === "medium") {
    if (errorLevel === "L") {
      score -= 8;
      suggestions.push("URL 中等长度，容错级别 L 可能影响扫描成功率，建议提升至 M");
    }
  }

  if (size < 128) {
    score -= 25;
    suggestions.push("尺寸过小（< 128px），扫描器难以识别，建议至少 256px");
  } else if (size < 192) {
    score -= 15;
    suggestions.push("尺寸偏小，建议增大至 256px 或以上以提高可读性");
  } else if (size < 256) {
    score -= 5;
    suggestions.push("建议使用 256px 或以上尺寸确保最佳扫描体验");
  }

  if (complexity.level !== "low" && size < 256) {
    score -= 10;
    suggestions.push("URL 较长但尺寸偏小，二维码模块密度过高，建议增大尺寸至 384px");
  }

  return { key: "readability", label: "可读性", score: clampScore(score), maxScore: 100, suggestions };
}

function scoreAesthetics(params: ScoringParams): QualityDimensionScore {
  const suggestions: string[] = [];
  let score = 100;
  const { foreground, background, hasLogo, errorLevel } = params;
  const ratio = contrastRatio(foreground, background);

  if (ratio < 3) {
    score -= 35;
    suggestions.push("前景色与背景色对比度极低（< 3:1），二维码几乎无法识别，请调整颜色");
  } else if (ratio < 4.5) {
    score -= 20;
    suggestions.push("颜色对比度偏低（< 4.5:1），建议使用更高对比度的前景/背景色组合");
  } else if (ratio < 7) {
    score -= 5;
  }

  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);
  if (fgRgb && bgRgb) {
    const fgBrightness = (fgRgb.r + fgRgb.g + fgRgb.b) / 3;
    const bgBrightness = (bgRgb.r + bgRgb.g + bgRgb.b) / 3;
    if (fgBrightness > 180 && bgBrightness > 180) {
      score -= 15;
      suggestions.push("前景色过浅，深色前景+浅色背景的搭配更美观且易扫描");
    }
    if (bgBrightness < 80) {
      score -= 10;
      suggestions.push("深色背景可能影响部分扫描器识别，建议使用浅色背景");
    }
  }

  if (hasLogo) {
    if (errorLevel === "L") {
      score -= 15;
      suggestions.push("添加了 Logo 但容错级别为 L，Logo 可能破坏数据区域，建议提升至 Q 或 H");
    } else if (errorLevel === "M") {
      score -= 5;
      suggestions.push("添加了 Logo 建议使用 Q 或 H 级容错以确保美观与功能兼顾");
    }
  }

  return { key: "aesthetics", label: "美观度", score: clampScore(score), maxScore: 100, suggestions };
}

function scoreCompatibility(params: ScoringParams): QualityDimensionScore {
  const suggestions: string[] = [];
  let score = 100;
  const { url, size, errorLevel, hasLogo } = params;
  const complexity = getUrlComplexity(url);

  if (size < 192) {
    score -= 20;
    suggestions.push("小尺寸二维码在低分辨率摄像头设备上兼容性差，建议 256px 以上");
  }

  if (complexity.level === "high" && size < 384) {
    score -= 15;
    suggestions.push("高密度二维码需要更大尺寸以保证各类设备兼容，建议 384px 或 512px");
  }

  if (errorLevel === "L") {
    score -= 10;
    suggestions.push("L 级容错在印刷/显示瑕疵场景下容错率不足，建议 M 级以上");
  }

  if (hasLogo && errorLevel !== "H" && errorLevel !== "Q") {
    score -= 10;
    suggestions.push("带 Logo 的二维码建议使用 Q 或 H 级容错，确保各类扫描器兼容");
  }

  const urlLen = url.length;
  if (urlLen > 300) {
    score -= 15;
    suggestions.push("URL 超过 300 字符，部分旧型扫码器可能无法解析，建议缩短 URL");
  } else if (urlLen > 200) {
    score -= 5;
    suggestions.push("URL 较长，部分低端扫码器可能识别缓慢");
  }

  return { key: "compatibility", label: "兼容性", score: clampScore(score), maxScore: 100, suggestions };
}

export function evaluateQuality(params: ScoringParams): QualityScore {
  const readability = scoreReadability(params);
  const aesthetics = scoreAesthetics(params);
  const compatibility = scoreCompatibility(params);

  const overall = clampScore(
    readability.score * 0.4 + aesthetics.score * 0.3 + compatibility.score * 0.3
  );

  const allSuggestions = [
    ...readability.suggestions,
    ...aesthetics.suggestions,
    ...compatibility.suggestions,
  ];

  return {
    overall,
    dimensions: [readability, aesthetics, compatibility],
    grade: getGrade(overall),
    lowScore: overall < 70,
    suggestions: allSuggestions,
  };
}

export function evaluateBatchItems(
  items: { value: string; url: string }[],
  template: {
    size: number;
    foreground: string;
    background: string;
    errorLevel: ErrorLevel;
    hasLogo: boolean;
  }
): BatchItemScore[] {
  return items.map((item, index) => ({
    index,
    value: item.value,
    url: item.url,
    quality: evaluateQuality({
      url: item.url,
      size: template.size,
      foreground: template.foreground,
      background: template.background,
      errorLevel: template.errorLevel,
      hasLogo: template.hasLogo,
    }),
  }));
}

export function getScoreColor(score: number): string {
  if (score >= 90) return "text-success-500";
  if (score >= 80) return "text-brand-400";
  if (score >= 70) return "text-warning-500";
  if (score >= 60) return "text-orange-400";
  return "text-danger-500";
}

export function getScoreBgColor(score: number): string {
  if (score >= 90) return "bg-success-500/10 border-success-500/30";
  if (score >= 80) return "bg-brand-500/10 border-brand-500/30";
  if (score >= 70) return "bg-warning-500/10 border-warning-500/30";
  if (score >= 60) return "bg-orange-400/10 border-orange-400/30";
  return "bg-danger-500/10 border-danger-500/30";
}

export function getGradeBgColor(grade: string): string {
  switch (grade) {
    case "A": return "bg-success-500/20 text-success-500";
    case "B": return "bg-brand-500/20 text-brand-400";
    case "C": return "bg-warning-500/20 text-warning-500";
    case "D": return "bg-orange-400/20 text-orange-400";
    case "F": return "bg-danger-500/20 text-danger-500";
    default: return "bg-dark-700 text-dark-300";
  }
}
