use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CliArgs {
    pub reinstall: bool,
    pub yes: bool,
    pub path: Option<PathBuf>,
}

pub fn parse_args<I, S>(args: I) -> CliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut parsed = CliArgs::default();
    let mut iter = args.into_iter();
    let _exe = iter.next();
    let rest: Vec<String> = iter.map(|item| item.as_ref().to_string()).collect();
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "--reinstall" => parsed.reinstall = true,
            "--yes" | "-y" => parsed.yes = true,
            "--path" => {
                if let Some(value) = rest.get(i + 1) {
                    if !value.starts_with('-') {
                        parsed.path = Some(PathBuf::from(value));
                        i += 1;
                    }
                }
            }
            other => {
                if let Some(value) = other.strip_prefix("--path=") {
                    if !value.is_empty() {
                        parsed.path = Some(PathBuf::from(value));
                    }
                }
            }
        }
        i += 1;
    }
    parsed
}

pub fn wants_silent_reinstall(args: &CliArgs) -> bool {
    args.reinstall && args.yes
}

#[cfg(test)]
mod tests {
    use super::{parse_args, wants_silent_reinstall};
    use std::path::PathBuf;

    #[test]
    fn empty_args_stay_gui() {
        let parsed = parse_args(["bhchat-installer.exe"]);
        assert!(!wants_silent_reinstall(&parsed));
        assert!(parsed.path.is_none());
    }

    #[test]
    fn reinstall_without_yes_is_not_silent() {
        let parsed = parse_args(["bhchat-installer.exe", "--reinstall"]);
        assert!(!wants_silent_reinstall(&parsed));
    }

    #[test]
    fn reinstall_yes_is_silent() {
        let parsed = parse_args(["bhchat-installer.exe", "--reinstall", "--yes"]);
        assert!(wants_silent_reinstall(&parsed));
        assert!(parsed.path.is_none());
    }

    #[test]
    fn path_equals_form() {
        let parsed = parse_args(["bhchat-installer.exe", "--path=C:\\HeyboxChat", "--yes"]);
        assert_eq!(parsed.path, Some(PathBuf::from(r"C:\HeyboxChat")));
        assert!(parsed.yes);
    }
}
