# BetterHeyboxChat

---

[假装这里有个 LOGO, LOGO 位招猪]  

[黑盒语音](https://chat.xiaoheihe.cn/) Windows 客户端增强插件框架

## 安装

(若黑盒语音安装在 `Program Files` , 则安装器需要管理员权限)  
若安装时黑盒语音已在运行, GUI 安装器会在安装/卸载后自动重启客户端

### GUI 一键傻瓜图形安装器

#### 普通用户

去仓库的 [Releases](https://github.com/BetterSomething/BetterHeyboxChat/releases/) 里面下载`bhchat-installer.exe`并运行

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
