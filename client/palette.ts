import type { PluginTheme } from "@getpaseo/plugin";

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** The theme only exposes colors, so read the mode off the base surface. */
export function isDarkTheme(theme: PluginTheme): boolean {
  const rgb = parseHex(theme.colors.surface0);
  if (!rgb) return true;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

/** `color` at `alpha`; colors that are not plain hex are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

// Categorical slots 1-3 of the validated reference palette (blue, orange, aqua), stepped per mode.
// Machines take slots in a fixed order; a fourth machine onward falls back to the muted ink.
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70"];

export function seriesColors(theme: PluginTheme): string[] {
  return isDarkTheme(theme) ? SERIES_DARK : SERIES_LIGHT;
}

export function machineColor(theme: PluginTheme, index: number): string {
  return seriesColors(theme)[index] ?? theme.colors.foregroundMuted;
}

/** Sequential heat steps: one hue, from faint to full. Level 0 is the empty cell. */
export function heatColors(theme: PluginTheme): string[] {
  const dark = isDarkTheme(theme);
  const base = dark ? "#199e70" : "#1baf7a";
  return [
    theme.colors.surface2,
    withAlpha(base, dark ? 0.3 : 0.25),
    withAlpha(base, dark ? 0.5 : 0.45),
    withAlpha(base, dark ? 0.75 : 0.7),
    base,
  ];
}
