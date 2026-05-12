// SayknowMind Desktop Application
// Build modes:
//   full (default) — Bundled Node.js + Next.js standalone server (offline)
//   lite           — Remote webview to https://sayknowmind.ypai.click (lightweight)

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
use tauri_plugin_shell::ShellExt;

// Command/Stdio are used by both full (server spawn) and lite (codex login
// spawn) — keep them outside the feature gate. Child is full-only.
use std::process::{Command, Stdio};
#[cfg(feature = "full")]
use std::process::Child;

const SERVER_PORT: u16 = 3457;
const REMOTE_URL: &str = "https://sayknowmind.ypai.click";
const REMOTE_HOST: &str = "sayknowmind.ypai.click";

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
        // Lite: check if remote is reachable. `parse::<SocketAddr>()` rejects
        // hostnames, so resolve via to_socket_addrs() first.
        use std::net::ToSocketAddrs;
        let reachable = format!("{}:443", REMOTE_HOST)
            .to_socket_addrs()
            .ok()
            .and_then(|mut it| it.next())
            .and_then(|addr| {
                std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(3)).ok()
            })
            .is_some();
        !reachable
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

/// One-shot snapshot of every prerequisite the OCP / Codex installers
/// touch. Exposed to the cloud webview so the settings card can show
/// a real preflight checklist instead of just "click install and hope".
#[derive(serde::Serialize, Default)]
pub struct SystemEnvCheck {
    pub node_version: Option<String>,        // e.g. "v22.5.0" or None if missing
    pub node_meets_required: bool,           // ≥22.5
    pub git_version: Option<String>,
    pub npm_version: Option<String>,
    pub claude_version: Option<String>,
    pub claude_authenticated: bool,
    pub openclaw_present: bool,              // ~/.openclaw/openclaw.json exists
    pub ocp_repo_installed: bool,            // ~/.sayknowmind/ocp/.git exists
    pub ocp_admin_key_present: bool,         // ~/.ocp/admin-key non-empty
    pub ocp_running: bool,                   // localhost:3456/health 200
    pub codex_authenticated: bool,           // ~/.codex/auth.json exists
}

fn parse_node_version(raw: &str) -> Option<(u32, u32)> {
    let s = raw.trim().trim_start_matches('v');
    let mut parts = s.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    Some((major, minor))
}

fn node_meets_22_5(version: &str) -> bool {
    parse_node_version(version)
        .map(|(maj, min)| maj > 22 || (maj == 22 && min >= 5))
        .unwrap_or(false)
}

/// Pick the best Node.js for our needs. We prefer a 22.5+ install so OCP's
/// server.mjs actually runs.
///
/// Discovery order — first match wins among "qualifying" candidates:
///   1. The shell PATH's `node`, but only if it's already 22.5+.
///   2. Highest version found across fnm / nvm / volta / brew formulas.
///   3. The shell PATH's `node` regardless of version (last resort — caller
///      gets to decide whether to run it anyway).
fn find_best_node() -> Option<(PathBuf, String)> {
    fn probe(path: &PathBuf) -> Option<String> {
        let raw = run_capture(path.to_str()?, &["--version"], None).ok()?;
        Some(raw.trim().to_string())
    }

    // 1) Shell PATH's node if it's already new enough.
    let path_node = which_in_shell_path("node");
    let path_version = path_node.as_ref().and_then(probe);
    if let (Some(p), Some(v)) = (path_node.clone(), path_version.clone()) {
        if node_meets_22_5(&v) {
            return Some((p, v));
        }
    }

    // 2) Scan known version managers + brew formulas for the highest 22.5+.
    let mut candidates: Vec<(PathBuf, (u32, u32), String)> = Vec::new();
    let home = dirs_next::home_dir();

    let mut scan_versions_dir = |dir: PathBuf, bin_subpath: &[&str]| {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy().to_string();
                let (maj, min) = match parse_node_version(&name_str) {
                    Some(v) => v,
                    None => continue,
                };
                if !(maj > 22 || (maj == 22 && min >= 5)) {
                    continue;
                }
                let mut bin = entry.path();
                for seg in bin_subpath {
                    bin.push(seg);
                }
                if bin.is_file() {
                    candidates.push((bin, (maj, min), name_str));
                }
            }
        }
    };

    if let Some(ref h) = home {
        scan_versions_dir(
            h.join(".local").join("share").join("fnm").join("node-versions"),
            &["installation", "bin", "node"],
        );
        scan_versions_dir(
            h.join(".nvm").join("versions").join("node"),
            &["bin", "node"],
        );
        scan_versions_dir(
            h.join(".volta").join("tools").join("image").join("node"),
            &["bin", "node"],
        );
    }

    // brew formula: node@22, node@23, node@24, …
    for prefix in ["/opt/homebrew/opt", "/usr/local/opt"] {
        for formula in &["node@22", "node@23", "node@24", "node@25"] {
            let bin = PathBuf::from(prefix).join(formula).join("bin").join("node");
            if bin.is_file() {
                if let Some(v) = probe(&bin) {
                    if let Some(parsed) = parse_node_version(&v) {
                        if parsed.0 > 22 || (parsed.0 == 22 && parsed.1 >= 5) {
                            candidates.push((bin, parsed, v));
                        }
                    }
                }
            }
        }
    }

    // Highest version wins.
    candidates.sort_by_key(|(_, v, _)| *v);
    if let Some((p, _, v)) = candidates.pop() {
        return Some((p, v));
    }

    // 3) Last resort: shell PATH's node even if too old.
    if let (Some(p), Some(v)) = (path_node, path_version) {
        return Some((p, v));
    }
    None
}

