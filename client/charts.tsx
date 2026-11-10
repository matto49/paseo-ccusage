import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import type { Summary } from "../shared/usage";
import { formatCost, formatTokens } from "./format";
import { HEAT_LEGEND, heatmap, type Bucket, type HeatCell, type Totals } from "./model";
import { heatColors } from "./palette";

const CELL = 11;
const MAX_CELL = 18;
const CELL_GAP = 3;
const DAY_LABEL_WIDTH = 28;
const DAY_LABELS = ["", "一", "", "三", "", "五", ""];

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

export function Heatmap({ summary, theme }: { summary: Summary; theme: PluginTheme }) {
  const c = theme.colors;
  const [width, onLayout] = useWidth();
  const available = width - DAY_LABEL_WIDTH;
  const weeks = Math.max(8, Math.min(53, Math.floor(available / (CELL + CELL_GAP))));
  // Grow the cells to fill the card once a full year fits, up to a comfortable maximum.
  const cellSize = Math.max(CELL, Math.min(MAX_CELL, Math.floor(available / weeks) - CELL_GAP));
  const pitch = cellSize + CELL_GAP;
  const data = useMemo(() => heatmap(summary, weeks), [summary, weeks]);
  const colors = useMemo(() => heatColors(theme), [theme]);
  const [hovered, setHovered] = useState<HeatCell | null>(null);

  // Label the first column of each month, dropping one that would collide with the next label.
  const starts = data.columns.map((col, i) => {
    const month = Number(col[0].date.slice(5, 7));
    const prev = i > 0 ? Number(data.columns[i - 1][0].date.slice(5, 7)) : null;
    return prev === null || prev !== month ? month : null;
  });
  const months = starts.map((month, i) => {
    if (month === null) return "";
    const next = starts.findIndex((m, j) => j > i && m !== null);
    return next !== -1 && next - i < 3 ? "" : `${month}月`;
  });
  const muted = { fontSize: 11, color: c.foregroundMuted };

  return (
    <View onLayout={onLayout} style={{ gap: 10 }}>
      {width > 0 && (
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: DAY_LABEL_WIDTH, paddingTop: 18, gap: CELL_GAP }}>
            {DAY_LABELS.map((d, i) => (
              <Text key={i} style={[muted, { height: cellSize, lineHeight: cellSize }]}>
                {d}
              </Text>
            ))}
          </View>
          <View style={{ gap: 4 }}>
            <View style={{ height: 14, width: weeks * pitch }}>
              {months.map((m, i) =>
                m ? (
                  <Text key={i} numberOfLines={1} style={[muted, { position: "absolute", left: i * pitch, top: 0 }]}>
                    {m}
                  </Text>
                ) : null,
              )}
            </View>
            <View style={{ flexDirection: "row", gap: CELL_GAP }}>
              {data.columns.map((col, w) => (
                <View key={w} style={{ gap: CELL_GAP }}>
                  {col.map((cell) => (
                    <Pressable
                      key={cell.date}
                      accessibilityLabel={`${cell.date} ${formatTokens(cell.tokens)} tokens`}
                      disabled={cell.future}
                      onHoverIn={() => setHovered(cell)}
                      onHoverOut={() => setHovered((h) => (h?.date === cell.date ? null : h))}
                      onPress={() => setHovered(cell)}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRadius: 3,
                        backgroundColor: cell.future ? "transparent" : colors[cell.level],
                        borderWidth: hovered?.date === cell.date ? 1 : 0,
                        borderColor: c.foreground,
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Text style={{ fontSize: 12, color: hovered ? c.foreground : c.foregroundMuted, fontVariant: ["tabular-nums"] }}>
          {hovered
            ? `${hovered.date} · ${formatTokens(hovered.tokens)} tokens · ${formatCost(hovered.cost)}`
            : `${data.activeCount} 天活跃 · ${formatTokens(data.tokenSum)} tokens`}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {HEAT_LEGEND.map((label, i) => (
            <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colors[i] }} />
              <Text style={muted}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export type Metric = "cost" | "tokens";

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

function formatMetric(metric: Metric, value: number): string {
  return metric === "cost" ? formatCost(value) : formatTokens(value);
}

/** Axis ticks: whole dollars, k above a thousand. */
function formatTick(metric: Metric, value: number): string {
  if (metric === "tokens") return value === 0 ? "0" : formatTokens(value);
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(value)}`;
}

function metricOf(t: Totals | undefined, metric: Metric): number {
  return t ? (metric === "cost" ? t.cost : t.tokens) : 0;
}

const PLOT_HEIGHT = 168;
const Y_AXIS_WIDTH = 52;
const TICKS = 4;

export function TrendChart({
  buckets,
  machines,
  colors,
  metric,
  weekly,
  theme,
}: {
  buckets: Bucket[];
  machines: string[];
  colors: string[];
  metric: Metric;
  weekly: boolean;
  theme: PluginTheme;
}) {
  const c = theme.colors;
  const [width, onLayout] = useWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const max = Math.max(0, ...buckets.map((b) => metricOf(b.total, metric)));
  const step = niceStep(max / TICKS);
  const top = step * TICKS;
  const plotWidth = Math.max(0, width - Y_AXIS_WIDTH);
  const slot = buckets.length > 0 ? plotWidth / buckets.length : 0;
  const barWidth = Math.max(4, Math.min(36, slot * 0.62));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotWidth / 48))));

  const focusIndex = hoverIndex ?? buckets.length - 1;
  const focus = buckets[focusIndex];
  const muted = { fontSize: 11, color: c.foregroundMuted, fontVariant: ["tabular-nums" as const] };

  return (
    <View style={{ gap: 12 }}>
      {focus && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap", minHeight: 18 }}>
          <Text style={{ fontSize: 12, color: c.foreground, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {weekly ? `${focus.label} 起一周` : focus.start}
          </Text>
          {machines.map((name, i) => (
            <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors[i] }} />
              <Text style={{ fontSize: 12, color: c.foregroundMuted }}>{name}</Text>
              <Text style={{ fontSize: 12, color: c.foreground, fontVariant: ["tabular-nums"] }}>
                {formatMetric(metric, metricOf(focus.machines.get(name), metric))}
              </Text>
            </View>
          ))}
          {machines.length > 1 && (
            <Text style={{ fontSize: 12, color: c.foregroundMuted }}>
              合计{" "}
              <Text style={{ color: c.foreground, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
                {formatMetric(metric, metricOf(focus.total, metric))}
              </Text>
            </Text>
          )}
        </View>
      )}

      <View onLayout={onLayout}>
        {width > 0 && (
          <>
            <View style={{ height: PLOT_HEIGHT, flexDirection: "row" }}>
              <View style={{ width: Y_AXIS_WIDTH, height: PLOT_HEIGHT }}>
                {Array.from({ length: TICKS + 1 }, (_, i) => (
                  <Text
                    key={i}
                    style={[muted, { position: "absolute", right: 8, top: PLOT_HEIGHT - (i / TICKS) * PLOT_HEIGHT - 7 }]}
                  >
                    {formatTick(metric, step * i)}
                  </Text>
                ))}
              </View>
              <View style={{ flex: 1, height: PLOT_HEIGHT }}>
                {Array.from({ length: TICKS + 1 }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: PLOT_HEIGHT - (i / TICKS) * PLOT_HEIGHT,
                      height: 1,
                      backgroundColor: c.border,
                      opacity: i === 0 ? 1 : 0.5,
                    }}
                  />
                ))}
                <View style={{ flex: 1, flexDirection: "row" }}>
                  {buckets.map((b, index) => {
                    const dimmed = hoverIndex !== null && hoverIndex !== index;
                    const segments = machines
                      .map((name, i) => ({ name, color: colors[i], value: metricOf(b.machines.get(name), metric) }))
                      .filter((s) => s.value > 0);
                    return (
                      <Pressable
                        key={b.start}
                        accessibilityLabel={`${b.start} ${formatMetric(metric, metricOf(b.total, metric))}`}
                        onHoverIn={() => setHoverIndex(index)}
                        onHoverOut={() => setHoverIndex((h) => (h === index ? null : h))}
                        onPress={() => setHoverIndex(index)}
                        style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}
                      >
                        {/* Stack bottom-up in machine order: the first machine sits on the baseline. */}
                        <View style={{ width: barWidth, flexDirection: "column-reverse", opacity: dimmed ? 0.45 : 1 }}>
                          {segments.map((s, i) => {
                            const isTop = i === segments.length - 1;
                            return (
                              <View
                                key={s.name}
                                style={{
                                  height: top > 0 ? Math.max(1, (s.value / top) * PLOT_HEIGHT - (i > 0 ? 2 : 0)) : 0,
                                  marginTop: i > 0 ? 2 : 0,
                                  backgroundColor: s.color,
                                  borderTopLeftRadius: isTop ? 4 : 0,
                                  borderTopRightRadius: isTop ? 4 : 0,
                                }}
                              />
                            );
                          })}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
            <View style={{ marginLeft: Y_AXIS_WIDTH, marginTop: 6, height: 14 }}>
              {buckets.map((b, i) => {
                const last = i === buckets.length - 1;
                // Skip a regular label that would crowd the always-shown last one.
                const show = last || (i % labelEvery === 0 && buckets.length - 1 - i >= labelEvery);
                return show ? (
                  <Text
                    key={b.start}
                    numberOfLines={1}
                    style={[muted, { position: "absolute", width: 48, left: (i + 0.5) * slot - 24, textAlign: "center" }]}
                  >
                    {b.label}
                  </Text>
                ) : null;
              })}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/** A thin share bar: the filled part is `ratio` of the track. */
export function ShareBar({ ratio, color, theme }: { ratio: number; color: string; theme: PluginTheme }) {
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}
