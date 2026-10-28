# 天网 SKYNET · 地球系统观测网络

一个统一的深色指挥舱界面：HAAVK 的蓝白排版 + eDEX-UI 的终端质感 + 实时地球观测 + 本机网络探针。

包含三个模式：

- **行星观测**：3D 地球 + 可深度放大的实时卫星地图
- **网络空间**：真实 BGP / 威胁情报 / 本机 TCP + 可缩放、可追踪的网络地图
- **终端**：eDEX-UI 风格命令终端 + 系统监控 + 文件浏览 + SKYNET 安全指令

渗透靶场不再单独做一套 UI，全部融合进现有终端，终端风格保持 `SKYNET`。

另外，通过本地服务访问时，入口是一道**身份核验网关**。

> 观测画面没有真实下行源时显示 `NO SIGNAL / 无信号`，两路分别使用失锁纹样和待机测试卡，不再生成相同的假卫星图。

---

## 一、身份核验 / 局域网访问

### 默认凭据

| 项目 | 值 |
| --- | --- |
| 操作员账号 | `operator`（登录页已预填） |
| 访问口令 | `Skynet-Lab-8Q2x` |
| 默认端口 | `8792` |

凭据可在启动前用环境变量覆盖：

```bat
set SKYNET_USER=你的账号
set SKYNET_PASS=你的口令
node server.js
```

### 入口流程

1. 双击 **`start.bat`**，或运行 `node server.js`
2. 浏览器打开 `http://127.0.0.1:8792/`
3. 自动跳转到身份核验页
4. 输入账号与口令
5. 核验通过后播放系统语音问候，并进入主界面

### 局域网访问

服务监听 `0.0.0.0:8792`，启动时控制台会打印所有局域网地址，例如：

```
http://127.0.0.1:8792/
```

同一局域网内的设备打开该地址即可进入核验页。首次运行时 Windows 防火墙可能询问是否允许 Node.js 访问专用网络，请选择允许。

> 这是演示级局域网网关：HTTP 明文传输、会话保存在内存中、默认凭据公开写在本文档里。不要把它直接暴露到公网，也不要用它保护真实敏感数据。生产环境应使用 HTTPS、数据库用户体系与更强的会话管理。

如果 `8792` 也被占用，修改 `server.js` 顶部的 `const PORT = 8792;`，同时修改 `start.bat` 和 `app.js` 中的探针地址。

### 安全实现

- 登录由服务端校验，凭据不在前端 JavaScript 中
- 登录成功签发 `HttpOnly` 会话 Cookie，有效期 12 小时
- 应用页与数据 API（网卡、系统、文件、真实探针 `/api/lab/*`）都需要会话
- 静态文件白名单：`server.js`、`README.md`、`start.bat` 不会被 Web 服务暴露
- 未登录访问 `/index.html`（包括大小写、路径别名）会跳回核验页；数据 API 返回 401
- F12 控制台不能直接进入：没有会话时只能调用登录接口，无法读取系统/文件/网卡数据；会话 Cookie 为 HttpOnly，`document.cookie` 读不到
- 账号大小写不敏感，口令区分大小写；前后空格会自动忽略
- 同一 IP 连续失败 6 次，锁定 60 秒
- 顶部电源按钮 `⏻` 可立即注销并清除会话
- 直接双击 `index.html` 属于本机文件模式，不经过网关（也不会启用本机探针）

### 登录不上排查

- 口令 `Skynet-Lab-8Q2x` 区分大小写，账号大小写不敏感；前后空格已自动忽略
- 账号 `operator` 已预填在输入框里，只需输入口令；如果账号框被清空，会提示“请输入操作员账号”
- 浏览器自动填充可能填入旧口令；登录框聚焦时会全选，直接重新输入，或点“显示”核对
- 页面右上角显示 429 时等待 60 秒；重启 `server.js` 会立即清空该 IP 的失败计数
- 确认地址是 `http://IP:8792/`，旧标签页请 `Ctrl+F5` 强制刷新

