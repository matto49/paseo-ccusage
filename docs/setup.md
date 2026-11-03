# 新机器接入

把一台新电脑接进 Token 用量汇总，全程大约 10 分钟，其中第一次统计要等几分钟。下面以接入 `mbp` 为例，换成别的机器时把名字改掉即可。

已接入的机器：`mba`（MacBook Air）。中转服务器：`ycy`，汇总文件放在它的 `~/.ccusage-hub/` 下。

## 0. 前提

- 已安装 Paseo 桌面版 0.14.0 以上，daemon 在运行：`paseo status` 能看到 `localDaemon: running`。
- 这台电脑能访问 GitHub 上的私有仓库 `matto49/paseo-ccusage`（`gh auth status` 已登录，或配置了 GitHub SSH key）。

## 1. 确认能免密 SSH 到 ycy

插件在后台用 `ssh ycy` 上传和下载，不能弹出密码或确认提示。运行：

```bash
ssh -o BatchMode=yes ycy 'echo ok'
```

输出 `ok` 就可以进入下一步。不通的话，按报错处理：

- **`Could not resolve hostname ycy`**：`~/.ssh/config` 里没有 `ycy` 这个别名。从 mba 的 `~/.ssh/config` 复制 `Host ycy` 那一段过来：

  ```
  Host ycy
    HostName <ycy 的 IP，和 mba 上的一样>
    User root
    IdentityFile ~/.ssh/id_rsa
    IdentitiesOnly yes
  ```

- **`Permission denied`**：这台电脑的公钥还没加到 ycy 上。执行一次 `ssh-copy-id -i ~/.ssh/id_rsa.pub ycy`，输入一次密码即可。
- **`Host key verification failed`**：先手动执行一次 `ssh ycy`，在提示里输入 `yes` 接受主机指纹。
- 私钥有口令时，要确保 ssh-agent 里已经加载了这个私钥（`ssh-add -l` 能看到），否则后台进程用不了它。最省事的做法是用一把没有口令的专用 key。

## 2. 安装 ccusage

插件按下面的顺序查找 ccusage：bun 全局安装 → npm 全局安装 → PATH 里的 `ccusage` → `bunx ccusage@latest` → `npx -y ccusage@latest`。装一个全局版本最快、最稳：

```bash
bun add -g ccusage      # 有 bun 时
# 或
npm i -g ccusage        # 有 node 时
```

验证（bun 安装的话，在没有 node 的机器上用第二条）：

```bash
ccusage --version
~/.bun/install/global/node_modules/@ccusage/ccusage-darwin-arm64/bin/ccusage --version
```

Intel Mac 把路径里的 `darwin-arm64` 换成 `darwin-x64`。

## 3. 先写好机器名

插件装好后约 5 秒就会开始第一次同步。先写好设置，它就会直接用 `mbp` 这个名字上传，不会先用主机名传一份：

```bash
D=~/.paseo/plugin-settings/ccusage-hub
mkdir -p "$D" && chmod 700 ~/.paseo/plugin-settings "$D"
(umask 077; printf '%s' '{"version":1,"values":{"machineName":"mbp","hubHost":"ycy","hubDir":".ccusage-hub","syncIntervalMinutes":30,"timezone":"Asia/Shanghai","ccusagePath":""}}' > "$D/hub.json")
```

- `machineName`：显示在面板里的名字，也是 ycy 上的文件名，每台机器要不一样。
- `hubHost` / `hubDir` / `timezone`：所有机器必须一致，否则数据会分散，或者日期错开一天。
- `ccusagePath`：留空即自动查找。找不到时填 ccusage 可执行文件的绝对路径。

跳过这一步也可以，装好后在 Paseo 的「设置 → 插件 → Token 用量」里改，效果相同。插件会自动删除用旧名字上传的文件。

## 4. 安装插件

```bash
paseo plugin add git:matto49/paseo-ccusage
paseo plugin ls
```

`ccusage-hub` 一行显示 `running` 即安装成功。

## 5. 确认第一次同步成功

第一次要统计全部历史日志，可能要几分钟。查看日志：

```bash
paseo plugin logs ccusage-hub
```

正常情况下会依次出现：

```
[ccusage-hub] using .../ccusage (ccusage 20.x.x)
[ccusage-hub] counted full history in 88s, 157 rows
```

然后确认 ycy 上已经有这台机器的文件：

```bash
ssh ycy 'ls -la ~/.ccusage-hub'
```

应该能看到 `mba.json` 和 `mbp.json`。

最后打开 Paseo 侧边栏的「Token 用量」，「按机器」表里应该同时有 mba 和 mbp。另一台机器的数据最多晚一个同步间隔（默认 30 分钟），点右上角「同步」可以立即刷新本机数据。

## 常见问题

| 现象 | 原因和处理 |
|---|---|
| 日志里有 `No working ccusage found` / `ccusage not found` | 回到第 2 步安装，或者在设置里填 `ccusagePath`。 |
| 面板显示「Upload to ycy failed」或「Download from ycy failed」 | SSH 不通，回到第 1 步，用 `ssh -o BatchMode=yes ycy 'echo ok'` 排查。 |
| 面板里某台机器的「数据更新」时间显示成黄色 | 那台机器超过 2 小时没上传了，通常是电脑休眠或者 Paseo 没在运行。 |
| 同一台机器在面板里出现两次 | 改名时没走插件（比如手动改了 ycy 上的文件）。在 ycy 上删掉 `~/.ccusage-hub/<旧名字>.json`。 |
| 两台机器同一天的数据对不上日期 | 两边的 `timezone` 不一致，改成同一个。 |

## 更新和卸载

```bash
paseo plugin update ccusage-hub   # 拉取仓库最新代码
paseo plugin remove ccusage-hub   # 卸载
```

卸载不会删除 ycy 上的文件。不再统计这台机器时，执行 `ssh ycy 'rm ~/.ccusage-hub/mbp.json'`。

## 数据说明

- 上传的只有按天、工具、模型汇总的 token 数和费用，不含日志或对话内容。
- 费用按 API 价格折算，订阅用户看到的不是实际扣费。
- 统计结果在本机缓存于 `~/.paseo/plugin-data/ccusage-hub/`。agent 工具清理掉的旧日志对应的历史用量会一直保留。
