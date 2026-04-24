// SayknowMind Desktop Application
// Local-first architecture:
// - Bundled Node.js sidecar runs Next.js standalone server
// - Tauri webview loads from localhost:3457
// - Ollama access via direct localhost (no CORS proxy needed)
// - Auth syncs with cloud (mind.sayknow.ai)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use std::path::PathBuf;
use std::fs;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, Runtime,
};
use tauri_plugin_shell::ShellExt;

const SERVER_PORT: u16 = 3457;

// ---------------------------------------------------------------------------
// State: track the sidecar child process
// ---------------------------------------------------------------------------

struct ServerProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "SayknowMind",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Open Personal Agentic Second Brain",
        "mode": "desktop",
    })
}

#[tauri::command]
fn detect_environment() -> serde_json::Value {
    let extra_paths = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let current_path = std::env::var("PATH").unwrap_or_default();
    let full_path = format!("{}:{}", extra_paths, current_path);

    let detect = |cmd: &str, args: &[&str]| -> Option<String> {
        Command::new(cmd)
            .args(args)
            .env("PATH", &full_path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };

    let docker = detect("docker", &["--version"])
        .map(|v| v.replace("Docker version ", "").split(',').next().unwrap_or("").to_string());

    let ollama_version = detect("ollama", &["--version"])
        .map(|v| v.replace("ollama version ", ""));
    let ollama_running = port_open(11434);

    let git = detect("git", &["--version"])
        .map(|v| v.replace("git version ", ""));

    serde_json::json!({
        "mode": "desktop",
        "docker": docker.map(|v| serde_json::json!({ "version": v })),
        "ollama": ollama_version.map(|v| serde_json::json!({
            "version": v,
            "running": ollama_running,
        })),
        "git": git.map(|v| serde_json::json!({ "version": v })),
        "serverPort": SERVER_PORT,
    })
}

#[tauri::command]
fn check_services_health() -> serde_json::Value {
    serde_json::json!({
        "server": port_open(SERVER_PORT),
        "ollama": port_open(11434),
    })
}

#[tauri::command]
fn is_offline() -> bool {
    !port_open(SERVER_PORT)
}

#[tauri::command]
fn get_offline_cache() -> serde_json::Value {
    let cache_path = get_cache_dir().join("offline-cache.json");
    match fs::read_to_string(&cache_path) {
        Ok(content) => serde_json::from_str(&content)
            .unwrap_or(serde_json::json!({"documents": [], "categories": []})),
        Err(_) => serde_json::json!({"documents": [], "categories": []}),
    }
}

#[tauri::command]
fn save_offline_cache(data: serde_json::Value) -> bool {
    let cache_dir = get_cache_dir();
    let _ = fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("offline-cache.json");
    fs::write(&cache_path, serde_json::to_string_pretty(&data).unwrap_or_default()).is_ok()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(200),
    )
    .is_ok()
}

fn get_cache_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sayknowmind")
}

/// Find the web-standalone directory
fn find_web_standalone(_app: &tauri::AppHandle) -> Option<PathBuf> {
    // Check next to the binary (production: app bundle)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // macOS: .app/Contents/MacOS/../Resources/web-standalone
            let macos_resource = exe_dir.join("../Resources/web-standalone");
            if macos_resource.join("server.js").exists() {
                return Some(macos_resource);
            }
            // Linux/Windows: same dir as binary
            let beside = exe_dir.join("web-standalone");
            if beside.join("server.js").exists() {
                return Some(beside);
            }
        }
    }

    // Dev: relative to Cargo manifest
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/web-standalone");
    if dev_path.join("server.js").exists() {
        return Some(dev_path);
    }

    None
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

