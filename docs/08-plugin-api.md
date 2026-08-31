# BHChat API 参考

> 全局对象：`window.BHChat`  
> 实现：`runtime/runtime.js`  
> 兼容客户端：Heybox Chat **1.56.0**  
> 写法示例见 [09-plugin-dev.md](./09-plugin-dev.md)

插件只应依赖本页列出的稳定面。`window.__bhchat_require__`、`window.__bhchat_module_map__` 是内部实现，会随版本失效。

## 元数据

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `BHChat.version` | `string` | 框架版本。正式版为 `0.1.0` 这种 semver，开发版为短 SHA（如 `c357f16`） |
| `BHChat.channel` | `'release' \| 'dev'` | 构建通道 |
| `BHChat.commit` | `string` | 构建时的 git 短 SHA |
| `BHChat.clientVersion` | `string` | `window.asar_version`，未知时为 `'unknown'` |
| `BHChat.indicator.isVisible()` | `boolean` | 右下角角标是否显示（正式版 `BHC v0.1.0`，开发版 `BHC c357f16`） |
| `BHChat.indicator.setVisible(on)` | `Promise<{visible}>` | 显示/隐藏角标，写入 `bhchat.indicator.visible` |

## 生命周期

### `onReady(cb)`

运行时加载完启用中的插件后调用 `cb`。若在 `_ready` 之后注册，**不会**补触发——插件应在脚本顶层 `BHChat.onReady(activate)`（loader 先执行插件再 `_ready`）。

也可监听 `BHChat.on('ready', cb)`。

### `onClientUpdate(cb)`

启动时（以及手动 `BHChat.patch.ensure()` 后）收到补丁完整性结果。晚注册会补发上次结果。也可听 `BHChat.on('client-update', cb)`。

```js
BHChat.onClientUpdate(function (info) {
  // info.repaired / intact / missing: 相对 app 根的路径
  // info.envFixed: 是否把 ELECTRON_ENV 从 local 改回 prod
});
```

热更新常只覆盖 `webapp/index.html`。真正的补回发生在 **main-bridge** 创建窗口之前，不依赖这个回调。

### `BHChat.patch.getStatus()` / `BHChat.patch.ensure()`

读/再跑一次完整性检查。`ensure` 会补回缺失的 html / preload / index.js 标记，并把 `env.js` 的 `local` 改回 `prod`。

## Vue / Vuex

官方前端是 **Vue 2.7 runtime-only**（没有 `compileToFunctions`）。任何挂到设置页的组件必须提供 `render(h)`，不能写 `template` 字符串。

### `getVue(): Function | null`

`#app.__vue__` 的构造函数（优先 `$root.constructor`）。根实例未挂载时返回 `null`。

### `getStore(): VuexStore | null`

`#app.__vue__.$store`。

### `mapState(keys?: string[]): object`

按顺序读 `store.getters[key]`，没有则读 `store.state[key]`。

- `mapState(['cur_room_data'])` → `{ cur_room_data }`
- `mapState()` → 已知键的快照：`cur_room_data`、`room_list`、`all_notify_settings`、`cur_roles_list`、`show_friend_sidebar`

store 未就绪时返回 `{}`。

### `watch(getter, callback): () => void`

- 有 Vuex 时调用 `store.watch(getter, callback)`（**不会**立刻回调，请自己先读一次当前值）
- 否则每 500ms 用 `!==` 比较 `getter()` 的返回值

返回取消函数。`getter` 应返回可比较的引用（房间切换通常会换掉 `cur_room_data` 对象）。

```javascript
var stop = BHChat.watch(function () {
  return BHChat.mapState(['cur_room_data']).cur_room_data;
}, function (room) {
  console.log('room changed', room && room.room_id);
});
// 之后
stop();
```

## 事件

```javascript
BHChat.on(event, handler)
BHChat.off(event, handler)
BHChat.emit(event, ...args)
```

handler 抛错会被捕获并打日志，不中断其他监听者。