---

## 二、行星观测

### 实时数据源

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| M4.5+ 地震 | USGS | 过去 24 小时，每 120 秒刷新 |
| 自然事件 | NASA EONET v3 | 野火、强风暴、火山、洪水、海冰等 |
| 雷达回波 | RainViewer | 地图「降水」图层，最新雷达帧 |
| 近实时卫星 | NASA GIBS / VIIRS | 地图「实时卫星」图层，约 T-1 日真彩 |
| 深缩放底图 | 高德地图 | 卫星 / 街道，最高 18 级 |

### 交互

- 顶部 `行星观测 / 网络空间 / 终端`：切换模式
- 舞台右上 `3D 地球 / 地图`：切换视图
- 拖动地球旋转，滚轮缩放，双击复位
- 地图支持拖动、滚轮、`+ / -` 深度缩放，以及卫星、街道、实时卫星、降水图层
- 点击事件标签或地图圆点切换档案；`定位视角` 可飞到事件位置
- 事件流右上 `↻` 立即刷新

---

## 三、网络空间

### 真实数据链路

`server.js` 内置聚合层，通过 SSE `/api/stream` 向已登录前端推送：

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| BGP 实时流 | RIPE RIS Live WebSocket | 真实 UPDATE，origin change 作为启发式告警 |
| 已知利用漏洞 | CISA KEV | 真实目录，最近条目进入威胁列表 |
| 上游状态 | Cloudflare / GitHub Status API | 真实服务状态 |
| DROP 列表 | Spamhaus DROP | 真实 IP 段清单计数 |
| 本机 TCP | `netstat -ano` | 真实 ESTABLISHED 连接，过滤回环 |
| 本机吞吐 / 系统 | Windows 网卡计数器 + Node os | 真实本机数据 |

真实前台标签：`RIS LIVE`、`KEV`、`STATUS`、`LOCAL TCP`。
全球骨干拓扑弧线仍为示意；地图上的真实 BGP 脉冲使用 RRC 采集器地理位置。

### 网络地图交互

- 滚轮缩放，拖动平移，双击复位
- 右侧 `+ / − / ⌖` 控件
- 点击节点持续追踪该节点
- `TRACK` 持续追踪最新真实 BGP 事件（按 RRC 采集器定位）
- 当前追踪目标与 BGP 前缀显示在地图右上角和底部实时条

> 真实部分：BGP、KEV、Status、本机 TCP、本机吞吐。拓扑为示意；协议端口分布由本机 TCP 近似得出。


---

## 四、终端

受 eDEX-UI 启发的全屏终端模式：

- ASCII `SKYNET` 开机横幅、扫描线、青色辉光
- 系统面板：CPU / MEM / DISK、真实曲线、真实进程列表
- 右侧：真实网卡曲线、实时事件、真实工作区文件
- 屏幕键盘 + 物理键盘高亮
- **所有面板与命令都读取真实数据**：本机服务未启动、字段无权限读取或探测失败时，显示 `--` 或明确错误，不生成任何替代数据

### 面板数据来源