fn start_server(app: &tauri::AppHandle) {
    let standalone_dir = match find_web_standalone(app) {
        Some(dir) => dir,
        None => {
            eprintln!("[desktop] web-standalone not found — skipping server start");
            return;
        }
    };

    eprintln!("[desktop] Starting server from: {:?}", standalone_dir);

    // Generate or read auth secret
    let data_dir = get_cache_dir();
    let _ = fs::create_dir_all(&data_dir);
    let secret_file = data_dir.join("auth-secret");
    let secret = if secret_file.exists() {
        fs::read_to_string(&secret_file).unwrap_or_default().trim().to_string()
    } else {
        let s = Command::new("openssl")
            .args(["rand", "-base64", "32"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "fallback-desktop-secret".to_string());
        let _ = fs::write(&secret_file, &s);
        s
    };

    // Spawn Node.js sidecar with the standalone server
    let shell = app.shell();
    let server_js = standalone_dir.join("server.js");

    let cmd = shell
        .sidecar("node")
        .unwrap()
        .args([server_js.to_string_lossy().as_ref()])
        .env("NODE_ENV", "production")
        .env("PORT", &SERVER_PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("BETTER_AUTH_SECRET", &secret)
        .env("BETTER_AUTH_URL", &format!("http://localhost:{}", SERVER_PORT))
        .env("NEXT_PUBLIC_APP_URL", &format!("http://localhost:{}", SERVER_PORT))
        .env("NEXT_PUBLIC_DEPLOY_MODE", "desktop");

    match cmd.spawn() {
        Ok((rx, child)) => {
            eprintln!("[desktop] Server started on port {}", SERVER_PORT);

            // Store child for cleanup
            let state = app.state::<ServerProcess>();
            *state.0.lock().unwrap() = Some(child);

            // Log server output in background
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                let mut rx = rx;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprintln!("[server:out] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[server:err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[server] Terminated: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => {
            eprintln!("[desktop] Failed to start server: {}", e);
        }
    }
}

fn stop_server(app: &tauri::AppHandle) {
    let state = app.state::<ServerProcess>();
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.take() {
        eprintln!("[desktop] Stopping server...");
        let _ = child.kill();
    }
}

/// Wait for the server to be ready (up to ~10 seconds)
fn wait_for_server(timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if port_open(SERVER_PORT) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let add_clipboard = MenuItem::with_id(app, "add_clipboard", "메모리 추가", true, None::<&str>)?;
    let quick_search = MenuItem::with_id(app, "quick_search", "빠른 검색", true, None::<&str>)?;
    let open_chat = MenuItem::with_id(app, "open_chat", "채팅 열기", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let open_settings = MenuItem::with_id(app, "open_settings", "설정", true, None::<&str>)?;
    let open_app = MenuItem::with_id(app, "open", "앱 열기", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &add_clipboard, &quick_search, &open_chat,
        &sep1, &open_settings, &open_app,
        &sep2, &quit,
    ])?;

    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("failed to load tray icon");

    TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("SayknowMind — Agentic Second Brain")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id.0.as_str();
            match id {
                "open" | "open_app" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "add_clipboard" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.eval("window.dispatchEvent(new CustomEvent('sayknow-open-add-memory'))");
                    }
                }
                "quick_search" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.eval("window.location.href = '/'");
                    }
                }
                "open_chat" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.eval("window.location.href = '/chat'");
                    }
                }
                "open_settings" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.eval("window.location.href = '/settings'");
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Global shortcut
// ---------------------------------------------------------------------------

fn setup_global_shortcut<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

    #[cfg(target_os = "macos")]
    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyK);
    #[cfg(not(target_os = "macos"))]
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyK);

    let handle = app.handle().clone();
    if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _sc, _ev| {
        if let Some(w) = handle.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            } else {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }) {
        eprintln!("[desktop] Failed to register global shortcut: {}", e);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            detect_environment,
            check_services_health,
            is_offline,
            get_offline_cache,
            save_offline_cache,
        ])
        .setup(|app| {
            setup_tray(app)?;
            setup_global_shortcut(app)?;

            let handle = app.handle().clone();

            // Start the bundled Next.js server (non-dev only)
            if !cfg!(debug_assertions) {
                start_server(&handle);
            }

            // Determine server URL
            let url = format!("http://localhost:{}", if cfg!(debug_assertions) { 3000 } else { SERVER_PORT });

            // Wait for server to be ready before creating window
            if !cfg!(debug_assertions) {
                eprintln!("[desktop] Waiting for server...");
                if !wait_for_server(10_000) {
                    eprintln!("[desktop] Server not ready after 10s — opening anyway");
                }
            }

            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().unwrap()),
            )
            .title("SayknowMind - Agentic Second Brain")
            .inner_size(1280.0, 800.0)
            .disable_drag_drop_handler()
            .on_navigation(|nav_url| {
                let host = nav_url.host_str().unwrap_or("");
                if host == "localhost"
                    || host == "127.0.0.1"
                    || nav_url.scheme() == "tauri"
                    || nav_url.scheme() == "ipc"
                {
                    true
                } else {
                    let _ = std::process::Command::new("open")
                        .arg(nav_url.as_str())
                        .spawn();
                    false
                }
            })
            .build()
            .expect("failed to create main window");

            // Inject desktop environment flag
            let env_data = detect_environment();
            let env_json = serde_json::to_string(&env_data).unwrap_or_else(|_| "{}".to_string());
            let js = format!(
                "window.__SAYKNOW_ENV__ = {}; window.__TAURI_DESKTOP__ = true; window.dispatchEvent(new CustomEvent('sayknow-env-ready'));",
                env_json
            );
            let w = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(1));
                let _ = w.eval(&js);
                eprintln!("[desktop] Environment injected into webview");
            });

            #[cfg(debug_assertions)]
            window.open_devtools();

            // Cleanup server on app exit
            let exit_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    stop_server(&exit_handle);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SayknowMind desktop app");
}
