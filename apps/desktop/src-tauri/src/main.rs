// SayknowMind Desktop Application
// Full-featured Tauri wrapper with:
// - System tray icon with menu
// - Global shortcut for quick toggle (Cmd/Ctrl+Shift+K)
// - Real service health checks via TCP
// - Auto-update support
// - Offline mode with local data cache
// - Auto-start local services (Docker Compose)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpStream, TcpListener};
use std::process::Command;
use std::time::Duration;
use std::path::PathBuf;
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use tauri::{
    menu::{Menu, MenuItem, Submenu, PredefinedMenuItem},
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
    let add_clipboard = MenuItem::with_id(app, "add_clipboard", "메모리 추가", true, None::<&str>)?;
    let quick_search = MenuItem::with_id(app, "quick_search", "빠른 검색", true, None::<&str>)?;
    let open_chat = MenuItem::with_id(app, "open_chat", "채팅 열기", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let open_settings = MenuItem::with_id(app, "open_settings", "설정", true, None::<&str>)?;
    let open_app = MenuItem::with_id(app, "open", "앱 열기", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &add_clipboard,
        &quick_search,
        &open_chat,
        &sep1,
        &open_settings,
        &open_app,
        &sep2,
        &quit,
    ])?;

    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("failed to load tray icon");

    TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("SayknowMind — Agentic Second Brain")
        .menu_on_left_click(true)
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
                _ => {
                    // Model switch: model_xxx
                    if id.starts_with("model_") {
                        let model_name = &id[6..];
                        eprintln!("[tray] Switching chat model to: {}", model_name);
                        // Set active model via local API
                        if let Some(w) = app.get_webview_window("main") {
                            let js = format!(
                                "fetch('/api/models/active', {{ method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify({{ model: '{}', role: 'chat' }}) }})",
                                model_name
                            );
                            let _ = w.eval(&js);
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Get installed Ollama model names
fn get_ollama_models() -> Result<Vec<String>, String> {
    let mut conn = TcpStream::connect_timeout(
        &"127.0.0.1:11434".parse().unwrap(),
        Duration::from_millis(1000),
    ).map_err(|e| format!("{}", e))?;

    let req = "GET /api/tags HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nConnection: close\r\n\r\n";
    conn.write_all(req.as_bytes()).map_err(|e| format!("{}", e))?;
    conn.set_read_timeout(Some(Duration::from_secs(3))).ok();

    let mut response = String::new();
    let mut buf = [0u8; 8192];
    loop {
        match conn.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => response.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
        }
    }

    // Parse JSON body from HTTP response
    if let Some(idx) = response.find("\r\n\r\n") {
        let body = &response[idx + 4..];
        // Find "models" array and extract names
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
            if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                return Ok(models.iter()
                    .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect());
            }
        }
    }
    Ok(vec![])
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
// Local API Server (port 3458) — lets cloud-loaded frontend talk to desktop
// ---------------------------------------------------------------------------

fn start_local_api_server(port: u16) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{}", port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[api] Failed to bind port {}: {}", port, e);
            return;
        }
    };
    eprintln!("[api] Local API server on http://127.0.0.1:{}", port);

    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            std::thread::spawn(move || handle_api_request(stream));
        }
    }
}

