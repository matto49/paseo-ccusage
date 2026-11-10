# paseo-ccusage

Paseo 插件：把几台电脑的 AI 编程 token 用量汇总到一个面板里。底层用 [ccusage](https://github.com/ccusage/ccusage) 统计，插件只负责汇总和展示。

```
每台电脑：插件定时运行 ccusage daily --json --by-agent，结果缓存在本机
        ↓ ssh 上传汇总结果（不传日志）
中转服务器 ycy：~/.ccusage-hub/<机器名>.json
        ↓ ssh 下载所有机器的结果
Paseo 侧边栏「Token 用量」：按机器、按天、按工具和模型显示
```

- 新机器接入：[docs/setup.md](docs/setup.md)
- 功能和设置说明：[OVERVIEW.md](OVERVIEW.md)

## 代码结构

| 路径 | 作用 |
|---|---|
| `shared/usage.ts` | 数据结构、RPC 和设置定义 |
| `server/ccusage.ts` | 查找并运行 ccusage，把输出整理成统一的行 |
| `server/hub.ts` | 通过 ssh 上传、下载、删除中转服务器上的文件 |
| `server/sync.ts` | 增量统计、本地缓存、改名处理、合并所有机器的数据 |
| `client/usage-screen.tsx` | 用量面板 |
| `client/settings-screen.tsx` | 设置页 |

本地开发：`bun install && bun x tsc --noEmit`，再执行 `paseo plugin add <本目录>` 装到本机 daemon。改完代码后执行 `paseo plugin reload ccusage-hub` 生效。

## 许可

MIT，见 [LICENSE](LICENSE)。
