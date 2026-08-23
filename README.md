# BetterHeyboxChat

[![CodeTime Badge](https://shields.jannchie.com/endpoint?style=flat-square&color=0284c7&url=https%3A%2F%2Fcodetime.dev%2Fv3%2Fusers%2Fshield%3Fuid%3D559%26project%3DBetterHeyboxChat)](https://codetime.dev)

黑盒语音 Windows 客户端增强插件平台

## 安装

写入 `Program Files` 需要管理员权限。  
若安装时黑盒语音已在运行, GUI 安装器会在安装/卸载后自动重启客户端

### GUI 一键傻瓜图形安装器

运行 `installer/target/release/bhchat-installer.exe`。

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
runtime/            运行时和插件
docs/               对外文档
```
