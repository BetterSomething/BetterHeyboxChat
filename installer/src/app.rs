use crate::client::is_heybox_running;
use crate::detect::{detect_install, format_client_version};
use crate::elevate::{is_admin, request_admin_relaunch};
use crate::patch::{
    install_patches_managed, read_patch_state, reinstall_patches_managed,
    uninstall_patches_managed,
};
use crate::types::{ClientInstall, PatchState};
use crate::userdata;
use eframe::egui;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

pub enum WorkerMsg {
    Progress(f32, String),
    Done(Result<String, String>),
}

pub struct InstallerApp {
    pub(crate) manual_root: Option<PathBuf>,
    pub(crate) install: Option<ClientInstall>,
    pub(crate) patch_state: PatchState,
    pub(crate) heybox_version_text: String,
    pub(crate) status_text: String,
    pub(crate) progress: f32,
    pub(crate) busy: bool,
    pub(crate) show_manual_path: bool,
    pub(crate) manual_path_input: String,
    worker_rx: Option<Receiver<WorkerMsg>>,
    pub(crate) admin: bool,
    pub(crate) heybox_running: bool,
    pub(crate) data_root_text: String,
    last_process_check: Instant,
}

impl InstallerApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        crate::fonts::setup_fonts(&cc.egui_ctx);
        crate::ui::setup_theme(&cc.egui_ctx);
        let mut app = Self {
            manual_root: None,
            install: None,
            patch_state: PatchState::default(),
            heybox_version_text: "检测中...".into(),
            status_text: String::new(),
            progress: 0.0,
            busy: false,
            show_manual_path: false,
            manual_path_input: String::new(),
            worker_rx: None,
            admin: is_admin(),
            heybox_running: false,
            data_root_text: String::new(),
            last_process_check: Instant::now() - Duration::from_secs(2),
        };
        app.refresh_process_status();
        app.refresh_detection();
        app
    }

    pub(crate) fn refresh_process_status(&mut self) {
        self.heybox_running = is_heybox_running();
        self.last_process_check = Instant::now();
    }

    pub fn refresh_detection(&mut self) {
        self.install = detect_install(self.manual_root.as_deref());
        self.heybox_version_text = match &self.install {
            Some(install) => format_client_version(install),
            None => "未检测到".into(),
        };
        self.patch_state = self
            .install
            .as_ref()
            .map(|i| read_patch_state(&i.app_dir))
            .unwrap_or_default();

        self.data_root_text = userdata::current_data_root().display().to_string();

        if self.install.is_none() {
            self.status_text = "未找到黑盒语音安装，请尝试手动指定路径。".into();
        } else if self.patch_state.installed {
            self.status_text = format!(
                "已安装 BetterHeyboxChat v{}",
                self.patch_state.loader_version.as_deref().unwrap_or("?")
            );
        } else {
            self.status_text = "就绪，可以安装。".into();
        }
    }

    pub(crate) fn can_install(&self) -> bool {
        self.install.is_some() && !self.patch_state.installed && !self.busy
    }

    pub(crate) fn can_reinstall(&self) -> bool {
        self.install.is_some() && !self.busy
    }

    pub(crate) fn can_uninstall(&self) -> bool {
        self.patch_state.installed && !self.busy
    }

    fn ensure_admin(&mut self) -> bool {
        if self.admin {
            return true;
        }
        self.request_elevated_relaunch();
        false
    }

    pub(crate) fn request_elevated_relaunch(&mut self) {
        if request_admin_relaunch() {
            std::process::exit(0);
        }
        self.status_text = "未获得管理员权限。".into();
    }

    fn start_worker<F>(&mut self, ctx: &egui::Context, label: &'static str, work: F)
    where
        F: FnOnce(Sender<WorkerMsg>) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel();
        self.worker_rx = Some(rx);
        self.busy = true;
        self.progress = 0.05;
        self.status_text = label.to_string();

        let ctx = ctx.clone();
        thread::spawn(move || {
            work(tx);
            ctx.request_repaint();
        });
    }

    fn poll_worker(&mut self) {
        let messages: Vec<WorkerMsg> = if let Some(rx) = &self.worker_rx {
            let mut buf = Vec::new();
            while let Ok(msg) = rx.try_recv() {
                buf.push(msg);
            }
            buf
        } else {
            return;
        };

        let mut clear_worker = false;
        for msg in messages {
            match msg {
                WorkerMsg::Progress(p, text) => {
                    self.progress = p;
                    self.status_text = text;
                }
                WorkerMsg::Done(result) => {
                    self.busy = false;
                    self.progress = if result.is_ok() { 1.0 } else { 0.0 };
                    clear_worker = true;
                    match result {
                        Ok(msg) => {
                            if !msg.is_empty() {
                                self.status_text = msg;
                            }
                            self.refresh_detection();
                        }
                        Err(err) => {
                            self.status_text = err;
                        }
                    }
                }
            }
        }
        if clear_worker {
            self.worker_rx = None;
        }
    }

    pub(crate) fn do_install(&mut self, ctx: &egui::Context) {
        if !self.ensure_admin() {
            return;
        }
        let install = match self.install.clone() {
            Some(i) => i,
            None => return,
        };

        self.start_worker(ctx, "正在安装...", move |tx| {
            let _ = tx.send(WorkerMsg::Progress(0.2, "备份原始文件...".into()));
            let result = install_patches_managed(&install);
            let _ = tx.send(WorkerMsg::Progress(0.9, "完成安装...".into()));
            let _ = tx.send(WorkerMsg::Done(result));
        });
    }

    pub(crate) fn do_reinstall(&mut self, ctx: &egui::Context) {
        if !self.ensure_admin() {
            return;
        }
        let install = match self.install.clone() {
            Some(i) => i,
            None => return,
        };

        self.start_worker(ctx, "正在重装/更新...", move |tx| {
            let _ = tx.send(WorkerMsg::Progress(0.2, "卸载旧版本...".into()));
            let result = reinstall_patches_managed(&install);
            let _ = tx.send(WorkerMsg::Progress(0.9, "完成...".into()));
            let _ = tx.send(WorkerMsg::Done(result));
        });
    }

    pub(crate) fn do_uninstall(&mut self, ctx: &egui::Context) {
        if !self.ensure_admin() {
            return;
        }
        let install = match self.install.clone() {
            Some(i) => i,
            None => return,
        };

        self.start_worker(ctx, "正在卸载...", move |tx| {
            let _ = tx.send(WorkerMsg::Progress(0.3, "还原原始文件...".into()));
            let result = uninstall_patches_managed(&install);
            let _ = tx.send(WorkerMsg::Progress(0.9, "完成...".into()));
            let _ = tx.send(WorkerMsg::Done(result));
        });
    }

    pub(crate) fn pick_data_root(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .set_title("选择 BetterHeyboxChat 数据目录")
            .pick_folder()
        {
            match userdata::set_data_root(&path) {
                Ok(root) => {
                    self.data_root_text = root.display().to_string();
                    self.status_text = format!(
                        "数据目录已改为 {}。请重启黑盒语音使插件目录生效。",
                        self.data_root_text
                    );
                }
                Err(err) => {
                    self.status_text = err;
                }
            }
        }
    }

    pub(crate) fn reset_data_root(&mut self) {
        match userdata::reset_data_root() {
            Ok(root) => {
                self.data_root_text = root.display().to_string();
                self.status_text = format!(
                    "已恢复默认数据目录 {}。旧目录中的插件文件不会删除。",
                    self.data_root_text
                );
            }
            Err(err) => {
                self.status_text = err;
            }
        }
    }

    pub(crate) fn pick_manual_path(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .set_title("选择黑盒语音安装目录")
            .pick_folder()
        {
            self.manual_path_input = path.display().to_string();
            self.show_manual_path = true;
        }
    }

    pub(crate) fn apply_manual_path(&mut self) {
        let trimmed = self.manual_path_input.trim();
        if trimmed.is_empty() {
            self.status_text = "请输入黑盒语音安装目录。".into();
            return;
        }
        self.manual_root = Some(PathBuf::from(trimmed));
        self.refresh_detection();
    }
}

impl eframe::App for InstallerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.last_process_check.elapsed() >= Duration::from_secs(1) {
            self.refresh_process_status();
        }
        self.poll_worker();
        crate::ui::render(self, ctx);
    }
}