#[tauri::command]
fn system_env_check() -> SystemEnvCheck {
    let mut out = SystemEnvCheck::default();

    // --- node — auto-discovery across fnm / nvm / volta / brew ---
    if let Some((_, version)) = find_best_node() {
        out.node_meets_required = node_meets_22_5(&version);
        out.node_version = Some(version);
    }

    // --- git / npm — just version probes ---
    if let Ok(s) = run_capture("git", &["--version"], None) {
        out.git_version = Some(s.trim().to_string());
    }
    if let Ok(s) = run_capture("npm", &["--version"], None) {
        out.npm_version = Some(s.trim().to_string());
    }

    // --- claude CLI ---
    if which_in_shell_path("claude").is_some() {
        if let Ok(s) = run_capture("claude", &["--version"], None) {
            out.claude_version = Some(s.trim().to_string());
        }
        // `claude auth status` exits 0 when authenticated. Treat any
        // success as "authenticated"; we don't parse the message itself
        // because it changes across Claude CLI versions.
        out.claude_authenticated =
            run_capture("claude", &["auth", "status"], None).is_ok();
    }

    // --- OCP local state ---
    if let Some(home) = dirs_next::home_dir() {
        out.openclaw_present = home.join(".openclaw").join("openclaw.json").exists();
        out.ocp_repo_installed = ocp_install_dir()
            .map(|d| d.join(".git").exists())
            .unwrap_or(false);
        out.ocp_admin_key_present = home
            .join(".ocp")
            .join("admin-key")
            .metadata()
            .ok()
            .map(|m| m.len() > 0)
            .unwrap_or(false);
        out.codex_authenticated = home.join(".codex").join("auth.json").exists();
    }

    // --- proxy reachable? short timeout so the card doesn't hang ---
    out.ocp_running = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .ok()
        .and_then(|c| c.get("http://127.0.0.1:3456/health").send().ok())
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    out
}

/// OpenAI-compatible chat message — what the OCP proxy and Codex SDK both
/// expect on POST /v1/chat/completions.
#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(serde::Serialize)]
pub struct ChatReply {
    pub content: String,
    pub model: String,
}