| 面板 | 来源 |
| --- | --- |
| CPU / MEM / DISK / UPTIME | Node `os` + `fs.statfs`（`/api/sysstats`） |
| 进程 TOP | PowerShell `Get-Process` + 600ms 采样（`/api/lab/procs`） |
| 网络曲线 / PPS | Windows 网卡计数器（字节 + 数据包，`/api/netstats`） |
| 文件列表 / `cat` | `/api/files`、`/api/file` 真实工作区 |
| 事件 | USGS / NASA EONET；无下行源时保留样例并在状态栏标注 `SAMPLE` |

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `help` | 命令列表 |
| `status` | 系统 / 数据 / 探针摘要 |
| `events` | 实时事件列表 |
| `event <n>` | 查看第 n 条事件 |
| `focus <n>` | 打开地图并飞到事件 |
| `earth` / `map` / `net` | 切换模式 |
| `refresh` | 刷新实时数据 |
| `sys` / `systeminfo` | 系统遥测 |
| `ipconfig` | 真实网卡地址 + 链路速率 |
| `ver` | 真实 Windows 版本 / 构建号 |
| `tasklist` | 真实进程列表 |
| `netstat` | 真实监听端口 |
| `ls` / `cat README.md` | 浏览项目文件 |
| `cd <dir>` / `dir [path]` | cmd 风格切换目录、列目录（受限于项目目录） |
| `type <file>` | cmd 风格读取文件 |
| `run <file> [line]` | 带行号的分页查看器，每页 200 行；支持本机绝对路径 |
| `start <file>` | 同 `run`，打开文件 |
| `cls` / `echo` / `pwd` | 清屏 / 回显 / 当前路径 |
| `tree [path] [depth]` | 动画目录树（扫描进度条 + 生长效果），`--fast` 跳过动画 |
| `cartoon` | 60 秒二进制雨：0/1 满屏滚动，20fps，任意键中止 |
| `python [code\|file.py]` | 跑代码或工作区里的 `.py` 文件（可带参数）；不带参数进 REPL |
| `ping <host>` | 真实 ICMP 延迟；ICMP 被过滤时退回真实 TCP 握手延迟 |
| `probe` | 本机探针状态 |
| `clear` / `banner` / `reboot` | 终端控制 |
| `exit` | 返回地球 |

### SKYNET 安全指令（终端内，全部真实）

| 命令 | 作用 |
| --- | --- |
| `ops` / `tools` | 真实探测清单 |
| `recon` | 主机 / OS / CPU / 网卡 / 网关 / DNS / 补丁 / Defender / SMBv1 / RDP / 本机工具 |
| `nmap [ports]` | 127.0.0.1 TCP connect 扫描，真实握手与延迟 |
| `web` | 本机 HTTP 指纹 + TLS 证书（真实状态码、响应头、耗时） |
| `audit` | Defender / 防火墙 / UAC / SMBv1 / SMB 签名 / RDP / Secure Boot / 补丁 / 监听端口 |
| `vuln` | 由真实读数推导结论，附 CVE / CISA KEV 参考 |
| `searchsploit <q>` | NVD CVE 2.0 实时检索 + CISA KEV 交叉标注 |
| `msf` | 原生扫描控制台（端口 / HTTP 头 / OPTIONS / banner / TLS / DNS / RDAP / robots.txt） |
| `lab` | 真实工具就绪情况（sqlmap 等） |
| `toolkit` | 16 个工具的安装状态：`tools/` 优先，其次 `PATH`，缺的给出装法 |
| `nmap <host> [ports]` | 装了真 nmap 就走真 nmap；只给端口时退回本机 connect 扫描 |
| `sqlmap` / `sqli` | 真实注入检测 + 库 / 表枚举，目标由 URL 指定 |
| `payload <text>` | 真实编码（base64 / hex / URL）+ SHA-256 + 信息熵（不生成 shellcode） |
| `scope` / `target` | 回环作用域 |
| `report` | 下载真实 Markdown 报告 |
| `hash <text>` | 真实 SHA-256 |

### 真实边界与行为

- 主动探测只允许 `127.0.0.1` / `localhost` / `::1`，不做外网扫描
- `sqlmap` 的目标由终端里显式给出的 URL 决定，只接受本机发起的请求（远程来源一律 403）
- 工具缺失时返回真实错误与安装方式（`lab` 命令可查），绝不伪造输出
- `searchsploit` 需要联网访问 NVD / CISA；失败时显示真实错误，不返回假条目
- 不生成反弹 shell、不做后渗透、不做持久化；`payload` 只做编码
- 需要管理员权限的字段（防火墙、监听端口、部分 Defender 状态）读不到时显示“不可读取”
- `ping` 优先 ICMP；ICMP 被过滤时改用真实 TCP 握手延迟并明确标注