| 事件 | 载荷 | 何时 |
| --- | --- | --- |
| `ready` | 无 | 全部启用插件加载完 |
| `client-update` | patch 状态对象 | 启动检查或手动 `patch.ensure` 之后 |
| `panel-registered` | `panelId` | `registerPanel` 成功 |
| `plugin-enabled-changed` | `{ id, enabled }` | `setPluginEnabled` 写入后（脚本仍按旧状态运行） |

## UI

### `injectCSS(css): HTMLStyleElement`

向 `document.head` 插入 `<style data-bhchat="injected">`。

### `injectStyleUrl(url): HTMLLinkElement`

插入 `<link rel="stylesheet">`。插件样式建议用相对路径：

`../betterheyboxchat/plugins/<id>/style.css`

### `registerPanel({ id, title, component }): boolean`

把插件设置页挂到设置 → BetterHeyboxChat → 已安装插件。列表里只有 `id` **等于插件 id** 的项会显示「设置」按钮；点开后钻取到该 `component`，点「返回」回到列表。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 必须与插件 `id` 相同，否则列表不出现「设置」。重复注册会覆盖 |
| `title` | 否 | 显示名，缺省为 `id`（钻取页仍由 `component` 自己画标题） |
| `component` | 是 | Vue 2 选项对象，**必须**有 `render(h)` |

失败（缺字段或没有 `render`）返回 `false` 并 `console.warn`。未加载的插件不会执行 `registerPanel`，因此也没有设置按钮。

### `listPanels(): Array<{ id, title, component }>`

已注册区块的浅拷贝。

### `openSettings(blockKey?)`

打开官方设置弹窗并切到指定侧栏。默认 `'betterheyboxchat'`。成功返回 `true`。

## 插件管理

内置清单来自 `plugins.json`（目前只有市场），用户插件来自 `{dataRoot}/plugins/` 扫描。即使用户禁用，loader 仍会 `_registerPlugin` 以便设置页列出。

### `listPlugins()` / `getPlugin(id)`

```javascript
{
  id, name, version, author, repository, desc, entry, minClientVersion,
  source,   // 'bundled' | 'user'
  enabled,  // 用户覆盖 ∪ manifest 默认
  loaded    // 本次进程是否已执行入口脚本
}
```

`desc` 为不超过 100 字的纯文本简介。`source === 'user'` 表示安装在用户数据目录。`enabled !== loaded` 表示需要重启。

### `isPluginEnabled(id): boolean`

1. 若 `bhchat.plugins.enabled` 里有该 id，用用户值  
2. 否则 `manifest.enabled !== false`

### `setPluginEnabled(id, enabled): Promise<{ id, enabled, restartRequired: true }>`

只写存储，**不**热加载 / 热卸载。设置页提示「重启后生效」。

### `restart()`

调用 `electronAPI.restartApp()`。不可用时 reject。

### `BHChat.plugins`

用户插件装载（preload 实现）。安装/卸载后需重启才加载脚本。

| 方法 | 说明 |
| --- | --- |
| `dataRoot()` | 当前用户数据根目录 |
| `inspectZipPath(path)` / `inspectZipBuffer(buf)` / `inspectFolderPath(path)` | 解析包并返回洗白后的 manifest，不写盘 |
| `installZipPath` / `installZipBuffer` / `installFolderPath` | 写入 `{dataRoot}/plugins/<id>/` |
| `uninstall(id)` | 仅允许用户插件 |
| `fetchRegistry(mirrorOrOpts?)` | 拉货架 `registry.json`（Promise）。可传字符串加速源，或 `{ mirror, localDebug, localRoot }` |
| `resolveLocalRoot(path)` | 把绝对路径上溯到含 `registry.json` 的仓根；相对路径拒绝 |
| `inspectRemote({ id, mirror, clientVersion, localRoot })` | 按需取插件目录，不写盘 |
| `installRemote({ id, mirror, clientVersion, localRoot })` | 确认后写入用户插件目录 |

默认货架：`https://raw.githubusercontent.com/BetterSomething/BetterHeyboxChat-plugins/main/`。`mirror` 为可替换的 https 前缀。`localDebug` 为真或 `localRoot` 非空时改为读本地目录，失败不回落 GitHub。不在页面里执行远程脚本。