/// Direct chat through the user's local OCP proxy. Cloud cascade can't see
/// localhost:3456, so the lite webview calls this Tauri command instead and
/// the cloud chat API stays out of the loop entirely.
#[tauri::command]
async fn chat_via_ocp(
    messages: Vec<ChatMessage>,
    model: Option<String>,
) -> Result<ChatReply, String> {
    let chosen_model = model.unwrap_or_else(|| "claude-opus-4-7".to_string());
    tauri::async_runtime::spawn_blocking(move || -> Result<ChatReply, String> {
        // OCP exposes the OpenAI shape with no API key required from the
        // client side — `auth-mode=none` is the default we install with.
        let body = serde_json::json!({
            "model": chosen_model,
            "messages": messages,
            "stream": false,
        });
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("http client: {}", e))?;
        let res = client
            .post("http://127.0.0.1:3456/v1/chat/completions")
            .header("Content-Type", "application/json")
            .body(serde_json::to_vec(&body).unwrap_or_default())
            .send()
            .map_err(|e| format!("OCP fetch failed: {} — is the proxy running?", e))?;
        let status = res.status();
        let raw = res.text().unwrap_or_default();
        if !status.is_success() {
            return Err(format!("OCP returned {}: {}", status, raw.chars().take(500).collect::<String>()));
        }
        let parsed: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("OCP response not JSON: {} — body: {}", e, raw.chars().take(200).collect::<String>()))?;
        let content = parsed["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| format!("OCP response missing choices[0].message.content: {}", raw.chars().take(300).collect::<String>()))?
            .to_string();
        let returned_model = parsed["model"].as_str().unwrap_or(&chosen_model).to_string();
        Ok(ChatReply { content, model: returned_model })
    })
    .await
    .map_err(|e| format!("join: {}", e))?
}

/// List the OCP proxy's available models so the picker has something real to
/// show. Falls back to a stock list if the endpoint is unreachable.
#[tauri::command]
async fn list_ocp_models() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<String>, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|e| format!("http: {}", e))?;
        let res = client
            .get("http://127.0.0.1:3456/v1/models")
            .send()
            .map_err(|e| format!("OCP /v1/models failed: {}", e))?;
        if !res.status().is_success() {
            return Err(format!("OCP /v1/models returned {}", res.status()));
        }
        let body: serde_json::Value = res.json().map_err(|e| format!("parse: {}", e))?;
        let arr = body["data"].as_array().ok_or("no data[]")?;
        let mut ids: Vec<String> = arr
            .iter()
            .filter_map(|m| m["id"].as_str().map(str::to_string))
            .collect();
        if ids.is_empty() {
            ids = vec![
                "claude-opus-4-7".into(),
                "claude-sonnet-4-6".into(),
                "claude-haiku-4-5".into(),
            ];
        }
        Ok(ids)
    })
    .await
    .map_err(|e| format!("join: {}", e))?
}

/// Open `claude auth login` on the user's machine. The Claude CLI opens its
/// own OAuth flow in the system browser; we just kick it off and detach.
#[tauri::command]
fn claude_auth_login() -> Result<u32, String> {
    let claude = which_in_shell_path("claude")
        .ok_or_else(|| "Claude CLI not on PATH. Install it first (npm install -g @anthropic-ai/claude-code).".to_string())?;
    Command::new(&claude)
        .args(["auth", "login"])
        .env("PATH", resolve_shell_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|c| c.id())
        .map_err(|e| format!("Failed to spawn claude: {}", e))
}

/// Best-effort `npm install -g @anthropic-ai/claude-code`. Used by the
/// preflight UI's "Fix automatically" button when the CLI is missing.
#[tauri::command]
async fn install_claude_cli() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        run_capture(
            "npm",
            &["install", "-g", "@anthropic-ai/claude-code"],
            None,
        )
    })
    .await
    .map_err(|e| format!("join: {}", e))?
}

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

