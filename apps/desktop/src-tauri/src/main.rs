// SayknowMind Desktop Application
// Build modes:
//   full (default) — Bundled Node.js + Next.js standalone server (offline)
//   lite           — Remote webview to https://mind.sayknow.ai (lightweight)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
#[cfg(feature = "full")]
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::path::PathBuf;
use std::fs;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, Runtime,
};

#[cfg(feature = "full")]
use std::process::{Command, Child, Stdio};

const SERVER_PORT: u16 = 3457;
const REMOTE_URL: &str = "https://mind.sayknow.ai";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[cfg(feature = "full")]
struct ServerState(Arc<Mutex<Option<Child>>>);

#[cfg(feature = "lite")]
struct ServerState;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_app_info() -> serde_json::Value {
    let mode = if cfg!(feature = "full") { "desktop-full" } else { "desktop-lite" };
    serde_json::json!({
        "name": "SayknowMind",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Open Personal Agentic Second Brain",
        "mode": mode,
    })
}

#[tauri::command]
fn detect_environment() -> serde_json::Value {
    #[cfg(feature = "full")]
    {
        let extra_paths = if cfg!(target_os = "windows") {
            ""
        } else {
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        };
        let current_path = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let full_path = format!("{}{}{}", extra_paths, sep, current_path);

        let detect = |cmd: &str, args: &[&str]| -> Option<String> {
            std::process::Command::new(cmd)
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
            "mode": "desktop-full",
            "docker": docker.map(|v| serde_json::json!({ "version": v })),
            "ollama": ollama_version.map(|v| serde_json::json!({
                "version": v,
                "running": ollama_running,
            })),
            "git": git.map(|v| serde_json::json!({ "version": v })),
            "serverPort": SERVER_PORT,
        })
    }

    #[cfg(feature = "lite")]
    {
        serde_json::json!({
            "mode": "desktop-lite",
            "remoteUrl": REMOTE_URL,
        })
    }
}

#[tauri::command]
fn check_services_health() -> serde_json::Value {
    if cfg!(feature = "full") {
        serde_json::json!({
            "server": port_open(SERVER_PORT),
            "ollama": port_open(11434),
        })
    } else {
        serde_json::json!({
            "server": true,
            "remote": REMOTE_URL,
        })
    }
}

#[tauri::command]
fn is_offline() -> bool {
    if cfg!(feature = "full") {
        !port_open(SERVER_PORT)
    } else {
        // Lite: check if remote is reachable
        std::net::TcpStream::connect_timeout(
            &"mind.sayknow.ai:443".parse().unwrap(),
            Duration::from_secs(3),
        ).is_err()
    }
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
// Subscription-provider status (read-only, available in both full and lite)
//
// These let the webview ask the Tauri host whether the user's local machine
// has Codex / OCP credentials, regardless of where the Next.js server lives.
// In lite builds the server is on a cloud host and can't see ~/.codex or
// localhost:3456 — these commands close that gap.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct CodexStatus {
    ready: bool,
}

#[tauri::command]
fn codex_status() -> CodexStatus {
    // Codex CLI stores OAuth tokens at $HOME/.codex/auth.json (or in the OS
    // keyring; we only detect the file form here — keyring-only logins look
    // un-ready and the user can still trigger codex login from the card).
    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let auth_path = home.join(".codex").join("auth.json");
    CodexStatus { ready: auth_path.exists() }
}

#[derive(serde::Serialize)]
struct OcpStatus {
    ready: bool,
    healthy: bool,
    has_admin_key: bool,
}

#[tauri::command]
fn ocp_status() -> OcpStatus {
    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let admin_key_path = home.join(".ocp").join("admin-key");
    let has_admin_key = admin_key_path.exists();

    // We only need to know whether the proxy is up — health endpoint is
    // public and fast. Short timeout so the settings page doesn't hang
    // when OCP is not installed.
    let healthy = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
        .ok()
        .and_then(|c| c.get("http://127.0.0.1:3456/health").send().ok())
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    OcpStatus {
        ready: has_admin_key && healthy,
        healthy,
        has_admin_key,
    }
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

// ---------------------------------------------------------------------------
// Full-mode only: server lifecycle
// ---------------------------------------------------------------------------

#[cfg(feature = "full")]
fn read_config(data_dir: &PathBuf, name: &str, default: &str) -> String {
    let path = data_dir.join(name);
    match fs::read_to_string(&path) {
        Ok(s) => {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() { default.to_string() } else { trimmed }
        }
        Err(_) => default.to_string(),
    }
}

#[cfg(feature = "full")]
fn find_node_binary() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // Windows: node.exe beside the main binary
            let node = if cfg!(target_os = "windows") {
                exe_dir.join("node.exe")
            } else {
                exe_dir.join("node")
            };
            if node.exists() {
                return Some(node);
            }
        }
    }
    None
}

#[cfg(feature = "full")]
fn find_web_standalone() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // macOS: .app/Contents/MacOS/../Resources/web-standalone
            #[cfg(target_os = "macos")]
            {
                let macos_resource = exe_dir.join("../Resources/web-standalone");
                if macos_resource.join("server.js").exists() {
                    return Some(macos_resource);
                }
            }

            // Windows/Linux: web-standalone beside the exe
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

