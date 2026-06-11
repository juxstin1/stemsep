use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

struct SepState(Mutex<Option<Child>>);

/// Locate the bundled python project. In dev this is `<repo>/python`;
/// in a packaged build it is shipped as a resource.
fn python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("python");
    if dev.exists() {
        return Ok(dev);
    }
    app.path()
        .resource_dir()
        .map(|r| r.join("python"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_separation(
    app: AppHandle,
    state: State<'_, SepState>,
    input: String,
    preset: String,
    output_dir: String,
) -> Result<(), String> {
    {
        let guard = state.0.lock().unwrap();
        if guard.is_some() {
            return Err("A separation is already running".into());
        }
    }

    let py_dir = python_dir(&app)?;
    let script = py_dir.join("separate.py");

    let mut cmd = Command::new("uv");
    cmd.arg("run")
        .arg("--project")
        .arg(&py_dir)
        .arg("python")
        .arg(&script)
        .arg("--input")
        .arg(&input)
        .arg("--preset")
        .arg(&preset)
        .arg("--output")
        .arg(&output_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start separator (is uv installed?): {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    *state.0.lock().unwrap() = Some(child);

    // stderr: forward library logs as log events
    let app_err = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit("sep:log", line);
        }
    });

    // stdout: JSON-lines protocol from separate.py
    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut saw_terminal_event = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
                    if t == "done" || t == "error" {
                        saw_terminal_event = true;
                    }
                }
                let _ = app_out.emit("sep:event", v);
            }
        }
        // Process ended. Reap it and report abnormal exits.
        let status = {
            let state = app_out.state::<SepState>();
            let mut guard = state.0.lock().unwrap();
            guard.take().and_then(|mut c| c.wait().ok())
        };
        if !saw_terminal_event {
            let code = status.and_then(|s| s.code());
            let _ = app_out.emit(
                "sep:event",
                serde_json::json!({
                    "type": "error",
                    "message": format!("Separator exited unexpectedly (code {:?}). Check the log panel.", code)
                }),
            );
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_separation(state: State<'_, SepState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        child.kill().map_err(|e| e.to_string())?;
        let _ = child.wait();
        *guard = None;
        Ok(())
    } else {
        Err("No separation running".into())
    }
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_item(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SepState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_separation,
            cancel_separation,
            open_folder,
            reveal_item,
            copy_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