/// Spawn `codex login` on the user's machine. The CLI opens a localhost
/// callback server and pops the system browser at the ChatGPT OAuth page;
/// `~/.codex/auth.json` is written on success.
///
/// Resolution order:
///   1. Tauri sidecar `codex` (bundled at build time, see fetch-binaries.sh)
///   2. `codex` on PATH (developer-installed)
///   3. `npx -y @openai/codex login` (last-resort, needs Node on the machine)
///
/// Returns once the child has been spawned — callers should poll
/// `codex_status()` for completion via the `~/.codex/auth.json` file.
#[tauri::command]
fn exec_codex_login(app: tauri::AppHandle) -> Result<u32, String> {
    // 1) Try the bundled sidecar first. This is the only path that "just
    //    works" for users who haven't installed Codex on their machine.
    if let Ok(cmd) = app.shell().sidecar("codex") {
        match cmd.args(["login"]).spawn() {
            Ok((mut rx, child)) => {
                let pid = child.pid();
                // Drain the event stream so the child's stdio pipes don't
                // back-pressure into a deadlock while the OAuth flow waits
                // on the system browser.
                std::thread::spawn(move || {
                    while rx.blocking_recv().is_some() {}
                });
                return Ok(pid);
            }
            Err(e) => {
                eprintln!("[codex] bundled sidecar spawn failed, falling back to PATH/npx: {e}");
            }
        }
    }

    // 2/3) Legacy PATH lookup → npx fallback. Kept for dev builds and for
    //      users who already installed Codex outside the bundle.
    //      which_in_shell_path so brew/volta-installed codex (or npx) is
    //      actually visible — see resolve_shell_path() comments.
    let (program, args): (PathBuf, Vec<&str>) = if let Some(codex) = which_in_shell_path("codex") {
        (codex, vec!["login"])
    } else if let Some(npx) = which_in_shell_path("npx") {
        (npx, vec!["-y", "@openai/codex", "login"])
    } else {
        return Err(
            "Neither bundled codex sidecar, system `codex`, nor `npx` was found. Install Node 22+ or reinstall the app.".to_string(),
        );
    };

    Command::new(&program)
        .args(&args)
        .env("PATH", resolve_shell_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|child| child.id())
        .map_err(|e| format!("Failed to spawn {}: {}", program.display(), e))
}

#[derive(serde::Serialize)]
struct OcpProvisionResult {
    key: String,
}

/// Mint a "sayknowmind"-named API key against the user's local OCP proxy
/// using the admin-key file. Caller persists the key wherever it needs to
/// (typically the cloud DB via /api/integrations/ocp/status).
#[tauri::command]
fn provision_ocp_key() -> Result<OcpProvisionResult, String> {
    let admin = read_ocp_admin_key().ok_or_else(|| {
        "OCP admin-key not found at ~/.ocp/admin-key — install and start OCP first".to_string()
    })?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;

    // Best-effort revoke any prior key of the same name so we always own a
    // fresh secret (we never see the existing one's plaintext anyway).
    let _ = client
        .delete("http://127.0.0.1:3456/api/keys/sayknowmind")
        .bearer_auth(&admin)
        .send();

    let res = client
        .post("http://127.0.0.1:3456/api/keys")
        .bearer_auth(&admin)
        .json(&serde_json::json!({ "name": "sayknowmind" }))
        .send()
        .map_err(|e| format!("OCP provision failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("OCP provision HTTP {}", res.status()));
    }
    let body: serde_json::Value = res
        .json()
        .map_err(|e| format!("OCP response parse failed: {}", e))?;
    let key = body
        .get("key")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "OCP response had no plaintext key".to_string())?
        .to_string();
    Ok(OcpProvisionResult { key })
}

/// Result of an `ocp_install` run. `step` is the last step that ran (or
/// failed); the frontend can surface this so the user sees what stalled.
#[derive(serde::Serialize, Debug, Clone)]
pub struct OcpInstallResult {
    pub ok: bool,
    pub step: String,
    pub message: String,
    pub admin_key_path: String,
}

fn ocp_install_dir() -> Option<PathBuf> {
    dirs_next::home_dir().map(|h| h.join(".sayknowmind").join("ocp"))
}

