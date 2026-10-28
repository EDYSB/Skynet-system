# tools/

所有真实工具都放在这个目录，不装到系统里。`lab.js` 优先查这里，其次查 `PATH`。

```
tools/
  bin/                统一入口（.cmd 包装），加进 PATH 就能直接敲命令
  sqlmap/             sqlmap 1.10.10 源码
  sqlmap-output/      sqlmap --output-dir
  py/                 Volatility 3.2.28（pip --target 装的）
  run-vol.cmd         Volatility 启动器（缓存目录指到项目内）
  install-tools.ps1   便携版优先的安装器，全部解压到 tools/<name>/
  env.cmd             把 tools\bin 加进当前窗口的 PATH
```

## 已经可用

| 命令 | 实际路径 | 说明 |
| --- | --- | --- |
| `tools\bin\sqlmap.cmd` | `tools/sqlmap/sqlmap.py` | 等价于面板里的 `sqlmap <url>` |
| `tools\bin\vol.cmd` | `tools/py` + `run-vol.cmd` | 例：`vol -f dump.raw windows.pslist` |

不想写全路径的话，先执行一次：

```
tools\env.cmd
```

它只影响当前命令行窗口，然后就能直接敲 `sqlmap`、`vol`。

## 安装其余工具

```
powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1 -ListOnly   # 看清单
powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1             # 只装便携版
powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1 -WithInstallers  # 额外跑 winget（需管理员）
```

### 便携版（解压进 tools\<name>\）

| 工具 | 地址 | 状态 |
| --- | --- | --- |
| Nmap | `nmap.org/dist/nmap-7.92-win32.zip` | HEAD 200，21.8 MB |
| ExifTool | `sourceforge.net/projects/exiftool/files/exiftool-13.59_64.zip/download` | HEAD 200（官网直链其实是 SourceForge 跳转） |
| TestDisk | `cgsecurity.org/Download_and_donate.php/testdisk-7.3-WIP.win64.zip` | HEAD 200（7.3 正式版没有 Windows 包，只有 WIP） |

装完会自动在 `bin/` 生成同名 `.cmd`，例如 `bin\nmap.cmd`。

### winget（系统安装，需管理员）

Wireshark（含 Npcap）、Burp Suite Community、Nessus、Autopsy、CherryTree、ffuf —— ID 都是 `winget search` 实测过的，脚本里带 `--exact`，不会装错包。

### 只能手动装

| 工具 | 来源 |
| --- | --- |
| Metasploit Framework | `windows.metasploit.com` 官方 MSI |
| Hashcat | `hashcat.net/hashcat/` |
| John the Ripper | `openwall.com/john/` |
| theHarvester | `github.com/laramies/theHarvester`（PyPI 上的是空壳包） |
| NetExec | `github.com/Pennyw0rth/NetExec` |
| Gobuster | `github.com/OJ/gobuster/releases` |
| Nikto / Dirb | 先装 Strawberry Perl，再下脚本 |
| tcpdump / ettercap | 建议走 WSL |
| Bettercap | `bettercap.org/installation/` |

## 本机的两个硬限制

1. **没有管理员权限** —— MSI / 驱动类安装（Wireshark + Npcap、Nessus、Autopsy、Metasploit）必须提权。
2. **国际带宽约 10–30 KB/s** —— nmap 那个 21.8 MB 的包在这台机器上要下半小时以上；GitHub 基本不可达。清华 PyPI 镜像很快（sqlmap、Volatility 都是几十秒装完），所以 Python 工具优先走镜像。

## 不接的两项

SET（Social-Engineer Toolkit）和 Gophish 是钓鱼/凭据收集框架，不进这个目录——面板监听 `0.0.0.0`、口令是公开默认值，接进来等于给同网段的人一套现成钓鱼后台。要学这类内容，自己在隔离虚拟机里单独装。