fn handle_api_request(mut stream: TcpStream) {
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let first_line = request.lines().next().unwrap_or("");

    // CORS headers for cloud-loaded frontend
    let cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type";

    // Handle OPTIONS preflight
    if first_line.starts_with("OPTIONS") {
        let response = format!("HTTP/1.1 204 No Content\r\n{}\r\n\r\n", cors);
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // Ollama proxy: forward /ollama/* to localhost:11434/api/*
    if first_line.contains("/ollama/") {
        let path = first_line.split_whitespace().nth(1).unwrap_or("/");
        let ollama_path = path.replace("/ollama/", "/api/");
        let method = first_line.split_whitespace().next().unwrap_or("GET");

        // Extract request body for POST/DELETE
        let body_start = request.find("\r\n\r\n").map(|i| i + 4).unwrap_or(n);
        let req_body = if body_start < n { &request[body_start..] } else { "" };

        let ollama_url = format!("http://127.0.0.1:11434{}", ollama_path);

        match proxy_to_ollama(method, &ollama_url, req_body) {
            Ok((status, resp_body)) => {
                let response = format!(
                    "HTTP/1.1 {}\r\n{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    status, cors, resp_body.len(), resp_body
                );
                let _ = stream.write_all(response.as_bytes());
            }
            Err(e) => {
                let err_body = format!(r#"{{"error":"{}"}}"#, e);
                let response = format!(
                    "HTTP/1.1 502 Bad Gateway\r\n{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    cors, err_body.len(), err_body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        }
        return;
    }

    let (status, body) = if first_line.contains("/env") {
        let env = detect_environment();
        ("200 OK", serde_json::to_string(&env).unwrap_or_else(|_| "{}".to_string()))
    } else if first_line.contains("/start") {
        do_start_local_server()
    } else if first_line.contains("/stop") {
        do_stop_local_server()
    } else if first_line.contains("/download") {
        do_download_runtime()
    } else {
        ("404 Not Found", r#"{"error":"not found"}"#.to_string())
    };

    let response = format!(
        "HTTP/1.1 {}\r\n{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        status, cors, body.len(), body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn get_app_data_dir() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{}/Library/Application Support/com.sayknowmind.desktop", home)
}

fn do_start_local_server() -> (&'static str, String) {
    let app_data = get_app_data_dir();
    let web_dir = format!("{}/web-standalone", app_data);
    let server_js = format!("{}/server.js", web_dir);

    if !PathBuf::from(&server_js).exists() {
        return ("400 Bad Request", r#"{"error":"Server files not found. Download first."}"#.to_string());
    }

    // Find node
    let node = find_node(&app_data);
    if node.is_none() {
        return ("400 Bad Request", r#"{"error":"Node.js not found"}"#.to_string());
    }
    let node_bin = node.unwrap();

    // Generate or read auth secret
    let secret_file = format!("{}/auth-secret", app_data);
    let secret = if PathBuf::from(&secret_file).exists() {
        fs::read_to_string(&secret_file).unwrap_or_default().trim().to_string()
    } else {
        let s = Command::new("openssl").args(["rand", "-base64", "32"])
            .output().ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "fallback-desktop-secret".to_string());
        let _ = fs::create_dir_all(&app_data);
        let _ = fs::write(&secret_file, &s);
        s
    };

    let result = Command::new(&node_bin)
        .arg("server.js")
        .current_dir(&web_dir)
        .env("NODE_ENV", "production")
        .env("PGLITE_MODE", "true")
        .env("PORT", "3457")
        .env("BETTER_AUTH_SECRET", &secret)
        .env("BETTER_AUTH_URL", "http://localhost:3457")
        .env("NEXT_PUBLIC_APP_URL", "http://localhost:3457")
        .spawn();

    match result {
        Ok(child) => {
            ("200 OK", format!(r#"{{"success":true,"port":3457,"pid":{}}}"#, child.id()))
        }
        Err(e) => {
            ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, e))
        }
    }
}

fn do_stop_local_server() -> (&'static str, String) {
    let _ = Command::new("sh").args(["-c", "lsof -ti:3457 | xargs kill -9 2>/dev/null"]).output();
    ("200 OK", r#"{"success":true}"#.to_string())
}

fn do_download_runtime() -> (&'static str, String) {
    let app_data = get_app_data_dir();
    let node_dir = format!("{}/node", app_data);
    let node_bin = format!("{}/bin/node", node_dir);
    let web_dir = format!("{}/web-standalone", app_data);

    let _ = fs::create_dir_all(&app_data);

    // Download Node.js if not present
    if !PathBuf::from(&node_bin).exists() {
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
        let url = format!("https://nodejs.org/dist/v22.15.0/node-v22.15.0-darwin-{}.tar.gz", arch);
        let tar_path = format!("{}/node.tar.gz", app_data);

        let dl = Command::new("curl").args(["-fSL", "-o", &tar_path, &url]).output();
        if dl.is_err() || !dl.unwrap().status.success() {
            return ("500 Internal Server Error", r#"{"error":"Failed to download Node.js"}"#.to_string());
        }

        let _ = fs::create_dir_all(&node_dir);
        let extract = Command::new("tar")
            .args(["-xzf", &tar_path, "--strip-components=1", "-C", &node_dir])
            .output();
        let _ = fs::remove_file(&tar_path);

        if extract.is_err() || !extract.unwrap().status.success() {
            return ("500 Internal Server Error", r#"{"error":"Failed to extract Node.js"}"#.to_string());
        }
    }

    // Copy web-standalone if not present
    if !PathBuf::from(&format!("{}/server.js", web_dir)).exists() {
        // Check if already exists in common locations
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = vec![
            format!("{}/web-standalone", app_data),
        ];

        // If not found, tell user to build
        let found = candidates.iter().any(|c| PathBuf::from(&format!("{}/server.js", c)).exists());
        if !found {
            return ("200 OK", r#"{"status":"node_ready","serverNeeded":true,"message":"Node.js installed. Server files need to be built: cd apps/web && pnpm build"}"#.to_string());
        }
    }

    ("200 OK", r#"{"status":"complete"}"#.to_string())
}

/// Proxy HTTP request to local Ollama (bypasses browser CORS)
fn proxy_to_ollama(method: &str, url: &str, body: &str) -> Result<(&'static str, String), String> {
    use std::io::{BufRead, BufReader};

    let parsed = url.replace("http://127.0.0.1:11434", "");
    let mut conn = TcpStream::connect_timeout(
        &"127.0.0.1:11434".parse().unwrap(),
        Duration::from_millis(2000),
    ).map_err(|e| format!("Ollama not reachable: {}", e))?;

    let request = if body.is_empty() {
        format!("{} {} HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nConnection: close\r\n\r\n", method, parsed)
    } else {
        format!(
            "{} {} HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            method, parsed, body.len(), body
        )
    };

    conn.write_all(request.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
    conn.set_read_timeout(Some(Duration::from_secs(30))).ok();

    let mut reader = BufReader::new(conn);
    let mut response = String::new();

    // Read all data
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => response.push_str(&line),
            Err(_) => break,
        }
    }

    // Split headers from body
    if let Some(idx) = response.find("\r\n\r\n") {
        let body = response[idx + 4..].to_string();
        Ok(("200 OK", body))
    } else {
        Ok(("200 OK", response))
    }
}

fn find_node(app_data: &str) -> Option<String> {
    let bundled = format!("{}/node/bin/node", app_data);
    if PathBuf::from(&bundled).exists() {
        return Some(bundled);
    }
    // Check system
    let extra_paths = "/opt/homebrew/bin:/usr/local/bin:/usr/bin";
    Command::new("sh")
        .args(["-c", &format!("PATH={} which node", extra_paths)])
        .output().ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
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

            // Start local API server on port 3458 for frontend communication
            std::thread::spawn(|| {
                start_local_api_server(3458);
            });

            // Inject environment info into webview
            if let Some(window) = app.get_webview_window("main") {
                let env_data = detect_environment();
                let env_json = serde_json::to_string(&env_data).unwrap_or_else(|_| "{}".to_string());
                let js = format!(
                    "window.__SAYKNOW_ENV__ = {}; window.dispatchEvent(new CustomEvent('sayknow-env-ready'));",
                    env_json
                );
                let w = window.clone();
                std::thread::spawn(move || {
                    // Wait for page to load
                    std::thread::sleep(Duration::from_secs(3));
                    let _ = w.eval(&js);
                    // Open external links in system browser
                    let _ = w.eval(r#"
                        if (!window.__SKM_LINK_HANDLER__) {
                            window.__SKM_LINK_HANDLER__ = true;
                            document.addEventListener('click', (e) => {
                                const a = e.target.closest('a[href]');
                                if (!a) return;
                                const href = a.getAttribute('href');
                                if (!href || !href.startsWith('http')) return;
                                if (href.includes(window.location.host)) return;
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                    if (window.__TAURI_INTERNALS__) {
                                        window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: href });
                                    } else if (window.__TAURI__) {
                                        window.__TAURI__.invoke('plugin:shell|open', { path: href });
                                    }
                                } catch(err) {
                                    window.open(href, '_blank');
                                }
                            }, true);
                        }
                    "#);
                    eprintln!("[desktop] Environment injected into webview");
                });

                #[cfg(debug_assertions)]
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SayknowMind desktop app");
}
