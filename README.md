# BetterHeyboxChat

---

[假装这里有个 LOGO, LOGO 位招猪]  

[黑盒语音](https://chat.xiaoheihe.cn/) Windows 客户端增强插件框架

## 安装

(若黑盒语音安装在 `Program Files` , 则安装器需要管理员权限)  
若安装时黑盒语音已在运行, GUI 安装器会在安装/卸载后自动重启客户端

### GUI 一键傻瓜图形安装器

#### 普通用户

去仓库的 [Releases](https://github.com/BetterSomething/BetterHeyboxChat/releases/) 下载 `bhchat-installer-0.x.0.exe` 并运行。  
开发快照在固定的 [dev Pre-release](https://github.com/BetterSomething/BetterHeyboxChat/releases/tag/dev)，文件名是 `bhchat-installer-<短SHA>.exe`。

#### 开发者

1. `cargo build`
2. 运行 `installer/target/debug/bhchat-installer.exe`

Debug 构建直接读仓库里的 `runtime/`，改插件不用重新编译安装器

### CLI 命令行

```bash
pnpm install
pnpm build

pnpm bhchat detect
pnpm bhchat status
pnpm bhchat install --yes
pnpm bhchat uninstall --yes
```

路径不是默认的就加上：

```bash
pnpm bhchat install --path "D:\Program Files\Qingfeng\HeyboxChat" --yes
```

### 发版

- 正式版：`git tag v0.2.0 && git push origin v0.2.0`，或在 Actions 里手动跑 **Release installer** 并填 `0.2.0`。Release 说明会列出上一正式版以来的 Conventional Commits。
- 开发版：推到 `main` 后自动覆盖 [dev Pre-release](https://github.com/BetterSomething/BetterHeyboxChat/releases/tag/dev)。



## 写插件

源文件在 `runtime/`  
`pnpm build` 会复制一份到 `packages/loader/runtime/`

- [怎么写](docs/09-plugin-dev.md)
- [API](docs/08-plugin-api.md)
- [架构](docs/04-architecture.md)



## 目录

```
installer/          Rust 安装器
packages/loader/    命令行补丁器
runtime/            插件注入的运行时
docs/               对外文档
```

## 鸣谢

各大 LLM
