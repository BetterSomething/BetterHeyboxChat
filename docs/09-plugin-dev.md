# 插件开发指南

面向要写插件的人。API 细节见 [08-plugin-api.md](./08-plugin-api.md)，架构见 [04-architecture.md](./04-architecture.md)。

## 环境


| 项   | 值                                                      |
| --- | ------------------------------------------------------ |
| 客户端 | 黑盒语音 **1.56.0**                                        |
| 前端  | Vue **2.7 runtime-only** + Vuex + Webpack              |
| 注入点 | 渲染进程；不要改主进程 `.jsm`                                     |
| 调试  | 安装后 `F12` / `Ctrl+Shift+I`；右下角 **BH** 角标表示 runtime 已加载 |


改仓库根目录 `runtime/` 后，用 **Debug** 安装器重装即可（不必 `cargo build`）。Release 安装器内嵌 runtime，改完要重新 `cargo build --release`。

CLI：`pnpm build` 后 `pnpm bhchat install --yes`（需管理员；不会自动重启客户端）。

## 目录与清单

每个插件一份目录，并在 `runtime/plugins.json` 登记（loader 只读这份清单）：

```
runtime/plugins/my-plugin/
  manifest.json
  index.js
  style.css          # 可选
```

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "author": "你的名字",
  "repository": "https://github.com/you/my-plugin",
  "desc": "简要说明这个插件能做什么（最多 100 字）",
  "minClientVersion": "1.56.0",
  "enabled": true,
  "entry": "index.js"
}
```

`plugins.json` 里对应一项，字段保持一致。`id` 必须与目录名相同。`author`、`repository`、`desc` 会显示在设置页（仓库可点开）。`desc` 不超过 100 字，不要写 HTML。`enabled` 是默认值；用户可在设置里关掉，写入 `bhchat.plugins.enabled`，**重启后** loader 才跳过脚本。

用户插件不要放进 `runtime/plugins/`。用设置页「插件市场」从在线货架安装，或导入本地 zip/文件夹。文件写到数据目录（默认 `%APPDATA%\BetterHeyboxChat\plugins\<id>\`）。第三方插件源码在独立仓 [BetterHeyboxChat-plugins](https://github.com/BetterSomething/BetterHeyboxChat-plugins)，发 PR 投稿。

第三方插件发到独立仓，不要 PR 进框架仓：

```
BetterHeyboxChat-plugins/
  registry.json          # 货架，客户端只拉这一份
  your-plugin/
    manifest.json
    index.js
```

在 `registry.json` 的 `plugins` 数组加一行（id 与目录名相同），发 PR。客户端安装时再下载该目录的 `manifest.json`、`entry`、可选 `style` 与 `files`。

## 最小插件

```javascript
(function () {
  'use strict';

  function activate() {
    BHChat.injectCSS('.my-plugin-mark{outline:1px dashed #6ee7b7}');
    BHChat.registerPanel({
      id: 'my-plugin',
      title: '我的插件',
      component: {
        render: function (h) {
          return h('div', [
            h('div', { class: 'cell-title' }, '我的插件'),
            h('p', { class: 'text-tx-2 text-[13px]' }, '已加载 v' + BHChat.version),
          ]);
        },
      },
    });
  }

  BHChat.onReady(activate);
})();
```

要点：

1. IIFE + `'use strict'`，不要污染全局（除你文档化的 `BHChat.xxx`）
2. 在 `onReady` 里启动：此时 `BHChat` 已在，且马上会 `_ready`
3. 设置 UI 必须 `render(h)`，不能写 `template`
4. 控件要分样子：列表用 `row` + `bhchat-list`，开关用 `bhchat-switch`，按钮用 `bhchat-btn` / `bhchat-btn-primary`，输入用 `bhchat-native-input`，滑条用 `bhchat-native-range`。不要把按钮和开关做成 `row pointer-keyset` 文本行



## 订阅房间状态

不要自己 `setInterval` 扫 Vuex。用 `watch`，并先读一次当前值：

```javascript
function currentRoom() {
  return BHChat.mapState(['cur_room_data']).cur_room_data || null;
}

function onRoom(room) {
  console.log(room ? room.room_id : '不在房间');
}

function activate() {
  onRoom(currentRoom());
  BHChat.watch(function () {
    return currentRoom();
  }, onRoom);
}
```

`getVue()` / `getStore()` 在 `#app` 未挂载时可能为 `null`，`watch` 此时会退化为 500ms 轮询。

## 本地存储

