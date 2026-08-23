pub fn is_admin() -> bool {
    is_elevated::is_elevated()
}

/// 弹出 UAC，用管理员身份再开一份安装器。
/// 成功时返回 true（调用方应退出当前进程）；用户取消或失败返回 false。
#[cfg(windows)]
pub fn request_admin_relaunch() -> bool {
    use crate::path_util::normalize_path;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    const SW_SHOWNORMAL: i32 = 1;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let exe = match std::env::current_exe() {
        Ok(p) => normalize_path(&p),
        Err(_) => return false,
    };
    let Some(dir) = exe.parent() else {
        return false;
    };

    let exe_w = wide(&exe.to_string_lossy());
    let dir_w = wide(&dir.to_string_lossy());
    let verb_w = wide("runas");

    // ShellExecuteW("runas") 会阻塞到 UAC 结束；取消时返回值 ≤ 32。
    let code = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb_w.as_ptr(),
            exe_w.as_ptr(),
            ptr::null(),
            dir_w.as_ptr(),
            SW_SHOWNORMAL,
        )
    };

    code > 32
}

#[cfg(not(windows))]
pub fn request_admin_relaunch() -> bool {
    false
}