/// Resolve a usable PATH for child processes.
///
/// macOS GUI apps inherit a tiny launchd-default PATH (basically
/// `/usr/bin:/bin:/usr/sbin:/sbin`), which means brew, volta, fnm, nvm,
/// and pnpm installs are invisible — even though `node`, `git`, `claude`
/// are clearly on the user's shell PATH when they open Terminal.
///
/// We run the user's login shell once and capture its `$PATH`, then merge
/// that with a hard-coded set of well-known locations as a safety net.
/// The result is cached for the lifetime of the process.
fn resolve_shell_path() -> String {
    use std::sync::OnceLock;
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mut parts: Vec<String> = Vec::new();

            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            if let Ok(out) = Command::new(&shell)
                .args(["-l", "-i", "-c", "echo $PATH"])
                .output()
            {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        parts.push(s);
                    }
                }
            }

            // Hardcoded safety net. Order matters — brew prefixes first so
            // they win over /usr/bin/node (if a stale one ever lands there).
            parts.push("/opt/homebrew/bin".into());      // Apple Silicon brew
            parts.push("/opt/homebrew/sbin".into());
            parts.push("/usr/local/bin".into());          // Intel brew, npm -g default
            parts.push("/usr/local/sbin".into());
            if let Ok(home) = std::env::var("HOME") {
                parts.push(format!("{}/.volta/bin", home));
                parts.push(format!("{}/.fnm", home));
                parts.push(format!("{}/.local/bin", home));
                parts.push(format!("{}/.cargo/bin", home));
            }
            parts.push("/usr/bin".into());
            parts.push("/bin".into());
            parts.push("/usr/sbin".into());
            parts.push("/sbin".into());

            // Dedupe while preserving order.
            let mut seen = std::collections::HashSet::new();
            let merged: Vec<String> = parts
                .into_iter()
                .flat_map(|chunk| chunk.split(':').map(str::to_string).collect::<Vec<_>>())
                .filter(|p| !p.is_empty() && seen.insert(p.clone()))
                .collect();
            merged.join(":")
        })
        .clone()
}

