// SayknowMind Desktop Application
// Full-featured Tauri wrapper with:
// - System tray icon with menu
// - Global shortcut for quick toggle (Cmd/Ctrl+Shift+K)
// - Real service health checks via TCP
// - Auto-update support
// - Offline mode with local data cache
// - Auto-start local services (Docker Compose)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::Command;
use std::time::Duration;
use std::path::PathBuf;
use std::fs;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Runtime,
};
use tauri_plugin_shell::ShellExt;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn quick_search(query: String) -> String {
    format!("Searching for: {}", query)
}

#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "SayknowMind",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Open Personal Agentic Second Brain"
    })
}

/// Detect local environment: Node.js, Docker, Ollama, Git
#[tauri::command]
fn detect_environment() -> serde_json::Value {
    // macOS app bundles have limited PATH — extend with common locations
    let extra_paths = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let current_path = std::env::var("PATH").unwrap_or_default();
    let full_path = format!("{}:{}", extra_paths, current_path);

    fn detect_with_path(cmd: &str, args: &[&str], path: &str) -> Option<String> {
        Command::new(cmd)
            .args(args)
            .env("PATH", path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    }

    let detect = |cmd: &str, args: &[&str]| detect_with_path(cmd, args, &full_path);

    let node = detect("node", &["--version"]);
    let node_path = Command::new("which").arg("node").env("PATH", &full_path).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    let docker = detect("docker", &["--version"])
        .map(|v| v.replace("Docker version ", "").split(',').next().unwrap_or("").to_string());

    let ollama_version = detect("ollama", &["--version"])
        .map(|v| v.replace("ollama version ", ""));
    let ollama_running = port_open(11434);

    let git = detect("git", &["--version"])
        .map(|v| v.replace("git version ", ""));

    // Check if web-standalone exists
    let home = std::env::var("HOME").unwrap_or_default();
    let app_data = format!("{}/Library/Application Support/com.sayknowmind.desktop", home);
    let server_installed = PathBuf::from(&format!("{}/web-standalone/server.js", app_data)).exists();
    let node_bundled = PathBuf::from(&format!("{}/node/bin/node", app_data)).exists();

    serde_json::json!({
        "node": node.as_ref().map(|v| serde_json::json!({
            "version": v,
            "source": if node_bundled { "bundled" } else { "system" },
            "path": node_path,
        })),
        "docker": docker.map(|v| serde_json::json!({ "version": v })),
        "ollama": ollama_version.map(|v| serde_json::json!({
            "version": v,
            "running": ollama_running,
        })),
        "git": git.map(|v| serde_json::json!({ "version": v })),
        "serverInstalled": server_installed,
        "appDataPath": app_data,
    })
}

/// Check if a local port is reachable (200ms timeout).
fn port_open(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    TcpStream::connect_timeout(
        &addr.parse().unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
        Duration::from_millis(200),
    )
    .is_ok()
}

#[tauri::command]
fn check_services_health() -> serde_json::Value {
    // Cloud services: check via HTTPS reachability
    let cloud_ok = std::process::Command::new("curl")
        .args(["-sf", "--max-time", "3", "https://mind.sayknow.ai/api/health"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    serde_json::json!({
        "cloud":  cloud_ok,
        "ollama": port_open(11434),
    })
}

/// Start local services via Docker Compose
#[tauri::command]
fn start_local_services() -> serde_json::Value {
    let project_dir = find_project_dir();
    match project_dir {
        Some(dir) => {
            let result = Command::new("docker")
                .args(["compose", "up", "-d"])
                .current_dir(&dir)
                .output();

            match result {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    serde_json::json!({
                        "success": output.status.success(),
                        "stdout": stdout,
                        "stderr": stderr,
                    })
                }
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to start Docker Compose: {}", e),
                }),
            }
        }
        None => serde_json::json!({
            "success": false,
            "error": "Could not find project directory with docker-compose.yml",
        }),
    }
}

/// Stop local services
#[tauri::command]
fn stop_local_services() -> serde_json::Value {
    let project_dir = find_project_dir();
    match project_dir {
        Some(dir) => {
            let result = Command::new("docker")
                .args(["compose", "down"])
                .current_dir(&dir)
                .output();

            match result {
                Ok(output) => serde_json::json!({
                    "success": output.status.success(),
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("{}", e),
                }),
            }
        }
        None => serde_json::json!({
            "success": false,
            "error": "Could not find project directory",
        }),
    }
}

/// Check if the app is in offline mode (no web service available)
#[tauri::command]
fn is_offline() -> bool {
    !port_open(3000)
}

/// Get cached data for offline mode
#[tauri::command]
fn get_offline_cache() -> serde_json::Value {
    let cache_path = get_cache_dir().join("offline-cache.json");
    match fs::read_to_string(&cache_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(serde_json::json!({"documents": [], "categories": []})),
        Err(_) => serde_json::json!({"documents": [], "categories": []}),
    }
}

/// Save data to offline cache
#[tauri::command]
fn save_offline_cache(data: serde_json::Value) -> bool {
    let cache_dir = get_cache_dir();
    let _ = fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("offline-cache.json");
    match fs::write(&cache_path, serde_json::to_string_pretty(&data).unwrap_or_default()) {
        Ok(_) => true,
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn find_project_dir() -> Option<PathBuf> {
    // Look for docker-compose.yml in common locations
    let candidates = vec![
        PathBuf::from("."),
        PathBuf::from(".."),
        PathBuf::from("../.."),
        dirs_next::home_dir().map(|h| h.join("sayknowmind")).unwrap_or_default(),
    ];

    for dir in candidates {
        if dir.join("docker-compose.yml").exists() {
            return Some(dir);
        }
    }
    None
}

fn get_cache_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sayknowmind")
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open SayknowMind", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start_services", "Start Services", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop_services", "Stop Services", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &start, &stop, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("SayknowMind — Agentic Second Brain")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "start_services" => {
                std::thread::spawn(|| { let _ = start_local_services(); });
            }
            "stop_services" => {
                std::thread::spawn(|| { let _ = stop_local_services(); });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

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
        .invoke_handler(tauri::generate_handler![
            quick_search,
            get_app_info,
            detect_environment,
            check_services_health,
            start_local_services,
            stop_local_services,
            is_offline,
            get_offline_cache,
            save_offline_cache,
        ])
        .setup(|app| {
            setup_tray(app)?;
            setup_global_shortcut(app)?;

            // Start embedded Next.js server (PGlite mode)
            let sidecar = app.shell()
                .sidecar("start-server")
                .expect("failed to create sidecar command");

            let (mut _rx, _child) = sidecar
                .spawn()
                .expect("failed to spawn Next.js sidecar");

            eprintln!("[desktop] Next.js sidecar started on port 3457");

            // Wait for server to be ready, then show window
            std::thread::spawn(move || {
                for _ in 0..30 {
                    std::thread::sleep(Duration::from_secs(1));
                    if port_open(3457) {
                        eprintln!("[desktop] Server ready on port 3457");
                        return;
                    }
                }
                eprintln!("[desktop] WARNING: Server did not start within 30s");
            });

            // Check local Ollama
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_secs(3));
                if !port_open(11434) {
                    eprintln!("[desktop] Ollama not running — local AI unavailable. Install from https://ollama.ai");
                }
            });

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SayknowMind desktop app");
}
