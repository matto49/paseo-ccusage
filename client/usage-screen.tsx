import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { summaryRpc, syncRpc, type Summary } from "../shared/usage";
import { formatAge, formatCost, formatTokens, minutesSince, shiftDate } from "./format";

type Range = "today" | "7d" | "30d" | "all";
const RANGES: Array<{ id: Range; label: string; days: number | null }> = [
  { id: "today", label: "今天", days: 1 },
  { id: "7d", label: "7 天", days: 7 },
  { id: "30d", label: "30 天", days: 30 },
  { id: "all", label: "全部", days: null },
];
const STALE_MINUTES = 120;
const QUERY_KEY = ["ccusage-hub", "summary"];

interface Totals {
  cost: number;
  tokens: number;
}
const emptyTotals = (): Totals => ({ cost: 0, tokens: 0 });

function aggregate(summary: Summary, range: Range) {
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const start = days ? shiftDate(summary.today, -(days - 1)) : "";
  const rows = summary.rows.filter((r) => r.date >= start);

  const byMachine = new Map<string, Totals>();
  const byDay = new Map<string, { total: Totals; machines: Map<string, number> }>();
  const byModel = new Map<string, Totals & { agent: string; model: string }>();
  const total = emptyTotals();

  for (const r of rows) {
    const tokens = r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;
    total.cost += r.cost;
    total.tokens += tokens;

    const m = byMachine.get(r.machine) ?? emptyTotals();
    m.cost += r.cost;
    m.tokens += tokens;
    byMachine.set(r.machine, m);

    const day = byDay.get(r.date) ?? { total: emptyTotals(), machines: new Map<string, number>() };
    day.total.cost += r.cost;
    day.total.tokens += tokens;
    day.machines.set(r.machine, (day.machines.get(r.machine) ?? 0) + r.cost);
    byDay.set(r.date, day);

    const key = `${r.agent}\u0000${r.model}`;
    const model = byModel.get(key) ?? { agent: r.agent, model: r.model, ...emptyTotals() };
    model.cost += r.cost;
    model.tokens += tokens;
    byModel.set(key, model);
  }

  return {
    total,
    byMachine,
    days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])),
    models: [...byModel.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
  };
}

function makeStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  return {
    root: { flex: 1, backgroundColor: c.surface0 },
    content: { padding: compact ? 16 : 24, gap: 28, maxWidth: 960, width: "100%" as const, alignSelf: "center" as const },
    toolbar: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 12, flexWrap: "wrap" as const },
    segment: { flexDirection: "row" as const, backgroundColor: c.surface2, borderRadius: 8, padding: 2 },
    segmentItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
    segmentItemActive: { backgroundColor: c.surface0 },
    segmentText: { fontSize: 13, color: c.foregroundMuted },
    segmentTextActive: { color: c.foreground, fontWeight: "600" as const },
    status: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    statusText: { fontSize: 12, color: c.foregroundMuted },
    refresh: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border },
    refreshText: { fontSize: 13, color: c.foreground },
    notice: { gap: 4 },
    noticeText: { fontSize: 13, lineHeight: 19 },
    section: { gap: 8 },
    heading: { fontSize: 13, fontWeight: "600" as const, color: c.foreground },
    headingNote: { fontSize: 12, color: c.foregroundMuted, fontWeight: "400" as const },
    row: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border, gap: 12 },
    headRow: { paddingVertical: 6 },
    totalRow: { borderBottomWidth: 0 },
    cellName: { flex: 1.6, fontSize: 13, color: c.foreground },
    cell: { flex: 1, fontSize: 13, color: c.foreground, textAlign: "right" as const, fontVariant: ["tabular-nums" as const] },
    head: { fontSize: 12, color: c.foregroundMuted },
    muted: { color: c.foregroundMuted },
    bold: { fontWeight: "600" as const },
    warn: { color: c.statusWarning },
    danger: { color: c.statusDanger },
    empty: { fontSize: 13, color: c.foregroundMuted, paddingVertical: 8 },
  };
}
type Styles = ReturnType<typeof makeStyles>;

function Table({ styles, head, children }: { styles: Styles; head: ReactNode[]; children: ReactNode }) {
  return (
    <View>
      <View style={[styles.row, styles.headRow]}>
        {head.map((h, i) => (
          <Text key={i} style={[i === 0 ? styles.cellName : styles.cell, styles.head]} numberOfLines={1}>
            {h}
          </Text>
        ))}
      </View>
      {children}
    </View>
  );
}