/// `which` that honours `resolve_shell_path()` instead of relying on the
/// launchd-inherited PATH. Returns the absolute binary path when found.
fn which_in_shell_path(program: &str) -> Option<PathBuf> {
    let path = resolve_shell_path();
    for dir in path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn run_capture(program: &str, args: &[&str], cwd: Option<&PathBuf>) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.env("PATH", resolve_shell_path());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Failed to spawn {}: {}", program, e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "{} {:?} exited {}: {}{}",
            program,
            args,
            out.status,
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Install OCP (Open Claude Proxy) onto the user's machine and start it.
///
/// Steps:
///   1. Verify node + git are on PATH.
///   2. Clone (or update) the OCP repo into ~/.sayknowmind/ocp.
///   3. `npm install` inside that checkout.
///   4. Install the Anthropic Claude CLI globally if it isn't already.
///   5. `node setup.mjs` to provision ~/.ocp/admin-key.
///   6. Spawn `node server.mjs` detached so the proxy survives this call.
///
/// Long-running — callers should kick this off from a background task and
/// poll `ocp_status()` for readiness. Tokio's blocking pool keeps the IPC
/// runtime responsive.
#[tauri::command]
async fn ocp_install() -> Result<OcpInstallResult, String> {
    tauri::async_runtime::spawn_blocking(ocp_install_sync)
        .await
        .map_err(|e| format!("ocp_install join: {}", e))?
}

fn ocp_install_sync() -> Result<OcpInstallResult, String> {
    let admin_key_path = dirs_next::home_dir()
        .map(|h| h.join(".ocp").join("admin-key"))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let make = |step: &str, msg: &str| OcpInstallResult {
        ok: false,
        step: step.to_string(),
        message: msg.to_string(),
        admin_key_path: admin_key_path.clone(),
    };

    // 1) preflight — pick a Node ≥22.5 across fnm/nvm/volta/brew. The user's
    //    shell default may be an older version (e.g. v20) even if 22+ is
    //    installed via fnm — that's the most common reason ocp_install used
    //    to silently fail.
    let (node_path, node_version) = match find_best_node() {
        Some((p, v)) if node_meets_22_5(&v) => (p, v),
        Some((_, v)) => {
            return Err(format!(
                "No Node ≥22.5 found ({} is too old). OCP's server.mjs requires Node 22.5+. Install via fnm/brew/nodejs.org and retry.",
                v
            ));
        }
        None => {
            return Err(
                "Node.js not found anywhere (PATH, fnm, nvm, volta, brew). Install Node 22.5+ and retry."
                    .to_string(),
            );
        }
    };
    eprintln!("[ocp_install] using node {} at {}", node_version, node_path.display());

    if run_capture("git", &["--version"], None).is_err() {
        return Err(serde_json::to_string(&make(
            "preflight",
            "git not found on PATH. Install git and retry.",
        ))
        .unwrap_or_else(|_| "git not found".into()));
    }

    let ocp_dir = ocp_install_dir().ok_or_else(|| "no home dir".to_string())?;
    if let Some(parent) = ocp_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create ~/.sayknowmind: {}", e))?;
    }

    // 2) clone or update
    if ocp_dir.join(".git").exists() {
        run_capture("git", &["pull", "--ff-only"], Some(&ocp_dir))
            .map_err(|e| format!("git pull failed: {}", e))?;
    } else {
        run_capture(
            "git",
            &[
                "clone",
                "--depth=1",
                "https://github.com/dtzp555-max/ocp.git",
                ocp_dir.to_string_lossy().as_ref(),
            ],
            None,
        )
        .map_err(|e| format!("git clone failed: {}", e))?;
    }

    // 3) npm install
    run_capture("npm", &["install", "--no-audit", "--no-fund"], Some(&ocp_dir))
        .map_err(|e| format!("npm install failed: {}", e))?;

    // 4) Claude CLI — best-effort. OCP requires `claude -p` on PATH; if the
    //    user already has it we skip, otherwise try the npm install. A
    //    failure here is non-fatal: the user can install Claude themselves.
    //    Use which_in_shell_path so the user's brew/volta/nvm-installed
    //    `claude` is visible to us — the launchd-default PATH that GUI
    //    apps inherit on macOS cannot see those.
    let claude_msg = if which_in_shell_path("claude").is_some() {
        "claude CLI already present".to_string()
    } else {
        match run_capture(
            "npm",
            &["install", "-g", "@anthropic-ai/claude-code"],
            None,
        ) {
            Ok(_) => "claude CLI installed via npm -g".to_string(),
            Err(e) => format!("claude CLI auto-install skipped: {} — install manually then re-run setup", e),
        }
    };

    // 5) Provision an admin key. setup.mjs reads $OCP_ADMIN_KEY when
    //    available and bakes it into the launchd plist; without it the
    //    proxy's admin endpoints (used by provision_ocp_key) stay
    //    disabled. We persist the same key at ~/.ocp/admin-key so our
    //    own provision/revoke commands can reach it.
    let admin_key = {
        let home = dirs_next::home_dir().ok_or_else(|| "no home dir".to_string())?;
        let ocp_state_dir = home.join(".ocp");
        let key_file = ocp_state_dir.join("admin-key");
        if let Some(existing) = fs::read_to_string(&key_file)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            existing
        } else {
            use std::io::Read;
            let mut bytes = [0u8; 32];
            std::fs::File::open("/dev/urandom")
                .and_then(|mut f| f.read_exact(&mut bytes))
                .map_err(|e| format!("urandom: {}", e))?;
            let key: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
            fs::create_dir_all(&ocp_state_dir).map_err(|e| format!("mkdir ~/.ocp: {}", e))?;
            fs::write(&key_file, &key).map_err(|e| format!("write admin-key: {}", e))?;
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&key_file, fs::Permissions::from_mode(0o600));
            key
        }
    };

    // 6) Run setup.mjs with --no-start using the Node ≥22.5 we resolved
    //    above. setup.mjs records `process.execPath` style decisions into
    //    the launchd plist, so picking the right interpreter here is what
    //    keeps the daemon working after reboot. We also push the new
    //    node's bin dir to the front of PATH so any child spawn (npm,
    //    claude, etc.) sees the same toolchain.
    let node_bin_dir = node_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let augmented_path = format!("{}:{}", node_bin_dir, resolve_shell_path());
    let mut setup_cmd = Command::new(&node_path);
    setup_cmd
        .args(["setup.mjs", "--no-start"])
        .current_dir(&ocp_dir)
        .env("PATH", &augmented_path)
        .env("OCP_ADMIN_KEY", &admin_key);
    let setup_out = setup_cmd
        .output()
        .map_err(|e| format!("spawn setup.mjs: {}", e))?;
    if !setup_out.status.success() {
        let stderr = String::from_utf8_lossy(&setup_out.stderr);
        let stdout = String::from_utf8_lossy(&setup_out.stdout);
        return Err(format!(
            "setup.mjs exited {}: {} {}",
            setup_out.status,
            stdout.trim(),
            stderr.trim()
        ));
    }

    // 7) Kick the launchd job once so the user doesn't have to wait for
    //    a re-login. `launchctl start` is idempotent — if the proxy is
    //    already running it's a no-op.
    let _ = Command::new("launchctl")
        .args(["start", "dev.ocp.proxy"])
        .output();

    Ok(OcpInstallResult {
        ok: true,
        step: "started".to_string(),
        message: format!("OCP installed at {} — {}", ocp_dir.display(), claude_msg),
        admin_key_path,
    })
}