支持 `↑ ↓` 历史、`Tab` 补全、`Ctrl+L` 清屏、`F1` 帮助。

---

## 五、运行方式

### 完整体验（推荐）

双击 **`start.bat`**。

它会启动 Node 服务（`8792`）、打开浏览器并进入身份核验页。关闭命令行窗口即停止服务。

需要 Node.js 22+（内置 WebSocket），无需 npm 依赖。

### 攻击模块

| 模块 | 现状 |
| --- | --- |
| `sqlmap` | 已内置 `tools/sqlmap/`（gitee 镜像克隆），终端里 `sqlmap <URL>` 直接跑真实注入检测 |
| `payload` | 只做编码与摘要，不生成 shellcode / 反弹 shell |

`lab` 命令查看真实工具就绪状态。

> 杀毒软件通常会把 sqlmap 报为 hacktool。**不要把整机防护关掉**，给 `tools\sqlmap` 加个排除项即可；演示结束记得删掉排除项。

### 指定目标

终端里直接给完整 URL：

```
sqlmap http://127.0.0.1:8000/product?id=1
```

规矩：

1. **sqlmap 必须带查询参数**（`?id=1` 这种），否则没有注入点可测；只给路径会提示“没有查询参数”，不会瞎跑。
2. **来源策略可切换**。默认允许局域网任何已登录用户填目标（方便远程演示），每次远程调用会在服务端窗口打一行审计日志；设 `SKYNET_REMOTE_TARGETS=local` 就退回“只允许本机发起”，其余来源一律 `403`。

### 靶机限制（已删除）

原来的本地靶机（`127.0.0.1:8793`）、目标白名单 `lab-targets.json`、字典 `lab-wordlist.txt` 都在 `靶机限制/` 目录，**已按要求整个删除**。删除后的表现：

- 面板照常启动，`lab` 里显示「内置靶机 已移除」
- `sqlmap` 没有默认目标，必须显式给 URL，否则提示用法
- `hydra` / `msfconsole` 相关命令已从终端移除（Windows 上跑不起来）

想恢复其中两个文件（版本库里有）：

```
git checkout HEAD -- lab-target.js lab-wordlist.txt
mkdir 靶机限制
move lab-target.js 靶机限制\
move lab-wordlist.txt 靶机限制\
```

`lab-targets.json` 从未提交过，需要照原样手写（380 字节，结构见 git 历史之外的本说明上一条）。把三个文件放回 `靶机限制/` 后，`lab.js` 和 `server.js` 会自动重新加载，不用改代码。

### 直接打开

双击 **`index.html`**：

- 实时事件、地图、终端模式可用（需要联网）
- 终端里的文件读取、本机探针、真实安全指令不可用，会明确提示需要 `start.bat`（不会显示假数据）
- 不会出现身份核验页

---

## 六、文件

| 文件 | 说明 |
| --- | --- |
| `login.html` / `login.css` / `login.js` | 身份核验网关 |
| `index.html` | 主界面（四模式） |
| `styles.css` | 深色基础样式 |
| `theme-light.css` | 地图 / 网络空间布局基础 |
| `theme-unified.css` | 统一深色指挥舱配色（最后覆盖） |
| `terminal.css` | eDEX 风格终端 |
| `app.js` | 3D 地球、实时数据、地图、网络、终端、真实安全指令 |
| `server.js` | 静态服务 + 身份会话 + 真实数据聚合 + 探针 API 路由 + 凭据审计 |
| `lab.js` | 真实探针库：TCP / banner / TLS / HTTP / DNS / RDAP / ICMP / 进程 / 主机姿态 / 注入审计 / 真实工具执行 |
| `tools/` | 真实工具目录：`sqlmap/`、Volatility 3（`py/` + `run-vol.cmd`）、`install-tools.ps1` 一键装其余工具，详见 `tools/README.md` |
| `intel.js` | 真实漏洞情报：NVD CVE API 2.0 + CISA KEV |
| `start.bat` | 一键启动 |
| `vendor/three.min.js` | Three.js r160 |
| `vendor/leaflet/` | Leaflet 1.9.4 |
| `vendor/textures.js` | 内嵌 NASA 地球纹理 |