export function UsageScreen({ theme, layout }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const [range, setRange] = useState<Range>("7d");
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

  const now = Date.now();
  const syncing = summary.syncing || sync.isPending;
  const hasData = summary.rows.length > 0;
  const machineNames = summary.machines.map((m) => m.machine);
  const showDayTokens = !layout.compact;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <View style={styles.segment} accessibilityRole="tablist">
          {RANGES.map((r) => {
            const active = r.id === range;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setRange(r.id)}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.status}>
          <Text style={styles.statusText}>
            {syncing ? "正在统计…" : `同步于 ${formatAge(minutesSince(summary.lastPullAt ?? summary.lastLocalRunAt, now))} · 经 ${summary.hubHost}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="立即同步"
            accessibilityState={{ disabled: syncing }}
            disabled={syncing}
            style={[styles.refresh, syncing && { opacity: 0.5 }]}
            onPress={() => sync.mutate()}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
            <Text style={styles.refreshText}>同步</Text>
          </Pressable>
        </View>
      </View>

      {(summary.localError || summary.hubError || sync.error || (syncing && !hasData)) && (
        <View style={styles.notice}>
          {syncing && !hasData && (
            <Text style={[styles.noticeText, styles.muted]}>
              第一次要统计本机全部历史日志，大约需要 2 分钟，之后每次只重算最近几天。
            </Text>
          )}
          {summary.localError && <Text style={[styles.noticeText, styles.danger]}>本机统计失败：{summary.localError}</Text>}
          {summary.hubError && <Text style={[styles.noticeText, styles.danger]}>{summary.hubError}</Text>}
          {sync.error && <Text style={[styles.noticeText, styles.danger]}>同步请求失败：{(sync.error as Error).message}</Text>}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.heading}>
          按机器 <Text style={styles.headingNote}>费用按 API 价格折算，不是实际账单</Text>
        </Text>
        <Table styles={styles} head={["机器", "费用", "Token", "数据更新"]}>
          {summary.machines.map((m) => {
            const t = view.byMachine.get(m.machine) ?? emptyTotals();
            const age = minutesSince(m.generatedAt, now);
            const stale = age === null || age > STALE_MINUTES;
            return (
              <View key={m.machine} style={styles.row}>
                <Text style={styles.cellName} numberOfLines={1}>
                  {m.machine}
                  {m.isSelf && <Text style={styles.muted}>（本机）</Text>}
                </Text>
                <Text style={styles.cell}>{formatCost(t.cost)}</Text>
                <Text style={styles.cell}>{formatTokens(t.tokens)}</Text>
                <Text style={[styles.cell, stale ? styles.warn : styles.muted]}>{formatAge(age)}</Text>
              </View>
            );
          })}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={[styles.cellName, styles.bold]}>合计</Text>
            <Text style={[styles.cell, styles.bold]}>{formatCost(view.total.cost)}</Text>
            <Text style={[styles.cell, styles.bold]}>{formatTokens(view.total.tokens)}</Text>
            <Text style={styles.cell} />
          </View>
        </Table>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>按天</Text>
        {view.days.length === 0 ? (
          <Text style={styles.empty}>{hasData ? "这个时间段没有用量。" : "还没有数据，第一次统计完成后会显示在这里。"}</Text>
        ) : (
          <Table styles={styles} head={["日期", ...machineNames, ...(machineNames.length > 1 ? ["合计"] : []), ...(showDayTokens ? ["Token"] : [])]}>
            {view.days.map(([date, day]) => (
              <View key={date} style={styles.row}>
                <Text style={styles.cellName}>
                  {date}
                  {date === summary.today && <Text style={styles.muted}>（今天）</Text>}
                </Text>
                {machineNames.map((name) => {
                  const cost = day.machines.get(name);
                  return (
                    <Text key={name} style={[styles.cell, cost === undefined && styles.muted]}>
                      {cost === undefined ? "–" : formatCost(cost)}
                    </Text>
                  );
                })}
                {machineNames.length > 1 && <Text style={[styles.cell, styles.bold]}>{formatCost(day.total.cost)}</Text>}
                {showDayTokens && <Text style={[styles.cell, styles.muted]}>{formatTokens(day.total.tokens)}</Text>}
              </View>
            ))}
          </Table>
        )}
      </View>

      {view.models.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.heading}>按工具和模型</Text>
          <Table styles={styles} head={["模型", "工具", "费用", "Token"]}>
            {view.models.map((m) => (
              <View key={`${m.agent}/${m.model}`} style={styles.row}>
                <Text style={styles.cellName} numberOfLines={1}>{m.model}</Text>
                <Text style={[styles.cell, styles.muted]}>{m.agent}</Text>
                <Text style={styles.cell}>{formatCost(m.cost)}</Text>
                <Text style={styles.cell}>{formatTokens(m.tokens)}</Text>
              </View>
            ))}
          </Table>
        </View>
      )}
    </ScrollView>
  );
}
