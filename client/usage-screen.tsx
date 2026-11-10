import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { summaryRpc, syncRpc } from "../shared/usage";
import { Heatmap, ShareBar, TrendChart, type Metric } from "./charts";
import { formatAge, formatCost, formatDelta, formatPercent, formatTokens, minutesSince } from "./format";
import { aggregate, emptyTotals, RANGES, type Kpi, type Range } from "./model";
import { machineColor, withAlpha } from "./palette";

const STALE_MINUTES = 120;
const QUERY_KEY = ["ccusage-hub", "summary"];
const WIDE = 1000;
const MODELS_COLLAPSED = 6;
const DAYS_COLLAPSED = 10;

function makeStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  return {
    root: { flex: 1, backgroundColor: c.surface0 },
    content: {
      padding: compact ? 16 : 28,
      gap: 16,
      maxWidth: 1200,
      width: "100%" as const,
      alignSelf: "center" as const,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 12,
      flexWrap: "wrap" as const,
      marginBottom: 4,
    },
    title: { fontSize: 20, fontWeight: "700" as const, color: c.foreground },
    subtitle: { fontSize: 12, color: c.foregroundMuted, marginTop: 4 },
    headerActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flexWrap: "wrap" as const },
    segment: {
      flexDirection: "row" as const,
      backgroundColor: c.surface1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: 2,
    },
    segmentItem: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
    segmentItemActive: { backgroundColor: c.surface2 },
    segmentText: { fontSize: 12, color: c.foregroundMuted },
    segmentTextActive: { color: c.foreground, fontWeight: "600" as const },
    statusText: { fontSize: 12, color: c.foregroundMuted },
    button: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface1,
    },
    buttonText: { fontSize: 12, color: c.foreground },
    notice: {
      flexDirection: "row" as const,
      gap: 10,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
    },
    noticeText: { fontSize: 13, lineHeight: 19, color: c.foreground },
    grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12 },
    kpi: {
      backgroundColor: c.surface1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 16,
      gap: 8,
      minHeight: 112,
    },
    kpiLabel: { fontSize: 11, color: c.foregroundMuted, letterSpacing: 0.4 },
    kpiValue: { fontSize: 24, fontWeight: "700" as const, color: c.foreground, fontVariant: ["tabular-nums" as const] },
    pill: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      alignSelf: "flex-start" as const,
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    pillText: { fontSize: 11, fontWeight: "600" as const, fontVariant: ["tabular-nums" as const] },
    card: {
      backgroundColor: c.surface1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: compact ? 14 : 20,
      gap: 16,
    },
    cardHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 12,
      flexWrap: "wrap" as const,
    },
    cardTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    cardTitle: { fontSize: 14, fontWeight: "600" as const, color: c.foreground },
    cardNote: { fontSize: 12, color: c.foregroundMuted },
    columns: { flexDirection: "row" as const, gap: 16, alignItems: "flex-start" as const },
    item: { gap: 8, paddingVertical: 4 },
    itemTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    itemName: { flexShrink: 1, fontSize: 13, color: c.foreground, fontWeight: "500" as const },
    itemValue: { fontSize: 13, color: c.foreground, fontWeight: "600" as const, fontVariant: ["tabular-nums" as const] },
    itemMeta: { flexDirection: "row" as const, gap: 14, flexWrap: "wrap" as const },
    meta: { fontSize: 11, color: c.foregroundMuted, fontVariant: ["tabular-nums" as const] },
    metaValue: { color: c.foreground },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 5,
      backgroundColor: c.surface2,
    },
    badgeText: { fontSize: 10, color: c.foregroundMuted },
    dot: { width: 8, height: 8, borderRadius: 2 },
    divider: { height: 1, backgroundColor: c.border },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 12,
    },
    cellName: { flex: 1.4, fontSize: 12, color: c.foreground, fontVariant: ["tabular-nums" as const] },
    cell: { flex: 1, fontSize: 12, color: c.foreground, textAlign: "right" as const, fontVariant: ["tabular-nums" as const] },
    head: { fontSize: 11, color: c.foregroundMuted },
    muted: { color: c.foregroundMuted },
    bold: { fontWeight: "600" as const },
    warn: { color: c.statusWarning },
    danger: { color: c.statusDanger },
    more: { alignItems: "center" as const, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border },
    moreText: { fontSize: 12, color: c.foregroundMuted },
    empty: { fontSize: 13, color: c.foregroundMuted, paddingVertical: 8 },
  };
}
type Styles = ReturnType<typeof makeStyles>;

