import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  Loading,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { hubSettings, type HubSettings } from "../shared/usage";

type Draft = Record<keyof HubSettings, string>;

function toDraft(values: HubSettings): Draft {
  return {
    machineName: values.machineName,
    hubHost: values.hubHost,
    hubDir: values.hubDir,
    syncIntervalMinutes: String(values.syncIntervalMinutes),
    timezone: values.timezone,
    ccusagePath: values.ccusagePath,
  };
}

function validate(draft: Draft): { values?: HubSettings; errors: Partial<Record<keyof HubSettings, string>> } {
  const errors: Partial<Record<keyof HubSettings, string>> = {};
  if (!/^[A-Za-z0-9._@-]+$/.test(draft.hubHost.trim())) errors.hubHost = "只能包含字母、数字和 . _ @ -";
  if (!/^[A-Za-z0-9._/~-]+$/.test(draft.hubDir.trim()) || draft.hubDir.split("/").includes("..")) {
    errors.hubDir = "只能包含字母、数字和 . _ / ~ -，不能含 ..";
  }
  const minutes = Number(draft.syncIntervalMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) errors.syncIntervalMinutes = "填 5 到 1440 之间的整数";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: draft.timezone.trim() });
  } catch {
    errors.timezone = "不是有效的 IANA 时区，例如 Asia/Shanghai";
  }
  if (draft.ccusagePath.trim() && !draft.ccusagePath.trim().startsWith("/")) errors.ccusagePath = "填绝对路径，或留空自动查找";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    values: {
      machineName: draft.machineName.trim(),
      hubHost: draft.hubHost.trim(),
      hubDir: draft.hubDir.trim(),
      syncIntervalMinutes: minutes,
      timezone: draft.timezone.trim(),
      ccusagePath: draft.ccusagePath.trim(),
    },
  };
}

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(hubSettings);
  const [draft, setDraft] = useState<{ revision: string; values: Draft } | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  if (settings.status === "loading") return <Loading />;
  if (settings.status === "error") {
    return <Text style={{ color: theme.colors.statusDanger }}>读取设置失败：{settings.error}</Text>;
  }

  const base = settings.status === "ready" ? settings.values : hubSettings.schema.parse({});
  const current = draft ?? { revision: settings.revision, values: toDraft(base) };
  const { values, errors } = validate(current.values);
  const set = (key: keyof HubSettings) => (text: string) =>
    setDraft({ revision: current.revision, values: { ...current.values, [key]: text } });
  const error = (key: keyof HubSettings) => (showErrors ? errors[key] : undefined);

  async function save() {
    setShowErrors(true);
    if (!values) return;
    if (await settings.save(values, current.revision)) {
      setDraft(null);
      setShowErrors(false);
    }
  }

  return (
    <>
      {settings.status === "invalid" && (
        <Text style={{ color: theme.colors.statusDanger }}>已保存的设置无效：{settings.error}。保存一次即可覆盖。</Text>
      )}
      <SettingsSection title="这台机器">
        <SettingsCard>
          <SettingsInput
            label="机器名"
            hint="显示在面板里，也是中转服务器上的文件名。留空则用主机名。"
            initialValue={current.values.machineName}
            placeholder="例如 mac、mbp"
            onChangeText={set("machineName")}
          />
          <SettingsInput
            label="ccusage 路径"
            hint="留空会自动查找 bun、npm 全局安装的 ccusage，找不到再用 bunx 或 npx。"
            initialValue={current.values.ccusagePath}
            placeholder="自动查找"
            error={error("ccusagePath")}
            onChangeText={set("ccusagePath")}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="中转服务器" info="每台机器把自己的统计结果上传到这里，再从这里读取所有机器的结果。只传汇总数字，不传日志。">
        <SettingsCard>
          <SettingsInput
            label="SSH 主机"
            hint="~/.ssh/config 里的别名也可以，需要免密登录。"
            initialValue={current.values.hubHost}
            error={error("hubHost")}
            onChangeText={set("hubHost")}
          />
          <SettingsInput
            label="目录"
            hint="相对于 SSH 用户的 home。所有机器要填同一个。"
            initialValue={current.values.hubDir}
            error={error("hubDir")}
            onChangeText={set("hubDir")}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="统计">
        <SettingsCard>
          <SettingsInput
            label="同步间隔（分钟）"
            initialValue={current.values.syncIntervalMinutes}
            error={error("syncIntervalMinutes")}
            onChangeText={set("syncIntervalMinutes")}
          />
          <SettingsInput
            label="时区"
            hint="决定按哪个时区划分日期。所有机器要一致。"
            initialValue={current.values.timezone}
            error={error("timezone")}
            onChangeText={set("timezone")}
          />
          <SettingsAction
            label={draft ? "有未保存的修改" : "设置已保存"}
            error={settings.saveError ?? undefined}
            actionLabel={settings.saving ? "保存中…" : "保存"}
            disabled={!draft || settings.saving}
            onPress={() => void save()}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
