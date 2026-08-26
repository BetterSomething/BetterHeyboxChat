(function () {
  'use strict';

  var PLUGIN_ID = 'marketplace';
  var STORAGE_KEY = 'settings';
  var DEFAULT_MIRROR = '';

  function pluginsApi() {
    return (window.BHChat && window.BHChat.plugins) || {};
  }

  function sanitize(value, max) {
    var text = value == null ? '' : String(value);
    text = text.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    if (max && text.length > max) text = text.slice(0, max);
    return text;
  }

  function clientVersion() {
    return (window.asar_version || (window.BHChat && window.BHChat.clientVersion) || '1.56.0') + '';
  }

  function versionNewer(catalog, installed) {
    if (!catalog || !installed || catalog === installed) return false;
    var a = String(installed).split('.').map(function (n) {
      return parseInt(n, 10) || 0;
    });
    var b = String(catalog).split('.').map(function (n) {
      return parseInt(n, 10) || 0;
    });
    var len = Math.max(a.length, b.length);
    for (var i = 0; i < len; i++) {
      var x = a[i] || 0;
      var y = b[i] || 0;
      if (y > x) return true;
      if (y < x) return false;
    }
    return false;
  }

  function isZipFile(file) {
    return !!(file && /\.zip$/i.test(file.name || file.path || ''));
  }

  function readZipBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error('读取 zip 失败'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function inspectAndPending(file) {
    var api = pluginsApi();
    if (isZipFile(file) && file.path && api.inspectZipPath) {
      return Promise.resolve({
        preview: api.inspectZipPath(file.path),
        zipPath: file.path,
      });
    }
    if (isZipFile(file) && api.inspectZipBuffer) {
      return readZipBuffer(file).then(function (buf) {
        return {
          preview: api.inspectZipBuffer(buf),
          zipBuffer: buf,
        };
      });
    }
    if (file && file.path && api.inspectFolderPath) {
      return Promise.resolve({
        preview: api.inspectFolderPath(file.path),
        folderPath: file.path,
      });
    }
    return Promise.resolve({
      preview: { ok: false, error: '无法识别该文件，请选择 zip 或插件文件夹' },
    });
  }

  function installPending(pending, mirror) {
    var api = pluginsApi();
    if (pending.remoteId && api.installRemote) {
      return api.installRemote({
        id: pending.remoteId,
        mirror: mirror,
        clientVersion: clientVersion(),
      });
    }
    if (pending.zipPath && api.installZipPath) return api.installZipPath(pending.zipPath);
    if (pending.zipBuffer && api.installZipBuffer) return api.installZipBuffer(pending.zipBuffer);
    if (pending.folderPath && api.installFolderPath) return api.installFolderPath(pending.folderPath);
    return { ok: false, error: '安装数据不完整' };
  }

  function getNs() {
    if (window.BHChat && window.BHChat.storage && window.BHChat.storage.ns) {
      return window.BHChat.storage.ns(PLUGIN_ID);
    }
    return null;
  }

  function loadSettings() {
    var ns = getNs();
    if (!ns) return Promise.resolve({ mirror: DEFAULT_MIRROR });
    return ns.get(STORAGE_KEY).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      return { mirror: typeof saved.mirror === 'string' ? saved.mirror.trim() : '' };
    });
  }

  function saveSettings(settings) {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, { mirror: (settings.mirror || '').trim() });
  }

  function buildPanelComponent() {
    return {
      data: function () {
        return {
          dragging: false,
          status: '',
          error: '',
          pending: null,
          userPlugins: [],
          catalog: [],
          mirror: DEFAULT_MIRROR,
          loadingCatalog: false,
        };
      },
      created: function () {
        var self = this;
        this.refreshUserPlugins();
        loadSettings().then(function (settings) {
          self.mirror = settings.mirror || '';
          self.refreshCatalog();
        });
      },
      methods: {
        refreshUserPlugins: function () {
          var list = (window.BHChat && window.BHChat.listPlugins && window.BHChat.listPlugins()) || [];
          this.userPlugins = list.filter(function (item) {
            return item.source === 'user';
          });
        },
        installedMap: function () {
          var map = {};
          this.userPlugins.forEach(function (item) {
            map[item.id] = item;
          });
          return map;
        },
        refreshCatalog: function () {
          var self = this;
          var api = pluginsApi();
          if (!api.fetchRegistry) {
            this.error = '在线货架接口不可用，请用 Debug 安装器重装';
            return;
          }
          this.loadingCatalog = true;
          this.error = '';
          this.status = '正在拉取货架…';
          Promise.resolve(api.fetchRegistry(this.mirror))
            .then(function (result) {
              self.loadingCatalog = false;
              if (!result || !result.ok) {
                self.catalog = [];
                self.status = '';
                self.error = (result && result.error) || '拉取货架失败';
                return;
              }
              self.catalog = result.plugins || [];
              self.status = self.catalog.length ? '货架已更新' : '货架是空的';
              self.error = '';
            })
            .catch(function (err) {
              self.loadingCatalog = false;
              self.catalog = [];
              self.status = '';
              self.error = (err && err.message) || '拉取货架失败';
            });
        },
        onSaveMirror: function () {
          var self = this;
          this.mirror = sanitize(this.mirror, 300);
          saveSettings({ mirror: this.mirror }).then(function () {
            self.status = '已保存加速源';
            self.refreshCatalog();
          });
        },
        onPickZip: function () {
          if (this.$refs.zipInput) this.$refs.zipInput.click();
        },
        onPickFolder: function () {
          if (this.$refs.folderInput) this.$refs.folderInput.click();
        },
        onZipChange: function (e) {
          var file = e && e.target && e.target.files && e.target.files[0];
          if (e && e.target) e.target.value = '';
          if (file) this.beginInspect(file);
        },
        onFolderChange: function (e) {
          var files = e && e.target && e.target.files;
          if (e && e.target) e.target.value = '';
          if (files && files.length) this.beginInspect(files[0]);
        },
        onDrop: function (e) {
          this.dragging = false;
          if (e && e.preventDefault) e.preventDefault();
          var files = e && e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) this.beginInspect(files[0]);
        },
        onDragOver: function (e) {
          if (e && e.preventDefault) e.preventDefault();
          this.dragging = true;
        },
        onDragLeave: function () {
          this.dragging = false;
        },
        beginInspect: function (file) {
          var self = this;
          this.error = '';
          this.status = '正在读取插件信息…';
          inspectAndPending(file)
            .then(function (result) {
              var preview = result && result.preview;
              if (!preview || !preview.ok) {
                self.pending = null;
                self.status = '';
                self.error = (preview && preview.error) || '无法解析插件包';
                return;
              }
              self.pending = result;
              self.status = '';
              self.error = '';
            })
            .catch(function (err) {
              self.status = '';
              self.error = (err && err.message) || '读取失败';
            });
        },
        onInstallRemote: function (item) {
          var self = this;
          var api = pluginsApi();
          if (!api.inspectRemote) {
            this.error = '在线安装接口不可用';
            return;
          }
          this.error = '';
          this.status = '正在读取 ' + item.id + '…';
          Promise.resolve(
            api.inspectRemote({
              id: item.id,
              mirror: this.mirror,
              clientVersion: clientVersion(),
            }),
          )
            .then(function (preview) {
              if (!preview || !preview.ok) {
                self.pending = null;
                self.status = '';
                self.error = (preview && preview.error) || '无法下载插件';
                return;
              }
              self.pending = { preview: preview, remoteId: item.id };
              self.status = '';
              self.error = '';
            })
            .catch(function (err) {
              self.status = '';
              self.error = (err && err.message) || '下载失败';
            });
        },
        onCancelInstall: function () {
          this.pending = null;
        },
        onConfirmInstall: function () {
          var self = this;
          if (!this.pending) return;
          this.status = '正在安装…';
          Promise.resolve(installPending(this.pending, this.mirror)).then(function (result) {
            if (!result || !result.ok) {
              self.error = (result && result.error) || '安装失败';
              self.status = '';
              return;
            }
            self.pending = null;
            self.error = '';
            self.status = '已安装 ' + result.id + '，重启客户端后生效。';
            self.refreshUserPlugins();
          });
        },
        onUninstall: function (plugin) {
          var api = pluginsApi();
          var result = api.uninstall && api.uninstall(plugin.id);
          if (!result || !result.ok) {
            this.error = (result && result.error) || '卸载失败';
            return;
          }
          this.status = '已卸载 ' + plugin.id + '，重启客户端后生效。';
          this.error = '';
          this.refreshUserPlugins();
        },
        onRestart: function () {
          if (window.BHChat && window.BHChat.restart) window.BHChat.restart();
        },
        onMirrorInput: function (e) {
          this.mirror = e && e.target ? e.target.value : '';
        },
      },
      render: function (h) {
        var self = this;
        var preview = this.pending && this.pending.preview;
        var manifest = preview && preview.manifest;
        var installed = this.installedMap();
        var children = [
          h('div', { class: 'cell-title' }, '在线货架'),
          h(
            'p',
            { class: 'bhchat-hint' },
            '默认从 GitHub BetterHeyboxChat-plugins 拉 registry.json。加速源填完整 https 前缀，空则用官方 raw。',
          ),
          h('input', {
            class: 'bhchat-input',
            attrs: {
              type: 'text',
              placeholder: '加速源 URL 前缀（可选）',
              value: this.mirror,
            },
            on: { input: this.onMirrorInput },
          }),
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-secondary',
                attrs: { type: 'button', disabled: this.loadingCatalog ? 'disabled' : undefined },
                on: { click: this.onSaveMirror },
              },
              '保存加速源',
            ),
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-primary',
                attrs: { type: 'button', disabled: this.loadingCatalog ? 'disabled' : undefined },
                on: { click: this.refreshCatalog },
              },
              this.loadingCatalog ? '拉取中…' : '刷新货架',
            ),
          ]),
        ];
        var catalogRows = this.catalog.map(function (item) {
          var local = installed[item.id];
          var sub = sanitize(item.author, 40);
          if (item.version) sub = (sub ? sub + ' · ' : '') + 'v' + item.version;
          if (local) {
            sub += versionNewer(item.version, local.version) ? ' · 可更新' : ' · 已安装';
          }
          return h('div', { class: 'row' }, [
            h('div', { class: 'bhchat-row-text' }, [
              h('div', sanitize(item.name, 80)),
              h('div', { class: 'bhchat-row-sub' }, sanitize(sub, 100)),
              item.desc ? h('div', { class: 'bhchat-row-desc' }, sanitize(item.desc, 100)) : null,
            ]),
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-secondary',
                attrs: { type: 'button' },
                on: {
                  click: function (e) {
                    if (e && e.stopPropagation) e.stopPropagation();
                    self.onInstallRemote(item);
                  },
                },
              },
              local ? (versionNewer(item.version, local.version) ? '更新' : '重装') : '安装',
            ),
          ]);
        });
        children.push(
          h(
            'div',
            { class: 'bhchat-list' },
            catalogRows.length ? catalogRows : [h('p', { class: 'bhchat-hint' }, '还没有货架插件，点刷新或检查加速源。')],
          ),
        );
        children.push(h('div', { class: 'cell-title' }, '本地安装'));
        children.push(
          h(
            'p',
            { class: 'bhchat-hint' },
            '也可选择 zip、选择文件夹，或把 zip/文件夹拖进下面区域。',
          ),
        );
        children.push(
          h(
            'div',
            {
              class: { 'bhchat-dropzone': true, 'is-dragging': this.dragging },
              on: {
                dragover: this.onDragOver,
                dragleave: this.onDragLeave,
                drop: this.onDrop,
              },
            },
            '拖入 zip 或插件文件夹',
          ),
        );
        children.push(
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-secondary',
                attrs: { type: 'button' },
                on: { click: this.onPickZip },
              },
              '选择 zip',
            ),
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-secondary',
                attrs: { type: 'button' },
                on: { click: this.onPickFolder },
              },
              '选择文件夹',
            ),
          ]),
        );
        children.push(
          h('input', {
            ref: 'zipInput',
            class: 'bhchat-file-hidden',
            attrs: { type: 'file', accept: '.zip,application/zip' },
            on: { change: this.onZipChange },
          }),
        );
        children.push(
          h('input', {
            ref: 'folderInput',
            class: 'bhchat-file-hidden',
            attrs: {
              type: 'file',
              webkitdirectory: 'webkitdirectory',
              directory: 'directory',
              multiple: 'multiple',
            },
            on: { change: this.onFolderChange },
          }),
        );
        if (this.error) children.push(h('p', { class: 'bhchat-warn' }, this.error));
        if (this.status) children.push(h('p', { class: 'bhchat-hint' }, this.status));
        if (manifest) {
          children.push(
            h('div', { class: 'bhchat-confirm' }, [
              h('div', { class: 'cell-title' }, preview.upgrade ? '确认升级插件' : '确认安装插件'),
              h('div', { class: 'bhchat-confirm-row' }, [h('span', '名称'), h('span', sanitize(manifest.name, 80))]),
              h('div', { class: 'bhchat-confirm-row' }, [h('span', 'ID'), h('span', sanitize(manifest.id, 64))]),
              h('div', { class: 'bhchat-confirm-row' }, [h('span', '版本'), h('span', sanitize(manifest.version, 32))]),
              h('div', { class: 'bhchat-confirm-row' }, [
                h('span', '作者'),
                h('span', sanitize(manifest.author, 80) || '未知'),
              ]),
              h('div', { class: 'bhchat-confirm-desc' }, sanitize(manifest.desc, 100) || '（无描述）'),
              h('div', { class: 'bhchat-actions' }, [
                h(
                  'button',
                  {
                    class: 'bhchat-btn bhchat-btn-primary',
                    attrs: { type: 'button' },
                    on: { click: this.onConfirmInstall },
                  },
                  preview.upgrade ? '确认升级' : '确认安装',
                ),
                h(
                  'button',
                  {
                    class: 'bhchat-btn bhchat-btn-secondary',
                    attrs: { type: 'button' },
                    on: { click: this.onCancelInstall },
                  },
                  '取消',
                ),
              ]),
            ]),
          );
        }
        var userRows = this.userPlugins.map(function (plugin) {
          return h('div', { class: 'row' }, [
            h('div', { class: 'bhchat-row-text' }, [
              h('div', sanitize(plugin.name, 80)),
              h('div', { class: 'bhchat-row-sub' }, sanitize(plugin.id + ' · v' + plugin.version, 80)),
            ]),
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-danger',
                attrs: { type: 'button' },
                on: {
                  click: function (e) {
                    if (e && e.stopPropagation) e.stopPropagation();
                    self.onUninstall(plugin);
                  },
                },
              },
              '卸载',
            ),
          ]);
        });
        children.push(h('div', { class: 'cell-title' }, '用户插件'));
        children.push(
          h(
            'div',
            { class: 'bhchat-list' },
            userRows.length ? userRows : [h('p', { class: 'bhchat-hint' }, '还没有安装的用户插件。')],
          ),
        );
        children.push(
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-primary',
                attrs: { type: 'button' },
                on: { click: this.onRestart },
              },
              '立即重启客户端',
            ),
          ]),
        );
        return h('div', children);
      },
    };
  }

  function injectMarketplaceStyle() {
    if (!window.BHChat || !window.BHChat.injectCSS) return;
    window.BHChat.injectCSS(
      [
        '.betterheyboxchat-setting-block .bhchat-dropzone{margin:8px 0;padding:18px 12px;border:1px dashed var(--opacity-2,rgba(255,255,255,.18));border-radius:8px;text-align:center;color:var(--text-3,#8b8e93);font-size:13px}',
        '.betterheyboxchat-setting-block .bhchat-dropzone.is-dragging{border-color:var(--brand-text,#7dd95e);color:var(--text-1,#f2f3f5)}',
        '.betterheyboxchat-setting-block .bhchat-confirm{margin:10px 0;padding:10px 12px;border-radius:8px;background:var(--opacity-1,rgba(0,0,0,.2))}',
        '.betterheyboxchat-setting-block .bhchat-confirm-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:22px}',
        '.betterheyboxchat-setting-block .bhchat-confirm-desc{margin:8px 0;font-size:13px;line-height:20px;color:var(--text-2,#c7c8cc);white-space:pre-wrap;word-break:break-word}',
        '.betterheyboxchat-setting-block .bhchat-input{width:100%;margin:8px 0;padding:6px 8px;border:1px solid var(--opacity-2,rgba(255,255,255,.18));border-radius:6px;background:transparent;color:var(--text-1,#f2f3f5);box-sizing:border-box}',
      ].join(''),
    );
  }

  function activate() {
    injectMarketplaceStyle();
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '插件市场',
      component: buildPanelComponent(),
    });
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