---

## 七、数据与版权

- 地震：USGS，公共领域
- 自然事件：NASA EONET，NASA 开放数据
- 卫星：NASA GIBS / VIIRS
- 雷达：RainViewer
- 底图：© 高德地图（个人演示；商用请遵循高德开放平台条款）
- 地球纹理：NASA Blue Marble / Black Marble，经 three-globe 示例资源转存
- 行星体征为公开资料基线，不是实时观测
- 观测画面无真实下行源时显示 `NO SIGNAL / 无信号`，两路分别使用失锁纹样与待机测试卡
- 网络空间：吞吐 / 连接数 / 对端主机 / 协议占比 / 威胁条目全部来自本机探针与真实订阅源；探针未连接时显示 `--`，不生成替代数字；全球拓扑弧线为示意
- 终端漏洞情报：NVD CVE API 2.0（NIST，公共领域）、CISA KEV（公共领域）
- 终端探测：全部为本机真实读数与真实网络请求，无模拟数据

本项目是概念演示，不用于实际地震预警、气象预警或网络安全防护。

---

## 八、自检

- 1920×1080 / 1440×900 / 1366×768 三种尺寸无横向溢出
- 身份核验：错误口令拒绝、正确口令通过、会话 Cookie、注销、API 保护
- 局域网地址 `http://127.0.0.1:8792/` 登录与进入主界面通过
- 实时事件加载、事件点击、追踪、定位通过
- 地图 Z8、雷达层、NASA GIBS、高德瓦片加载通过
- 本机探针读到真实 WLAN 吞吐
- RIPE RIS Live BGP、CISA KEV、Cloudflare/GitHub Status、本机 TCP 实时链路通过
- 网络地图滚轮缩放、拖动、节点追踪、TRACK 持续追踪最新 BGP 通过
- 观测画面无信号状态与两路不同纹样通过
- 终端命令、文件读取、系统遥测、真实进程列表、键盘输入通过
- 终端内 `ops` / `recon` / `nmap` / `web` / `audit` / `vuln` / `searchsploit` / `msf` / `lab` / `sqlmap` / `payload` / `report` / `ipconfig` / `ver` / `tasklist` / `netstat` 指令通过
- `靶机限制/` 删除后面板仍能启动；`lab` 显示“内置靶机 已移除”，`sqlmap` 无参数时提示用法
- `sqlmap <url>` 直接打临时目标通过；无查询串时只提示不误跑；`SKYNET_REMOTE_TARGETS=local` 时非本机来源返回 403
- 终端 `cd` / `dir` / `type` / `cls` / `echo` / `pwd` 可用，提示符跟随当前目录
- `tools/sqlmap` 被识别为 sqlmap 来源，`lab` 显示 `via: tools/sqlmap`
- 配置写坏时回退内置靶机并在 `lab` 里显示具体错误行
- `sqlmap` 对靶机检出 SQLite 注入（banner 3.53.4），枚举出 `items` / `secrets` / `users` 三张表
- 探针离线时网络空间显示 `--`，威胁为空时显示“暂无情报命中”，不再生成合成流量 / 随机威胁
- `/api/lab/*` 端点：未登录 401、登录后返回真实 JSON；`searchsploit` 返回真实 NVD / KEV 条目
- 终端无 `SIM` 标记、无随机占位数字；服务不可用时显示错误而不是假数据
- 无 JavaScript 运行错误
- 三个模式与登录页统一为深蓝黑 + 青色/蓝色体系，无白底面板穿插

---

**天网 · 守护我们唯一的家园。**
