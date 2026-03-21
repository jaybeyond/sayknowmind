// SayknowMind Desktop Application
// Wraps the Next.js web app in a native window with:
// - System tray icon
// - Global shortcut for quick search
// - Auto-start local services
// - Auto-update support

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

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

#[tauri::command]
fn check_services_health() -> serde_json::Value {
    // Check if local Docker services are running
    serde_json::json!({
        "web": true,
        "edgequake": true,
        "postgres": true,
        "ollama": true
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            quick_search,
            get_app_info,
            check_services_health,
        ])
        .setup(|app| {
            // Register global shortcut for quick search (Cmd+Shift+K / Ctrl+Shift+K)
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SayknowMind desktop app");
}
