pub const ELEVATED_FLAG: &str = "--bhchat-elevated";

pub fn is_admin() -> bool {
    is_elevated::is_elevated()
}

pub fn should_auto_elevate(is_admin: bool, already_attempted: bool) -> bool {
    !is_admin && !already_attempted
}

pub fn already_attempted_elevate() -> bool {
    std::env::args().any(|arg| arg == ELEVATED_FLAG)
}

fn quote_win_arg(arg: &str) -> String {
    if arg.chars().any(char::is_whitespace) || arg.contains('"') {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        arg.to_string()
    }
}

pub fn relaunch_params<I, S>(args: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut iter = args.into_iter();
    let _exe = iter.next();
    let mut parts: Vec<String> = iter
        .filter(|arg| arg.as_ref() != ELEVATED_FLAG)
        .map(|arg| quote_win_arg(arg.as_ref()))
        .collect();
    parts.push(ELEVATED_FLAG.to_string());
    parts.join(" ")
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

    let params = relaunch_params(std::env::args());
    let exe_w = wide(&exe.to_string_lossy());
    let dir_w = wide(&dir.to_string_lossy());
    let verb_w = wide("runas");
    let params_w = wide(&params);

    // ShellExecuteW("runas") 会阻塞到 UAC 结束；取消时返回值 ≤ 32。
    let code = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb_w.as_ptr(),
            exe_w.as_ptr(),
            params_w.as_ptr(),
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

#[cfg(test)]
mod tests {
    use super::{relaunch_params, should_auto_elevate, ELEVATED_FLAG};

    #[test]
    fn unelevated_first_launch_should_auto_elevate() {
        assert!(should_auto_elevate(false, false));
    }

    #[test]
    fn admin_or_already_attempted_should_not_auto_elevate() {
        assert!(!should_auto_elevate(true, false));
        assert!(!should_auto_elevate(false, true));
        assert!(!should_auto_elevate(true, true));
    }

    #[test]
    fn relaunch_params_appends_flag_and_skips_duplicate() {
        assert_eq!(relaunch_params(["bhchat-installer.exe"]), ELEVATED_FLAG);
        assert_eq!(
            relaunch_params(["bhchat-installer.exe", "--foo"]),
            format!("--foo {ELEVATED_FLAG}")
        );
        assert_eq!(
            relaunch_params(["bhchat-installer.exe", ELEVATED_FLAG]),
            ELEVATED_FLAG
        );
        assert_eq!(
            relaunch_params(["bhchat-installer.exe", r"C:\Program Files\x"]),
            format!("\"C:\\Program Files\\x\" {ELEVATED_FLAG}")
        );
    }
}