/// Revoke the SayKnowMind-named key at OCP. Idempotent — silent on 404.
#[tauri::command]
fn revoke_ocp_key() -> Result<(), String> {
    let admin = match read_ocp_admin_key() {
        Some(k) => k,
        None => return Ok(()),
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client init failed: {}", e))?;
    let res = client
        .delete("http://127.0.0.1:3456/api/keys/sayknowmind")
        .bearer_auth(&admin)
        .send()
        .map_err(|e| format!("OCP revoke failed: {}", e))?;
    if res.status().is_success() || res.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(format!("OCP revoke HTTP {}", res.status()))
    }
}

fn read_ocp_admin_key() -> Option<String> {
    let home = dirs_next::home_dir()?;
    let path = home.join(".ocp").join("admin-key");
    fs::read_to_string(&path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
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
        || host == REMOTE_HOST
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
            exec_codex_login,
            provision_ocp_key,
            revoke_ocp_key,
            ocp_install,
            system_env_check,
            claude_auth_login,
            install_claude_cli,
            chat_via_ocp,
            list_ocp_models,
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

        // Inject desktop env + intercept window.open / target=_blank / middle-clicks
        // so external links always hand off to the system browser instead of
        // silently being swallowed by Tauri's popup blocker.
        let env_data = detect_environment();
        let env_json = serde_json::to_string(&env_data).unwrap_or_else(|_| "{}".to_string());
        let init_js = format!(
            r#"
            window.__SAYKNOW_ENV__ = {env};
            window.__TAURI_DESKTOP__ = true;

            (function() {{
              const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "{remote_host}"]);
              function isExternal(href) {{
                try {{
                  const u = new URL(href, location.href);
                  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
                  return !ALLOWED_HOSTS.has(u.host);
                }} catch {{ return false; }}
              }}

              // window.open() and target=_blank both end up calling window.open
              // under the hood. Pushing the URL into location.href lets the
              // Rust on_navigation handler decide whether to allow or open
              // externally — same path as a direct anchor click.
              const nativeOpen = window.open.bind(window);
              window.open = function(url, target, features) {{
                if (typeof url === "string" && isExternal(url)) {{
                  window.location.href = url;
                  return null;
                }}
                return nativeOpen(url, target, features);
              }};

              // Catch <a target="_blank"> + Cmd/Ctrl-click + middle-click on
              // external anchors that the browser would otherwise want to
              // open in a popup or a new tab.
              document.addEventListener("click", function(e) {{
                const a = e.target && e.target.closest && e.target.closest("a[href]");
                if (!a) return;
                const href = a.getAttribute("href");
                if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
                if (isExternal(href)) {{
                  e.preventDefault();
                  e.stopPropagation();
                  window.location.href = a.href;
                }}
              }}, true);

              document.addEventListener("auxclick", function(e) {{
                if (e.button !== 1) return; // middle-click
                const a = e.target && e.target.closest && e.target.closest("a[href]");
                if (!a) return;
                if (isExternal(a.href)) {{
                  e.preventDefault();
                  window.location.href = a.href;
                }}
              }}, true);
            }})();
            "#,
            env = env_json,
            remote_host = REMOTE_HOST,
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