#[cfg(feature = "full")]
fn generate_secret() -> String {
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("openssl")
            .args(["rand", "-base64", "32"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "fallback-desktop-secret".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        // Windows: use powershell for random bytes
        Command::new("powershell")
            .args(["-Command", "[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "fallback-desktop-secret".to_string())
    }
}

#[cfg(feature = "full")]
fn start_server(state: &ServerState) {
    let node_bin = match find_node_binary() {
        Some(p) => p,
        None => {
            eprintln!("[desktop] Node binary not found — skipping server start");
            return;
        }
    };

    let standalone_dir = match find_web_standalone() {
        Some(dir) => dir,
        None => {
            eprintln!("[desktop] web-standalone not found — skipping server start");
            return;
        }
    };

    eprintln!("[desktop] Starting server from: {:?}", standalone_dir);

    let data_dir = get_cache_dir();
    let _ = fs::create_dir_all(&data_dir);
    let secret_file = data_dir.join("auth-secret");
    let secret = if secret_file.exists() {
        fs::read_to_string(&secret_file).unwrap_or_default().trim().to_string()
    } else {
        let s = generate_secret();
        let _ = fs::write(&secret_file, &s);
        s
    };

    let server_js = standalone_dir.join("server.js");

    // Database: prefer a user-supplied DATABASE_URL (override file in the
    // data dir), otherwise fall back to embedded PGlite so the app is
    // self-contained on first launch. We pass an empty DATABASE_URL when
    // PGlite is active so `pg` never tries to grab a stray local server.
    let db_url = read_config(&data_dir, "database-url", "");
    let use_pglite = db_url.is_empty();
    let bind_origin = format!("http://127.0.0.1:{}", SERVER_PORT);

    match Command::new(&node_bin)
        .arg(server_js.to_string_lossy().as_ref())
        .env("NODE_ENV", "production")
        .env("PORT", &SERVER_PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("PGLITE_MODE", if use_pglite { "true" } else { "false" })
        .env("DATABASE_URL", &db_url)
        .env("BETTER_AUTH_SECRET", &secret)
        .env("BETTER_AUTH_URL", &bind_origin)
        .env("NEXT_PUBLIC_APP_URL", &bind_origin)
        .env("NEXT_PUBLIC_DEPLOY_MODE", "desktop")
        // better-auth blocks sign-in from origins not in TRUSTED_ORIGINS;
        // the bundled server only ever sees the local Tauri webview hitting
        // 127.0.0.1, so trust both 127.0.0.1 and localhost on this port.
        .env(
            "TRUSTED_ORIGINS",
            format!("http://127.0.0.1:{0},http://localhost:{0}", SERVER_PORT),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => {
            eprintln!("[desktop] Server started on port {} (pid: {})", SERVER_PORT, child.id());
            *state.0.lock().unwrap() = Some(child);
        }
        Err(e) => {
            eprintln!("[desktop] Failed to start server: {}", e);
        }
    }
}

#[cfg(feature = "full")]
#[allow(dead_code)]
fn stop_server(state: &ServerState) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        eprintln!("[desktop] Stopping server...");
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(feature = "full")]
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
// Navigation filter (shared)
// ---------------------------------------------------------------------------

fn is_allowed_navigation(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    host == "localhost"
        || host == "127.0.0.1"
        || host == "mind.sayknow.ai"
        || url.scheme() == "tauri"
        || url.scheme() == "ipc"
}

fn open_external(url_str: &str) {
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(url_str).spawn(); }
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/C", "start", "", url_str]).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(url_str).spawn(); }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    #[cfg(feature = "full")]
    let server_state = ServerState(Arc::new(Mutex::new(None)));
    #[cfg(feature = "lite")]
    let server_state = ServerState;

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(server_state)
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            detect_environment,
            check_services_health,
            is_offline,
            get_offline_cache,
            save_offline_cache,
            codex_status,
            ocp_status,
        ]);

    builder = builder.setup(|app| {
        setup_tray(app)?;
        setup_global_shortcut(app)?;

        // Determine the URL to load
        #[cfg(feature = "full")]
        let url = {
            if !cfg!(debug_assertions) {
                let state = app.state::<ServerState>();
                start_server(&state);
                eprintln!("[desktop] Waiting for server...");
                if !wait_for_server(10_000) {
                    eprintln!("[desktop] Server not ready after 10s — opening anyway");
                }
            }
            let port = if cfg!(debug_assertions) { 3000 } else { SERVER_PORT };
            format!("http://127.0.0.1:{}", port)
        };

        #[cfg(feature = "lite")]
        let url = REMOTE_URL.to_string();

        // Inject desktop env
        let env_data = detect_environment();
        let env_json = serde_json::to_string(&env_data).unwrap_or_else(|_| "{}".to_string());
        let init_js = format!(
            "window.__SAYKNOW_ENV__ = {}; window.__TAURI_DESKTOP__ = true;",
            env_json
        );

        let window = tauri::WebviewWindowBuilder::new(
            app,
            "main",
            tauri::WebviewUrl::External(url.parse().unwrap()),
        )
        .title("SayknowMind - Agentic Second Brain")
        .inner_size(1280.0, 800.0)
        .disable_drag_drop_handler()
        .initialization_script(&init_js)
        .on_navigation(|nav_url| {
            if is_allowed_navigation(nav_url) {
                true
            } else {
                open_external(nav_url.as_str());
                false
            }
        })
        .build()
        .expect("failed to create main window");

        // Cleanup server on window destroy (full mode only)
        #[cfg(feature = "full")]
        {
            let server_arc = Arc::clone(&app.state::<ServerState>().0);
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    eprintln!("[desktop] Stopping server...");
                    if let Some(mut child) = server_arc.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            });
        }

        #[cfg(feature = "lite")]
        { let _ = &window; }

        #[cfg(debug_assertions)]
        window.open_devtools();

        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running SayknowMind desktop app");
}
