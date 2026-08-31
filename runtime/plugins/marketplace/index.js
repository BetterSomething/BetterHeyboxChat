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

  function filePathOf(file) {
    if (!file) return '';
    if (file.path) return String(file.path);
    var api = pluginsApi();
    if (!api.getPathForFile) return '';
    try {
      var resolved = api.getPathForFile(file);
      return typeof resolved === 'string' ? resolved : '';
    } catch (err) {
      return '';
    }
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
    var osPath = filePathOf(file);
    if (isZipFile(file) && osPath && api.inspectZipPath) {
      return Promise.resolve({
        preview: api.inspectZipPath(osPath),
        zipPath: osPath,
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
    if (osPath && api.inspectFolderPath) {
      return Promise.resolve({
        preview: api.inspectFolderPath(osPath),
        folderPath: osPath,
      });
    }
    return Promise.resolve({
      preview: { ok: false, error: '无法识别该文件，请选择 zip 或插件文件夹' },
    });
  }

  function installPending(pending, opts) {
    var api = pluginsApi();
    opts = opts || {};
    if (pending.remoteId && api.installRemote) {
      return api.installRemote({
        id: pending.remoteId,
        mirror: opts.mirror,
        clientVersion: clientVersion(),
        localDebug: !!opts.localDebug,
        localRoot: opts.localRoot || '',
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
    if (!ns) return Promise.resolve({ mirror: DEFAULT_MIRROR, localDebug: false, localRoot: '' });
    return ns.get(STORAGE_KEY).then(function (saved) {
      saved = saved && typeof saved === 'object' ? saved : {};
      return {
        mirror: typeof saved.mirror === 'string' ? saved.mirror.trim() : '',
        localDebug: !!saved.localDebug,
        localRoot: typeof saved.localRoot === 'string' ? saved.localRoot.trim() : '',
      };
    });
  }

  function saveSettings(settings) {
    var ns = getNs();
    if (!ns) return Promise.resolve();
    return ns.set(STORAGE_KEY, {
      mirror: (settings.mirror || '').trim(),
      localDebug: !!settings.localDebug,
      localRoot: (settings.localRoot || '').trim(),
    });
  }

  function cloneMap(src) {
    var next = {};
    Object.keys(src || {}).forEach(function (key) {
      next[key] = src[key];
    });
    return next;
  }

  function hCheck(h, on) {
    return h('span', { class: { 'bhchat-check': true, on: !!on } });
  }

  function buildPanelComponent() {
    return {
      data: function () {
        return {
          status: '',
          error: '',
          dialog: null,
          busy: false,
          catalogSelected: {},
          userSelected: {},
          userPlugins: [],
          catalog: [],
          mirror: DEFAULT_MIRROR,
          localDebug: false,
          localRoot: '',
          loadingCatalog: false,
        };
      },
      created: function () {
        var self = this;
        this.refreshUserPlugins();
        loadSettings().then(function (settings) {
          self.mirror = settings.mirror || '';
          self.localDebug = !!settings.localDebug;
          self.localRoot = settings.localRoot || '';
          self.refreshCatalog();
        });
      },
      mounted: function () {
        var self = this;
        this._onDialogKey = function (e) {
          if (e && e.key === 'Escape') self.onCancelDialog();
        };
        document.addEventListener('keydown', this._onDialogKey);
      },
      beforeDestroy: function () {
        if (this._onDialogKey) document.removeEventListener('keydown', this._onDialogKey);
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
        catalogLocalRoot: function () {
          return this.localDebug ? String(this.localRoot || '').trim() : '';
        },
        persistSettings: function (status) {
          var self = this;
          return saveSettings({
            mirror: this.mirror,
            localDebug: this.localDebug,
            localRoot: this.localRoot,
          }).then(function () {
            self.status = status || '';
            self.refreshCatalog();
          });
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
          this.status = this.catalogLocalRoot() ? '正在读取本地货架…' : '正在拉取货架…';
          Promise.resolve(
            api.fetchRegistry({
              mirror: this.mirror,
              localDebug: this.localDebug,
              localRoot: this.catalogLocalRoot(),
            }),
          )
            .then(function (result) {
              self.loadingCatalog = false;
              if (!result || !result.ok) {
                self.catalog = [];
                self.status = '';
                self.error = (result && result.error) || '拉取货架失败';
                return;
              }
              self.catalog = result.plugins || [];
              self.status = self.catalog.length
                ? self.localDebug
                  ? '本地货架已更新'
                  : '货架已更新'
                : '货架是空的';
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
          this.mirror = sanitize(this.mirror, 300);
          this.persistSettings('已保存加速源');
        },
        onToggleLocalDebug: function () {
          this.localDebug = !this.localDebug;
          this.persistSettings(this.localDebug ? '已开启本地调试' : '已关闭本地调试');
        },
        onLocalRootInput: function (e) {
          this.localRoot = e && e.target ? e.target.value : '';
        },
        onPickLocalRoot: function () {
          if (this.$refs.localRootInput) this.$refs.localRootInput.click();
        },
        onSaveLocalRoot: function () {
          this.localRoot = sanitize(this.localRoot, 500);
          this.persistSettings('已保存本地仓路径');
        },
        onLocalRootFolderChange: function (e) {
          var files = e && e.target && e.target.files;
          if (e && e.target) e.target.value = '';
          if (!files || !files.length) return;
          var api = pluginsApi();
          var resolved = api.resolveLocalRoot && api.resolveLocalRoot(filePathOf(files[0]));
          if (!resolved || !resolved.ok) {
            this.error = (resolved && resolved.error) || '无法解析本地插件仓路径';
            this.status = '';
            return;
          }
          this.localRoot = resolved.root;
          this.error = '';
          this.persistSettings('已保存本地仓路径');
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
        selectedCatalogIds: function () {
          var selected = this.catalogSelected || {};
          return this.catalog
            .map(function (item) {
              return item.id;
            })
            .filter(function (id) {
              return !!selected[id];
            });
        },
        selectedUserPlugins: function () {
          var selected = this.userSelected || {};
          return this.userPlugins.filter(function (plugin) {
            return !!selected[plugin.id];
          });
        },
        toggleSelected: function (mapName, id) {
          var next = cloneMap(this[mapName]);
          if (next[id]) delete next[id];
          else next[id] = true;
          this[mapName] = next;
        },
        onToggleCatalog: function (id) {
          this.toggleSelected('catalogSelected', id);
        },
        onToggleUser: function (id) {
          this.toggleSelected('userSelected', id);
        },
        onSelectAllCatalog: function () {
          var ids = this.catalog.map(function (item) {
            return item.id;
          });
          var allOn = ids.length > 0 && this.selectedCatalogIds().length === ids.length;
          var next = {};
          if (!allOn) {
            ids.forEach(function (id) {
              next[id] = true;
            });
          }
          this.catalogSelected = next;
        },
        onSelectAllUser: function () {
          var ids = this.userPlugins.map(function (plugin) {
            return plugin.id;
          });
          var allOn = ids.length > 0 && this.selectedUserPlugins().length === ids.length;
          var next = {};
          if (!allOn) {
            ids.forEach(function (id) {
              next[id] = true;
            });
          }
          this.userSelected = next;
        },
        openInstallDialog: function (items) {
          this.dialog = { mode: 'install', items: items || [] };
        },
        inspectRemoteItem: function (id) {
          var api = pluginsApi();
          return Promise.resolve(
            api.inspectRemote({
              id: id,
              mirror: this.mirror,
              clientVersion: clientVersion(),
              localDebug: this.localDebug,
              localRoot: this.catalogLocalRoot(),
            }),
          ).then(function (preview) {
            if (!preview || !preview.ok) {
              return { ok: false, id: id, error: (preview && preview.error) || '无法下载插件' };
            }
            return {
              ok: true,
              pending: { preview: preview, remoteId: id },
              preview: preview,
            };
          });
        },
        beginInspect: function (file) {
          var self = this;
          this.error = '';
          this.status = '正在读取插件信息…';
          inspectAndPending(file)
            .then(function (result) {
              var preview = result && result.preview;
              if (!preview || !preview.ok) {
                self.status = '';
                self.error = (preview && preview.error) || '无法解析插件包';
                return;
              }
              self.status = '';
              self.error = '';
              self.openInstallDialog([{ pending: result, preview: preview }]);
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
          this.inspectRemoteItem(item.id)
            .then(function (result) {
              self.status = '';
              if (!result.ok) {
                self.error = result.error || '无法下载插件';
                return;
              }
              self.error = '';
              self.openInstallDialog([result]);
            })
            .catch(function (err) {
              self.status = '';
              self.error = (err && err.message) || '下载失败';
            });
        },
        onBatchInstall: function () {
          var self = this;
          var ids = this.selectedCatalogIds();
          if (!ids.length) {
            this.error = '请先勾选要安装的插件';
            this.status = '';
            return;
          }
          var api = pluginsApi();
          if (!api.inspectRemote) {
            this.error = '在线安装接口不可用';
            return;
          }
          this.error = '';
          this.busy = true;
          this.status = '正在读取已选插件…';
          var items = [];
          var errors = [];
          var chain = Promise.resolve();
          ids.forEach(function (id) {
            chain = chain.then(function () {
              return self.inspectRemoteItem(id).then(function (result) {
                if (result.ok) items.push(result);
                else errors.push(id + '：' + (result.error || '失败'));
              });
            });
          });
          chain
            .then(function () {
              self.busy = false;
              self.status = '';
              if (!items.length) {
                self.error = errors.join('；') || '无法下载插件';
                return;
              }
              self.error = errors.length ? errors.join('；') : '';
              self.openInstallDialog(items);
            })
            .catch(function (err) {
              self.busy = false;
              self.status = '';
              self.error = (err && err.message) || '下载失败';
            });
        },
        onCancelDialog: function () {
          if (this.busy) return;
          this.dialog = null;
        },
        onConfirmInstall: function () {
          var self = this;
          var dialog = this.dialog;
          if (!dialog || dialog.mode !== 'install' || this.busy) return;
          var items = dialog.items || [];
          this.busy = true;
          this.error = '';
          var okIds = [];
          var errors = [];
          var chain = Promise.resolve();
          items.forEach(function (item, index) {
            chain = chain.then(function () {
              self.status = '正在安装 ' + (index + 1) + '/' + items.length + '…';
              return Promise.resolve(
                installPending(item.pending, {
                  mirror: self.mirror,
                  localDebug: self.localDebug,
                  localRoot: self.catalogLocalRoot(),
                }),
              ).then(function (result) {
                if (!result || !result.ok) {
                  errors.push((item.preview && item.preview.manifest && item.preview.manifest.id) || '插件');
                  return;
                }
                okIds.push(result.id);
              });
            });
          });
          chain.then(function () {
            self.busy = false;
            self.refreshUserPlugins();
            if (!okIds.length) {
              self.error = errors.length ? '安装失败：' + errors.join('、') : '安装失败';
              self.status = '';
              return;
            }
            self.dialog = null;
            self.catalogSelected = {};
            self.status =
              '已安装 ' + okIds.join('、') + '，重启客户端后生效。' + (errors.length ? ' 失败：' + errors.join('、') : '');
            self.error = errors.length ? '部分插件安装失败：' + errors.join('、') : '';
          });
        },
        onConfirmUninstall: function () {
          var dialog = this.dialog;
          if (!dialog || dialog.mode !== 'uninstall' || this.busy) return;
          var api = pluginsApi();
          var items = dialog.items || [];
          var okIds = [];
          var errors = [];
          items.forEach(function (item) {
            var plugin = item.plugin;
            if (!plugin) return;
            var result = api.uninstall && api.uninstall(plugin.id);
            if (!result || !result.ok) {
              errors.push(plugin.id);
              return;
            }
            okIds.push(plugin.id);
          });
          this.refreshUserPlugins();
          if (!okIds.length) {
            this.error = (errors.length ? '删除失败：' + errors.join('、') : '') || '卸载失败';
            this.status = '';
            return;
          }
          this.dialog = null;
          this.userSelected = {};
          this.status =
            '已删除 ' + okIds.join('、') + '，重启客户端后生效。' + (errors.length ? ' 失败：' + errors.join('、') : '');
          this.error = errors.length ? '部分插件删除失败：' + errors.join('、') : '';
        },
        onUninstall: function (plugin) {
          this.dialog = { mode: 'uninstall', items: [{ plugin: plugin }] };
        },
        onBatchDelete: function () {
          var list = this.selectedUserPlugins();
          if (!list.length) {
            this.error = '请先勾选要删除的插件';
            this.status = '';
            return;
          }
          this.error = '';
          this.dialog = {
            mode: 'uninstall',
            items: list.map(function (plugin) {
              return { plugin: plugin };
            }),
          };
        },
        onRestart: function () {
          this.dialog = { mode: 'restart' };
        },
        onConfirmRestart: function () {
          if (!this.dialog || this.dialog.mode !== 'restart') return;
          this.dialog = null;
          if (window.BHChat && window.BHChat.restart) window.BHChat.restart();
        },
        onMirrorInput: function (e) {
          this.mirror = e && e.target ? e.target.value : '';
        },
        onDialogMaskClick: function (e) {
          if (e && e.target === e.currentTarget) this.onCancelDialog();
        },
        stopBubble: function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
        },
      },
      render: function (h) {
        var self = this;
        var installed = this.installedMap();
        var catalogIds = this.selectedCatalogIds();
        var userSelected = this.selectedUserPlugins();
        var children = [
          h('div', { class: 'cell-title' }, '在线货架'),
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
          h('div', { class: 'cell-title' }, '本地调试'),
          h(
            'div',
            {
              class: 'row bhchat-row-click',
              on: { click: this.onToggleLocalDebug },
            },
            [
              h('span', '从本地仓读取货架'),
              h('span', { class: { 'bhchat-switch': true, on: !!this.localDebug } }, [
                h('span', { class: 'bhchat-switch-core' }),
              ]),
            ],
          ),
          h('input', {
            class: 'bhchat-input',
            attrs: {
              type: 'text',
              placeholder: '本地插件仓绝对路径',
              value: this.localRoot,
            },
            on: { input: this.onLocalRootInput },
          }),
          h('div', { class: 'bhchat-actions' }, [
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-secondary',
                attrs: { type: 'button' },
                on: { click: this.onPickLocalRoot },
              },
              '选择目录',
            ),
            h(
              'button',
              {
                class: 'bhchat-btn bhchat-btn-secondary',
                attrs: { type: 'button', disabled: this.loadingCatalog ? 'disabled' : undefined },
                on: { click: this.onSaveLocalRoot },
              },
              '保存本地路径',
            ),
          ]),
          h('input', {
            ref: 'localRootInput',
            class: 'bhchat-file-hidden',
            attrs: {
              type: 'file',
              webkitdirectory: 'webkitdirectory',
              directory: 'directory',
              multiple: 'multiple',
            },
            on: { change: this.onLocalRootFolderChange },
          }),
        ];
        if (this.catalog.length) {
          children.push(
            h('div', { class: 'bhchat-actions' }, [
              h(
                'button',
                {
                  class: 'bhchat-btn bhchat-btn-secondary',
                  attrs: { type: 'button', disabled: this.busy ? 'disabled' : undefined },
                  on: { click: this.onSelectAllCatalog },
                },
                catalogIds.length === this.catalog.length ? '取消全选' : '全选',
              ),
              h(
                'button',
                {
                  class: 'bhchat-btn bhchat-btn-primary',
                  attrs: {
                    type: 'button',
                    disabled: this.busy || !catalogIds.length ? 'disabled' : undefined,
                  },
                  on: { click: this.onBatchInstall },
                },
                catalogIds.length ? '批量安装（' + catalogIds.length + '）' : '批量安装',
              ),
            ]),
          );
        }
        var catalogRows = this.catalog.map(function (item) {
          var local = installed[item.id];
          var checked = !!self.catalogSelected[item.id];
          var sub = sanitize(item.author, 40);
          if (item.version) sub = (sub ? sub + ' · ' : '') + 'v' + item.version;
          if (local) {
            sub += versionNewer(item.version, local.version) ? ' · 可更新' : ' · 已安装';
          }
          return h(
            'div',
            {
              class: 'row bhchat-row-click',
              on: {
                click: function () {
                  self.onToggleCatalog(item.id);
                },
              },
            },
            [
              hCheck(h, checked),
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
                      self.stopBubble(e);
                      self.onInstallRemote(item);
                    },
                  },
                },
                local ? (versionNewer(item.version, local.version) ? '更新' : '重装') : '安装',
              ),
            ],
          );
        });
        children.push(h('div', { class: 'bhchat-list' }, catalogRows));
        children.push(h('div', { class: 'cell-title' }, '本地安装'));
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
        children.push(h('div', { class: 'cell-title' }, '用户插件'));
        if (this.userPlugins.length) {
          children.push(
            h('div', { class: 'bhchat-actions' }, [
              h(
                'button',
                {
                  class: 'bhchat-btn bhchat-btn-secondary',
                  attrs: { type: 'button' },
                  on: { click: this.onSelectAllUser },
                },
                userSelected.length === this.userPlugins.length ? '取消全选' : '全选',
              ),
              h(
                'button',
                {
                  class: 'bhchat-btn bhchat-btn-danger',
                  attrs: { type: 'button', disabled: !userSelected.length ? 'disabled' : undefined },
                  on: { click: this.onBatchDelete },
                },
                userSelected.length ? '批量删除（' + userSelected.length + '）' : '批量删除',
              ),
            ]),
          );
        }
        var userRows = this.userPlugins.map(function (plugin) {
          var checked = !!self.userSelected[plugin.id];
          return h(
            'div',
            {
              class: 'row bhchat-row-click',
              on: {
                click: function () {
                  self.onToggleUser(plugin.id);
                },
              },
            },
            [
              hCheck(h, checked),
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
                      self.stopBubble(e);
                      self.onUninstall(plugin);
                    },
                  },
                },
                '卸载',
              ),
            ],
          );
        });
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
                class: 'bhchat-btn bhchat-btn-danger',
                attrs: { type: 'button' },
                on: { click: this.onRestart },
              },
              '立即重启客户端',
            ),
          ]),
        );
        var dialogNode = this.renderDialog(h);
        if (dialogNode) children.push(dialogNode);
        return h('div', children);
      },
    };
  }

  function attachDialogRender(component) {
    component.methods.renderDialog = function (h) {
      var self = this;
      var dialog = this.dialog;
      if (!dialog) return null;
      if (dialog.mode === 'restart') {
        return h(
          'div',
          { class: 'bhchat-dialog-mask', on: { click: this.onDialogMaskClick } },
          [
            h(
              'div',
              { class: 'bhchat-dialog', on: { click: this.stopBubble } },
              [
                h('div', { class: 'bhchat-dialog-title' }, '确认重启客户端'),
                h('div', { class: 'bhchat-dialog-body' }, [
                  h(
                    'div',
                    { class: 'bhchat-dialog-desc' },
                    '将立即重启黑盒语音。正在进行的通话或未保存的内容会中断。',
                  ),
                ]),
                h('div', { class: 'bhchat-dialog-actions' }, [
                  h(
                    'button',
                    {
                      class: { 'bhchat-btn': true, 'bhchat-btn-danger': true },
                      attrs: { type: 'button' },
                      on: { click: this.onConfirmRestart },
                    },
                    '确认重启',
                  ),
                  h(
                    'button',
                    {
                      class: 'bhchat-btn bhchat-btn-secondary',
                      attrs: { type: 'button' },
                      on: { click: this.onCancelDialog },
                    },
                    '取消',
                  ),
                ]),
              ],
            ),
          ],
        );
      }
      if (!dialog.items || !dialog.items.length) return null;
      var isInstall = dialog.mode === 'install';
      var items = dialog.items;
      var single = items.length === 1;
      var preview = single ? items[0].preview : null;
      var manifest = preview && preview.manifest;
      var plugin = single ? items[0].plugin : null;
      var title = isInstall
        ? single
          ? preview && preview.upgrade
            ? '确认升级插件'
            : '确认安装插件'
          : '确认批量安装（' + items.length + '）'
        : single
          ? '确认删除插件'
          : '确认批量删除（' + items.length + '）';
      var body = [];
      if (isInstall && single && manifest) {
        body.push(
          h('div', { class: 'bhchat-dialog-row' }, [
            h('span', { class: 'bhchat-dialog-label' }, '名称'),
            h('span', { class: 'bhchat-dialog-value' }, sanitize(manifest.name, 80)),
          ]),
        );
        body.push(
          h('div', { class: 'bhchat-dialog-row' }, [
            h('span', { class: 'bhchat-dialog-label' }, 'ID'),
            h('span', { class: 'bhchat-dialog-value' }, sanitize(manifest.id, 64)),
          ]),
        );
        body.push(
          h('div', { class: 'bhchat-dialog-row' }, [
            h('span', { class: 'bhchat-dialog-label' }, '版本'),
            h('span', { class: 'bhchat-dialog-value' }, sanitize(manifest.version, 32)),
          ]),
        );
        body.push(
          h('div', { class: 'bhchat-dialog-row' }, [
            h('span', { class: 'bhchat-dialog-label' }, '作者'),
            h('span', { class: 'bhchat-dialog-value' }, sanitize(manifest.author, 80) || '未知'),
          ]),
        );
        body.push(
          h('div', { class: 'bhchat-dialog-desc' }, sanitize(manifest.desc, 100) || '（无描述）'),
        );
      } else if (isInstall) {
        items.forEach(function (item) {
          var man = item.preview && item.preview.manifest;
          if (!man) return;
          var line = sanitize(man.name, 80) + ' · ' + sanitize(man.id, 64) + ' · v' + sanitize(man.version, 32);
          if (item.preview.upgrade) line += ' · 升级';
          body.push(h('div', { class: 'bhchat-dialog-item' }, line));
        });
      } else if (single && plugin) {
        body.push(
          h('div', { class: 'bhchat-dialog-row' }, [
            h('span', { class: 'bhchat-dialog-label' }, '名称'),
            h('span', { class: 'bhchat-dialog-value' }, sanitize(plugin.name, 80)),
          ]),
        );
        body.push(
          h('div', { class: 'bhchat-dialog-row' }, [
            h('span', { class: 'bhchat-dialog-label' }, 'ID'),
            h('span', { class: 'bhchat-dialog-value' }, sanitize(plugin.id, 64)),
          ]),
        );
        body.push(h('div', { class: 'bhchat-dialog-desc' }, '删除后需重启客户端才会从运行中卸下。'));
      } else {
        items.forEach(function (item) {
          var p = item.plugin;
          if (!p) return;
          body.push(
            h('div', { class: 'bhchat-dialog-item' }, sanitize(p.name, 80) + ' · ' + sanitize(p.id, 64)),
          );
        });
      }
      var confirmLabel = isInstall
        ? single
          ? preview && preview.upgrade
            ? '确认升级'
            : '确认安装'
          : '确认安装'
        : '确认删除';
      return h(
        'div',
        { class: 'bhchat-dialog-mask', on: { click: this.onDialogMaskClick } },
        [
          h(
            'div',
            { class: 'bhchat-dialog', on: { click: this.stopBubble } },
            [
              h('div', { class: 'bhchat-dialog-title' }, title),
              h('div', { class: 'bhchat-dialog-body' }, body),
              h('div', { class: 'bhchat-dialog-actions' }, [
                h(
                  'button',
                  {
                    class: {
                      'bhchat-btn': true,
                      'bhchat-btn-primary': isInstall,
                      'bhchat-btn-danger': !isInstall,
                    },
                    attrs: { type: 'button', disabled: this.busy ? 'disabled' : undefined },
                    on: { click: isInstall ? this.onConfirmInstall : this.onConfirmUninstall },
                  },
                  this.busy ? '处理中…' : confirmLabel,
                ),
                h(
                  'button',
                  {
                    class: 'bhchat-btn bhchat-btn-secondary',
                    attrs: { type: 'button', disabled: this.busy ? 'disabled' : undefined },
                    on: { click: this.onCancelDialog },
                  },
                  '取消',
                ),
              ]),
            ],
          ),
        ],
      );
    };
    return component;
  }

  function injectMarketplaceStyle() {
    if (!window.BHChat || !window.BHChat.injectCSS) return;
    window.BHChat.injectCSS(
      [
        '.betterheyboxchat-setting-block .bhchat-input{width:100%;margin:8px 0;padding:6px 8px;border:1px solid var(--opacity-2,rgba(255,255,255,.18));border-radius:6px;background:var(--fill-input,#1f2225);color:var(--text-1,#fff);box-sizing:border-box}',
        'html[theme=light] .betterheyboxchat-setting-block .bhchat-input,body[theme=light] .betterheyboxchat-setting-block .bhchat-input{background:var(--fill-input,#e4e6eb);color:var(--text-1,#000);border-color:var(--opacity-2,#00000014)}',
        '.betterheyboxchat-setting-block .bhchat-check{width:16px;height:16px;margin-right:10px;flex-shrink:0;box-sizing:border-box;border-radius:4px;border:1.5px solid var(--text-3,#8b8d94);background:transparent}',
        '.betterheyboxchat-setting-block .bhchat-check.on{background:var(--brand-fill,#2d7d46);border-color:var(--brand-fill,#2d7d46);box-shadow:inset 0 0 0 2px var(--fill-1,#36393e)}',
        'html[theme=light] .betterheyboxchat-setting-block .bhchat-check.on,body[theme=light] .betterheyboxchat-setting-block .bhchat-check.on{box-shadow:inset 0 0 0 2px var(--fill-1,#fff)}',
        '.bhchat-dialog-mask{position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:var(--opacity-s5,rgba(0,0,0,.7))}',
        '.bhchat-dialog{width:min(420px,calc(100vw - 48px));max-height:min(70vh,520px);overflow:auto;padding:20px 20px 16px;border-radius:12px;background:var(--fill-1,#36393e);color:var(--text-1,#fff);box-shadow:0 12px 40px rgba(0,0,0,.4)}',
        'html[theme=light] .bhchat-dialog,body[theme=light] .bhchat-dialog{background:var(--fill-1,#fff);color:var(--text-1,#000);box-shadow:0 12px 40px rgba(0,0,0,.18)}',
        '.bhchat-dialog-title{font-size:16px;font-weight:700;line-height:22px;margin:0 0 14px;color:var(--text-1,#fff)}',
        'html[theme=light] .bhchat-dialog-title,body[theme=light] .bhchat-dialog-title{color:var(--text-1,#000)}',
        '.bhchat-dialog-body{display:flex;flex-direction:column;gap:8px}',
        '.bhchat-dialog-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:22px}',
        '.bhchat-dialog-label{color:var(--text-2,#d2d3d7);flex-shrink:0}',
        'html[theme=light] .bhchat-dialog-label,body[theme=light] .bhchat-dialog-label{color:var(--text-2,#32373c)}',
        '.bhchat-dialog-value{color:var(--text-1,#fff);text-align:right;word-break:break-all}',
        'html[theme=light] .bhchat-dialog-value,body[theme=light] .bhchat-dialog-value{color:var(--text-1,#000)}',
        '.bhchat-dialog-desc,.bhchat-dialog-item{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--text-2,#d2d3d7);white-space:pre-wrap;word-break:break-word}',
        'html[theme=light] .bhchat-dialog-desc,html[theme=light] .bhchat-dialog-item,body[theme=light] .bhchat-dialog-desc,body[theme=light] .bhchat-dialog-item{color:var(--text-2,#32373c)}',
        '.bhchat-dialog-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:16px 0 0}',
      ].join(''),
    );
  }

  function activate() {
    injectMarketplaceStyle();
    if (!window.BHChat || !window.BHChat.registerPanel) return;
    window.BHChat.registerPanel({
      id: PLUGIN_ID,
      title: '插件市场',
      component: attachDialogRender(buildPanelComponent()),
    });
  }

  if (window.BHChat) {
    window.BHChat.onReady(activate);
  }
})();