inspect 结果供设置页确认框使用。`desc`/`name`/`author` 已去除 HTML 与控制字符。`repository` 只保留 http(s)。

## 存储

`BHChat.storage` 封装 `runtime/lib/storage.js`：优先 `electronAPI.getData/setData/delData`，否则 `localStorage`。值会 `JSON.stringify`。

| 方法 | 说明 |
| --- | --- |
| `storage.get(key)` | `Promise<any \| null>` |
| `storage.set(key, value)` | `Promise<void>` |
| `storage.del(key)` | `Promise<void>` |
| `storage.ns(pluginId)` | `{ get, set, del }`，key 自动加 `bhchat.plugin.{id}.` |

框架占用的 key：`bhchat.plugins.enabled`、`bhchat.devtools.enabled`、`bhchat.custom_room_bg`。插件请用 `storage.ns(自己的 id)`。

## 官方 API 封装

| 属性 | 指向 |
| --- | --- |
| `BHChat.electron` | `window.electronAPI` |
| `BHChat.overlay` | `window.overlayAPI` |
| `BHChat.steam` | `window.steamAPI` |
| `BHChat.laughter` | `window.laughterAPI` |

具体方法以运行时 `window.electronAPI` 为准。不要调用 `nodeRequire` 加载 `.node`。

## DevTools

| 方法 | 说明 |
| --- | --- |
| `devtools.isEnabled()` | `Promise<boolean>` |
| `devtools.getStatus()` | `Promise<string>` |
| `devtools.setEnabled(bool)` | 写标记文件；快捷键即时，完全生效可能需重启 |
| `devtools.open()` | 请求主进程打开 DevTools |

主进程 hook 见 `main-bridge.js`。`ELECTRON_ENV` 必须保持 `prod`。

## 官方货架插件附加 API

以下 API 仅在用户从插件市场安装并启用对应插件后存在。框架本身不再内置这些插件。

`custom-room-bg` 启用后挂载：

```javascript
BHChat.roomBg.get(roomId?)
BHChat.roomBg.set(url, { opacity, blur })
BHChat.roomBg.clear(roomId?)
BHChat.roomBg.getAll()
BHChat.roomBg.openPanel()
BHChat.openRoomBgPanel()
```

`laughter-fav-fix` 启用后挂载：

```javascript
BHChat.laughterFav.refresh()
BHChat.laughterFav.getStatus()
BHChat.laughterFav.getSettings()
```

`screen-share-danmaku` 启用后挂载：

```javascript
BHChat.screenShareDanmaku.send(text)
BHChat.screenShareDanmaku.getStatus()
BHChat.screenShareDanmaku.getSettings()
```

`block-update` 启用后挂载：

```javascript
BHChat.blockUpdate.getSettings()
BHChat.blockUpdate.getStatus()
BHChat.blockUpdate.ensurePatch()
```

`official-room-deco` 启用后挂载（仅 1.56.0；走官方 `uploadCustomFile` + `POST /chatroom/v2/room/decorate`，忽略客户端 `can_change_bg_pic`）：

```javascript
BHChat.officialRoomDeco.snapshot()
BHChat.officialRoomDeco.upload(file)
BHChat.officialRoomDeco.decorate(patch?)
BHChat.officialRoomDeco.applying()
```

`export-credentials` 启用后挂载（从当前登录态收集官方 API query / Cookie，**不要**把结果写入仓库）：

```javascript
BHChat.exportCredentials.snapshot()
```

`heybox-dev-mcp` 启用后挂载（本机 `127.0.0.1` HTTP 桥，给 Cursor MCP 用；**不要**把握手 token / pkey 写入仓库）：

```javascript
BHChat.heyboxDevMcp.getStatus()
BHChat.heyboxDevMcp.start()
BHChat.heyboxDevMcp.stop()
```

第三方插件不要依赖这些名字，除非你明确依赖该插件。

## 错误与边界

- 事件 handler、`onReady` 回调内的异常只打日志
- `watch` / `mapState` 在 store 未就绪时降级，不要假设启动瞬间一定有房间数据
- 设置组件必须 `render(h)`；`template` 会渲染成空白
- 模块 ID 仅 1.56.0 有效，且不应出现在插件代码里