function Segment<T extends string>({
  styles,
  options,
  value,
  onChange,
}: {
  styles: Styles;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(o.id)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Card({
  styles,
  theme,
  icon,
  title,
  note,
  right,
  children,
  style,
}: {
  styles: Styles;
  theme: PluginTheme;
  icon: string;
  title: string;
  note?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
          <Text style={styles.cardTitle}>{title}</Text>
          {note && <Text style={styles.cardNote}>{note}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

function formatKpi(kpi: Kpi): string {
  if (kpi.value === null) return "–";
  switch (kpi.format) {
    case "cost":
      return formatCost(kpi.value);
    case "tokens":
      return formatTokens(kpi.value);
    case "percent":
      return formatPercent(kpi.value);
    case "count":
      return String(kpi.value);
  }
}

function KpiTile({ kpi, styles, theme, width }: { kpi: Kpi; styles: Styles; theme: PluginTheme; width: number }) {
  const delta = formatDelta(kpi.value, kpi.previous, kpi.format === "percent");
  const c = theme.colors;
  const tone = delta?.direction === "up" ? c.statusSuccess : delta?.direction === "down" ? c.statusDanger : c.foregroundMuted;
  return (
    <View style={[styles.kpi, { width }]}>
      <Text style={styles.kpiLabel} numberOfLines={1}>
        {kpi.label}
      </Text>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>
        {formatKpi(kpi)}
      </Text>
      {delta ? (
        <View style={[styles.pill, { backgroundColor: withAlpha(tone, 0.14) }]}>
          <Icon
            name={delta.direction === "up" ? "TrendingUp" : delta.direction === "down" ? "TrendingDown" : "Minus"}
            size={11}
            color={tone}
          />
          <Text style={[styles.pillText, { color: tone }]}>{delta.text}</Text>
        </View>
      ) : (
        <Text style={styles.meta}>无对比</Text>
      )}
    </View>
  );
}

export function UsageScreen({ theme, layout }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const [range, setRange] = useState<Range>("7d");
  const [metric, setMetric] = useState<Metric>("cost");
  const [showAllModels, setShowAllModels] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);
  const [width, setWidth] = useState(0);
  const getSummary = useRpc(summaryRpc);
  const startSync = useRpc(syncRpc);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getSummary({}),
    refetchInterval: (q) => (q.state.data?.syncing ? 3_000 : 60_000),
  });
  const sync = useMutation({
    mutationFn: () => startSync({}),
    onSuccess: (data) => queryClient.setQueryData(QUERY_KEY, data),
  });

  const summary = query.data;
  const view = useMemo(() => (summary ? aggregate(summary, range) : null), [summary, range]);

  if (!summary || !view) {
    return (
      <View style={[styles.root, { padding: 24 }]}>
        {query.error ? (
          <Text style={[styles.noticeText, styles.danger]}>读取用量失败：{String((query.error as Error).message)}</Text>
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  const c = theme.colors;
  const now = Date.now();
  const syncing = summary.syncing || sync.isPending;
  const hasData = summary.rows.length > 0;
  const machineNames = summary.machines.map((m) => m.machine);
  const colors = machineNames.map((_, i) => machineColor(theme, i));
  const wide = width >= WIDE;
  const kpiColumns = width >= WIDE ? 6 : width >= 620 ? 3 : 2;
  const kpiWidth = width > 0 ? Math.floor((width - 12 * (kpiColumns - 1)) / kpiColumns) : 0;
  const errors = [
    summary.localError && `本机统计失败：${summary.localError}`,
    summary.hubError,
    sync.error && `同步请求失败：${(sync.error as Error).message}`,
  ].filter((e): e is string => Boolean(e));
  const models = showAllModels ? view.models : view.models.slice(0, MODELS_COLLAPSED);
  const days = showAllDays ? view.days : view.days.slice(0, DAYS_COLLAPSED);

  const machinesCard = (
    <Card styles={styles} theme={theme} icon="Monitor" title="按机器" note={`${summary.machines.length} 台`}>
      {summary.machines.map((m, i) => {
        const t = view.byMachine.get(m.machine) ?? emptyTotals();
        const age = minutesSince(m.generatedAt, now);
        const stale = age === null || age > STALE_MINUTES;
        const share = view.total.cost > 0 ? t.cost / view.total.cost : 0;
        return (
          <View key={m.machine} style={styles.item}>
            <View style={styles.itemTop}>
              <View style={[styles.dot, { backgroundColor: colors[i] }]} />
              <Text style={styles.itemName} numberOfLines={1}>
                {m.machine}
              </Text>
              {m.isSelf && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>本机</Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <Text style={styles.itemValue}>{formatCost(t.cost)}</Text>
            </View>
            <ShareBar ratio={share} color={colors[i]} theme={theme} />
            <View style={styles.itemMeta}>
              <Text style={styles.meta}>
                Token <Text style={styles.metaValue}>{formatTokens(t.tokens)}</Text>
              </Text>
              <Text style={styles.meta}>
                占比 <Text style={styles.metaValue}>{formatPercent(share)}</Text>
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {stale && <Icon name="TriangleAlert" size={11} color={c.statusWarning} />}
                <Text style={[styles.meta, stale && styles.warn]}>更新于 {formatAge(age)}</Text>
              </View>
            </View>
          </View>
        );
      })}
      <View style={styles.divider} />
      <View style={styles.itemTop}>
        <Text style={[styles.itemName, styles.bold, { flex: 1 }]}>合计</Text>
        <Text style={styles.meta}>{formatTokens(view.total.tokens)} tokens</Text>
        <Text style={styles.itemValue}>{formatCost(view.total.cost)}</Text>
      </View>
    </Card>
  );

  const modelsCard = (
    <Card styles={styles} theme={theme} icon="Layers" title="按工具和模型" note={`${view.models.length} 个模型`}>
      {view.models.length === 0 ? (
        <Text style={styles.empty}>这个时间段没有用量。</Text>
      ) : (
        <>
          {models.map((m) => {
            const share = view.total.cost > 0 ? m.cost / view.total.cost : 0;
            return (
              <View key={`${m.agent}/${m.model}`} style={styles.item}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {m.model}
                  </Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{m.agent}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.itemValue}>{formatCost(m.cost)}</Text>
                </View>
                <ShareBar ratio={share} color={c.foregroundMuted} theme={theme} />
                <View style={styles.itemMeta}>
                  <Text style={styles.meta}>
                    Token <Text style={styles.metaValue}>{formatTokens(m.tokens)}</Text>
                  </Text>
                  <Text style={styles.meta}>
                    占比 <Text style={styles.metaValue}>{formatPercent(share)}</Text>
                  </Text>
                </View>
              </View>
            );
          })}
          {view.models.length > MODELS_COLLAPSED && (
            <Pressable accessibilityRole="button" style={styles.more} onPress={() => setShowAllModels((v) => !v)}>
              <Text style={styles.moreText}>
                {showAllModels ? "收起" : `另有 ${view.models.length - MODELS_COLLAPSED} 个模型，展开`}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </Card>
  );

  const trendCard = (
    <Card
      styles={styles}
      theme={theme}
      icon="ChartColumn"
      title="用量趋势"
      note={view.weekly ? "按周" : range === "today" ? "最近 7 天" : "按天"}
      right={
        <Segment
          styles={styles}
          options={[
            { id: "cost" as const, label: "费用" },
            { id: "tokens" as const, label: "Token" },
          ]}
          value={metric}
          onChange={setMetric}
        />
      }
    >
      <TrendChart
        buckets={view.buckets}
        machines={machineNames}
        colors={colors}
        metric={metric}
        weekly={view.weekly}
        theme={theme}
      />
    </Card>
  );

  const showDayTokens = !layout.compact;
  const daysCard = (
    <Card styles={styles} theme={theme} icon="CalendarDays" title="每日明细">
      {view.days.length === 0 ? (
        <Text style={styles.empty}>{hasData ? "这个时间段没有用量。" : "还没有数据，第一次统计完成后会显示在这里。"}</Text>
      ) : (
        <View>
          <View style={[styles.row, { paddingVertical: 6 }]}>
            <Text style={[styles.cellName, styles.head]}>日期</Text>
            {machineNames.map((name) => (
              <Text key={name} style={[styles.cell, styles.head]} numberOfLines={1}>
                {name}
              </Text>
            ))}
            {machineNames.length > 1 && <Text style={[styles.cell, styles.head]}>合计</Text>}
            {showDayTokens && <Text style={[styles.cell, styles.head]}>Token</Text>}
          </View>
          {days.map(([date, day], index) => (
            <View key={date} style={[styles.row, index === days.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={styles.cellName}>
                {date}
                {date === summary.today && <Text style={styles.muted}> 今天</Text>}
              </Text>
              {machineNames.map((name) => {
                const t = day.machines.get(name);
                return (
                  <Text key={name} style={[styles.cell, t === undefined && styles.muted]}>
                    {t === undefined ? "–" : formatCost(t.cost)}
                  </Text>
                );
              })}
              {machineNames.length > 1 && <Text style={[styles.cell, styles.bold]}>{formatCost(day.total.cost)}</Text>}
              {showDayTokens && <Text style={[styles.cell, styles.muted]}>{formatTokens(day.total.tokens)}</Text>}
            </View>
          ))}
          {view.days.length > DAYS_COLLAPSED && (
            <Pressable
              accessibilityRole="button"
              style={[styles.more, { marginTop: 8 }]}
              onPress={() => setShowAllDays((v) => !v)}
            >
              <Text style={styles.moreText}>{showAllDays ? "收起" : `显示全部 ${view.days.length} 天`}</Text>
            </Pressable>
          )}
        </View>
      )}
    </Card>
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          {/* Compact layouts already show the screen title in the navigation header. */}
          {!layout.compact && <Text style={styles.title}>Token 用量</Text>}
          <Text style={styles.subtitle}>
            {machineNames.length} 台机器 · 费用按 API 价格折算，不是实际账单
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Segment styles={styles} options={RANGES} value={range} onChange={setRange} />
          <Text style={styles.statusText}>
            {syncing
              ? "正在统计…"
              : `同步于 ${formatAge(minutesSince(summary.lastPullAt ?? summary.lastLocalRunAt, now))} · 经 ${summary.hubHost}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="立即同步"
            accessibilityState={{ disabled: syncing }}
            disabled={syncing}
            style={[styles.button, syncing && { opacity: 0.5 }]}
            onPress={() => sync.mutate()}
          >
            <Icon name="RefreshCw" size={13} color={c.foreground} />
            <Text style={styles.buttonText}>同步</Text>
          </Pressable>
        </View>
      </View>

      {syncing && !hasData && (
        <View style={[styles.notice, { borderColor: c.border, backgroundColor: c.surface1 }]}>
          <Icon name="Info" size={15} color={c.foregroundMuted} />
          <Text style={[styles.noticeText, { flex: 1 }]}>
            第一次要统计本机全部历史日志，大约需要 2 分钟，之后每次只重算最近几天。
          </Text>
        </View>
      )}
      {errors.length > 0 && (
        <View
          style={[
            styles.notice,
            { borderColor: withAlpha(c.statusDanger, 0.5), backgroundColor: withAlpha(c.statusDanger, 0.08) },
          ]}
        >
          <Icon name="CircleAlert" size={15} color={c.statusDanger} />
          <View style={{ flex: 1, gap: 4 }}>
            {errors.map((e) => (
              <Text key={e} style={styles.noticeText}>
                {e}
              </Text>
            ))}
          </View>
        </View>
      )}

      <View style={styles.grid} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {width > 0 &&
          view.kpis.map((kpi) => <KpiTile key={kpi.id} kpi={kpi} styles={styles} theme={theme} width={kpiWidth} />)}
      </View>

      <Card styles={styles} theme={theme} icon="Flame" title="活跃热力图" note="最近一年，所有机器">
        <Heatmap summary={summary} theme={theme} />
      </Card>

      {wide ? (
        <View style={styles.columns}>
          <View style={{ flex: 1.65, gap: 16 }}>
            {trendCard}
            {daysCard}
          </View>
          <View style={{ flex: 1, gap: 16 }}>
            {machinesCard}
            {modelsCard}
          </View>
        </View>
      ) : (
        <>
          {trendCard}
          {machinesCard}
          {modelsCard}
          {daysCard}
        </>
      )}
    </ScrollView>
  );
}