```javascript
var store = BHChat.storage.ns('my-plugin');

await store.set('volume', 0.8);
var volume = await store.get('volume'); // 0.8
await store.del('volume');
```

不要用裸 key，以免和框架的 `bhchat.plugins.enabled`、`bhchat.custom_room_bg` 冲突。

## 启用 / 禁用 / 重启

用户在设置 → BetterHeyboxChat → 已安装插件里切换。当前进程**不会**卸载已运行的脚本。

- `BHChat.listPlugins()` 里 `enabled !== loaded` 表示需要重启
- 需要立刻生效时调用 `BHChat.restart()`（与设置页「立即重启客户端」相同）
- 插件自己不要在 `activate` 里再注册一份启停逻辑去热拆 DOM，除非你明确支持



## 打开设置

```javascript
BHChat.openSettings('betterheyboxchat');
```



## 调试检查单

1. 重装补丁后右下角有 **BH**
2. 设置侧栏有 BetterHeyboxChat（在「隐私设置」与「语音和屏幕共享」之间）
3. Console 无 `[BetterHeyboxChat] boot failed`
4. 你的 `registerPanel` 区块出现在插件开关和 DevTools 之间
5. 关掉插件 → 点立即重启 → 该区块消失、入口脚本不再执行



## 禁止事项

项目边界：

- 不要改 `ELECTRON_ENV`（`local` 会导致正式包拉调试前端，整窗灰屏）
- 不要 Proxy / 替换 `electron.BrowserWindow`
- 不要在 webpack 工厂未就绪时 `__webpack_require__` 官方模块
- 不要 hook TRTC / 火山 RTC 音频管线
- 不要伪造服务端协议、破解权限、改 Overlay DLL
- 不要把异常一路抛到未捕获（可能进官方 Sentry）；包在 `try/catch` 或让 `BHChat.on` 替你吞掉



## 参考实现

内置 `runtime/plugins/custom-room-bg/`：

- `BHChat.watch` 订阅 `cur_room_data`
- `registerPanel` 提供房间背景表单
- `BHChat.roomBg` 作为该插件的公开命令

内置 `runtime/plugins/channel-tts/`：

- 经 `__bhchat_module_map__.EVENT_BUS` 订阅 `SOCKET_SEND_MESSAGE` / `SOCKET_USER_IM_MESSAGE`（不要写死模块数字 ID）
- 只朗读当前正在看的频道的**新**消息（`channel_data` / `channelIMId` / 语音频道，含语音房文字），用 `window.speechSynthesis` 排队播放
- `registerPanel` 提供语速、音量、是否读昵称、测试朗读、立即停止

内置 `runtime/plugins/laughter-fav-fix/`：

- 频道内收藏/取消收藏他人语音包后，补发官方 `Refresh_User_Laughter`（与语音包平台收藏相同）
- 监听 Vuex `SET_FAVORITE_VOICE_PACK_IDS`；不写死模块数字 ID，不伪造收藏协议

内置 `runtime/plugins/screen-share-danmaku/`：

- 屏幕共享画面上以弹幕显示当前房间文字消息（同一套 `SOCKET_SEND_MESSAGE` / `SOCKET_USER_IM_MESSAGE`）
- 观众端只在官方 `screen_sharing_info.user_id`（正在观看）且 occupy 可见时挂弹幕；自己共享挂 `.cpt-screenshare-me-preview`；不挂到房间聊天主区。输入框挂官方 `.screen-share-operate`
- 画中画时把弹幕合成进 PiP（Electron 走 canvas 流）；发送走官方发信通道，不伪造协议、不碰 RTC

内置 `runtime/plugins/official-room-deco/`：

- 设置页探测官方全员房间背景写接口；忽略客户端 `can_change_bg_pic` / `room_decorate`
- 换图走官方 `uploadCustomFile({ source: 'room_deco_pic' })`，保存走 webpack `26737.DC` → `POST /chatroom/v2/room/decorate`（仅 1.56.0）
- 服务端仍可能拒绝；结果 JSON 打在设置页上

内置 `runtime/plugins/block-update/`：

- 设置页开关分别屏蔽完整更新（`electronAPI.updateClient`）和热更新（`updateAsarResource` / `setAsarVersion`）
- 开关写入 `betterheyboxchat/update-block.json`，由 main-bridge 在主进程拦截 IPC
- 可调用 `BHChat.patch.ensure()` 立刻补回被热更新盖掉的 html / preload 注入

复制 `custom-room-bg` 目录是最快的起步方式。

