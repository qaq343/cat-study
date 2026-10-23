use serde::{Deserialize, Serialize};
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, State, Wry,
};

const MIN_VISIBLE_PX: i32 = 35;
const DEFAULT_OFFSET: f64 = 0.43;
const TOP_BOTTOM_VISIBLE_PX: i32 = 42;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompanionPlacement {
    version: u8,
    monitor_name: Option<String>,
    monitor_x: i32,
    monitor_y: i32,
    edge: String,
    offset: f64,
}

struct RuntimeState {
    session_state: Mutex<String>,
    session_menu: Mutex<Option<MenuItem<Wry>>>,
    companion_expected: AtomicBool,
    dragging: AtomicBool,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            session_state: Mutex::new("IDLE".into()),
            session_menu: Mutex::new(None),
            companion_expected: AtomicBool::new(false),
            dragging: AtomicBool::new(false),
        }
    }
}

fn placement_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("companion-placement.json"))
}

fn legacy_position_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("companion-position.txt"))
}

fn load_placement(app: &tauri::AppHandle) -> Option<CompanionPlacement> {
    let placement: CompanionPlacement = serde_json::from_str(&fs::read_to_string(placement_file(app)?).ok()?).ok()?;
    let valid_edge = matches!(placement.edge.as_str(), "left" | "right" | "top" | "bottom");
    let valid_offset = placement.offset.is_finite() && (0.0..=1.0).contains(&placement.offset);
    (placement.version == 1 && valid_edge && valid_offset).then_some(placement)
}

fn save_placement(app: &tauri::AppHandle, placement: &CompanionPlacement) -> Result<(), String> {
    let file = placement_file(app).ok_or("app data directory missing")?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(placement).map_err(|e| e.to_string())?;
    fs::write(file, json).map_err(|e| e.to_string())
}

fn default_placement(monitor: &Monitor) -> CompanionPlacement {
    CompanionPlacement {
        version: 1,
        monitor_name: monitor.name().cloned(),
        monitor_x: monitor.position().x,
        monitor_y: monitor.position().y,
        edge: "right".into(),
        offset: DEFAULT_OFFSET,
    }
}

fn select_monitor(monitors: &[Monitor], placement: &CompanionPlacement) -> Option<Monitor> {
    placement.monitor_name.as_ref().and_then(|name| {
        monitors.iter().find(|monitor| monitor.name() == Some(name)).cloned()
    }).or_else(|| {
        monitors.iter().find(|monitor| {
            monitor.position().x == placement.monitor_x && monitor.position().y == placement.monitor_y
        }).cloned()
    })
}

fn primary_monitor(app: &tauri::AppHandle) -> Result<Monitor, String> {
    app.primary_monitor().map_err(|e| e.to_string())?.ok_or("primary monitor missing".into())
}

fn normalize_edge(edge: &str) -> &str {
    match edge { "left" | "right" | "top" | "bottom" => edge, _ => "right" }
}

fn apply_placement(app: &tauri::AppHandle, placement: &CompanionPlacement) -> Result<CompanionPlacement, String> {
    let cat = app.get_webview_window("companion").ok_or("companion window missing")?;
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor = select_monitor(&monitors, placement).unwrap_or(primary_monitor(app)?);
    let edge = normalize_edge(&placement.edge).to_string();
    let offset = placement.offset.clamp(0.0, 1.0);
    let logical_size = if edge == "top" || edge == "bottom" { LogicalSize::new(100.0, 90.0) } else { LogicalSize::new(105.0, 110.0) };
    cat.set_size(logical_size).map_err(|e| e.to_string())?;
    let window_size = cat.outer_size().map_err(|e| e.to_string())?;
    let area = monitor.work_area();
    let left = area.position.x;
    let top = area.position.y;
    let right = left + area.size.width as i32;
    let bottom = top + area.size.height as i32;
    let travel_x = (area.size.width as i32 - window_size.width as i32).max(0);
    let travel_y = (area.size.height as i32 - window_size.height as i32).max(0);
    let visible = TOP_BOTTOM_VISIBLE_PX.min(window_size.height as i32 - 1);
    let (x, y) = match edge.as_str() {
        "left" => (left, top + (travel_y as f64 * offset).round() as i32),
        "top" => (left + (travel_x as f64 * offset).round() as i32, top - window_size.height as i32 + visible),
        "bottom" => (left + (travel_x as f64 * offset).round() as i32, bottom - visible),
        _ => (right - window_size.width as i32, top + (travel_y as f64 * offset).round() as i32),
    };
    cat.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    let normalized = CompanionPlacement {
        version: 1,
        monitor_name: monitor.name().cloned(),
        monitor_x: monitor.position().x,
        monitor_y: monitor.position().y,
        edge,
        offset,
    };
    let _ = app.emit_to("companion", "companion-placement-changed", normalized.edge.clone());
    Ok(normalized)
}

fn has_safe_visible_area(app: &tauri::AppHandle) -> Result<bool, String> {
    let cat = app.get_webview_window("companion").ok_or("companion window missing")?;
    let pos = cat.outer_position().map_err(|e| e.to_string())?;
    let size = cat.outer_size().map_err(|e| e.to_string())?;
    let cat_right = pos.x + size.width as i32;
    let cat_bottom = pos.y + size.height as i32;
    for monitor in app.available_monitors().map_err(|e| e.to_string())? {
        let area = monitor.work_area();
        let area_right = area.position.x + area.size.width as i32;
        let area_bottom = area.position.y + area.size.height as i32;
        let visible_width = cat_right.min(area_right) - pos.x.max(area.position.x);
        let visible_height = cat_bottom.min(area_bottom) - pos.y.max(area.position.y);
        if visible_width >= MIN_VISIBLE_PX && visible_height >= MIN_VISIBLE_PX { return Ok(true); }
    }
    Ok(false)
}

fn legacy_placement(app: &tauri::AppHandle) -> Option<CompanionPlacement> {
    let value = fs::read_to_string(legacy_position_file(app)?).ok()?;
    let (x, y) = value.trim().split_once(',')?;
    let x: i32 = x.parse().ok()?;
    let y: i32 = y.parse().ok()?;
    let monitor = app.available_monitors().ok()?.into_iter().min_by_key(|monitor| {
        let area = monitor.work_area();
        let center_x = area.position.x + area.size.width as i32 / 2;
        let center_y = area.position.y + area.size.height as i32 / 2;
        (center_x - x).abs() + (center_y - y).abs()
    })?;
    let area = monitor.work_area();
    let right = area.position.x + area.size.width as i32;
    let edge = if (x - area.position.x).abs() <= (x - right).abs() { "left" } else { "right" };
    let offset = ((y - area.position.y) as f64 / area.size.height.max(1) as f64).clamp(0.0, 1.0);
    Some(CompanionPlacement { version: 1, monitor_name: monitor.name().cloned(), monitor_x: monitor.position().x, monitor_y: monitor.position().y, edge: edge.into(), offset })
}

fn ensure_companion_position(app: &tauri::AppHandle) -> Result<CompanionPlacement, String> {
    let fallback = default_placement(&primary_monitor(app)?);
    let preferred = match placement_file(app) {
        Some(file) if file.exists() => load_placement(app).unwrap_or_else(|| fallback.clone()),
        _ => legacy_placement(app).unwrap_or_else(|| fallback.clone()),
    };
    let mut applied = apply_placement(app, &preferred)?;
    if !has_safe_visible_area(app)? {
        applied = apply_placement(app, &default_placement(&primary_monitor(app)?))?;
    }
    save_placement(app, &applied)?;
    Ok(applied)
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(v_key: i32) -> i16;
    fn ShowWindow(hwnd: *mut std::ffi::c_void, command: i32) -> i32;
}

#[cfg(target_os = "windows")]
fn left_button_pressed() -> bool { unsafe { (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0 } }

#[cfg(target_os = "windows")]
fn force_show_without_activation(window: &tauri::WebviewWindow) {
    // SW_SHOWNOACTIVATE also repairs the rare WebView2/Win32 state mismatch
    // where Tauri reports visible while the native HWND is still hidden.
    if let Ok(hwnd) = window.hwnd() { unsafe { ShowWindow(hwnd.0, 4); } }
}

#[cfg(not(target_os = "windows"))]
fn force_show_without_activation(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "windows"))]
fn left_button_pressed() -> bool { false }

fn snap_companion_after_drag(app: &tauri::AppHandle) -> Result<String, String> {
    let cat = app.get_webview_window("companion").ok_or("companion window missing")?;
    let cursor = cat.cursor_position().map_err(|e| e.to_string())?;
    let monitor = cat.monitor_from_point(cursor.x, cursor.y).map_err(|e| e.to_string())?.or(cat.current_monitor().map_err(|e| e.to_string())?).unwrap_or(primary_monitor(app)?);
    let area = monitor.work_area();
    let left = area.position.x as f64;
    let top = area.position.y as f64;
    let right = left + area.size.width as f64;
    let bottom = top + area.size.height as f64;
    let distances = [("left", (cursor.x - left).abs()), ("right", (cursor.x - right).abs()), ("top", (cursor.y - top).abs()), ("bottom", (cursor.y - bottom).abs())];
    let edge = distances.into_iter().min_by(|a, b| a.1.total_cmp(&b.1)).map(|item| item.0).unwrap_or("right");
    let offset = if edge == "left" || edge == "right" { ((cursor.y - top) / area.size.height.max(1) as f64).clamp(0.0, 1.0) } else { ((cursor.x - left) / area.size.width.max(1) as f64).clamp(0.0, 1.0) };
    let placement = CompanionPlacement { version: 1, monitor_name: monitor.name().cloned(), monitor_x: monitor.position().x, monitor_y: monitor.position().y, edge: edge.into(), offset };
    let applied = apply_placement(app, &placement)?;
    save_placement(app, &applied)?;
    Ok(applied.edge)
}

#[tauri::command]
fn get_companion_edge(app: tauri::AppHandle) -> Result<String, String> {
    Ok(ensure_companion_position(&app)?.edge)
}

#[tauri::command]
fn drag_companion(app: tauri::AppHandle, state: State<'_, RuntimeState>) -> Result<(), String> {
    let cat = app.get_webview_window("companion").ok_or("companion window missing")?;
    state.dragging.store(true, Ordering::SeqCst);
    if let Err(error) = cat.start_dragging() {
        state.dragging.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    let handle = app.clone();
    thread::spawn(move || {
        while left_button_pressed() { thread::sleep(Duration::from_millis(20)); }
        let _ = snap_companion_after_drag(&handle);
        handle.state::<RuntimeState>().dragging.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
fn finish_companion_drag(app: tauri::AppHandle, state: State<'_, RuntimeState>) -> Result<String, String> {
    let result = snap_companion_after_drag(&app);
    state.dragging.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn reset_companion_position(app: tauri::AppHandle) -> Result<String, String> {
    let placement = default_placement(&primary_monitor(&app)?);
    let applied = apply_placement(&app, &placement)?;
    save_placement(&app, &applied)?;
    if let Some(cat) = app.get_webview_window("companion") { cat.show().map_err(|e| e.to_string())?; }
    Ok(applied.edge)
}

#[tauri::command]
fn enter_companion(app: tauri::AppHandle, state: State<'_, RuntimeState>) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    let cat = app.get_webview_window("companion").ok_or("companion window missing")?;
    state.companion_expected.store(true, Ordering::SeqCst);
    ensure_companion_position(&app)?;
    cat.set_always_on_top(true).map_err(|e| e.to_string())?;
    cat.show().map_err(|e| e.to_string())?;
    main.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn restore_main(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    let state = app.state::<RuntimeState>();
    state.companion_expected.store(false, Ordering::SeqCst);
    if let Some(cat) = app.get_webview_window("companion") { cat.hide().map_err(|e| e.to_string())?; }
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}

fn toggle_companion(app: tauri::AppHandle) -> Result<(), String> {
    let cat = app.get_webview_window("companion").ok_or("companion window missing")?;
    if cat.is_visible().map_err(|e| e.to_string())? { restore_main(app) } else {
        let state = app.state::<RuntimeState>();
        enter_companion(app.clone(), state)
    }
}

#[tauri::command]
fn sync_session_state(app: tauri::AppHandle, state: State<'_, RuntimeState>, session_state: String) -> Result<(), String> {
    let normalized = match session_state.as_str() { "STUDYING" => "STUDYING", "PAUSED" => "PAUSED", _ => "IDLE" };
    *state.session_state.lock().map_err(|_| "session state lock poisoned")? = normalized.into();
    if let Some(item) = state.session_menu.lock().map_err(|_| "session menu lock poisoned")?.as_ref() {
        item.set_text(if normalized == "STUDYING" { "暂停学习" } else if normalized == "PAUSED" { "继续学习" } else { "暂停 / 继续学习" }).map_err(|e| e.to_string())?;
        item.set_enabled(normalized != "IDLE").map_err(|e| e.to_string())?;
    }
    app.emit_to("companion", "session-state-changed", normalized).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_main_view(app: tauri::AppHandle, view: String) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    let height = if view == "detail" { 800.0 } else { 690.0 };
    main.set_size(LogicalSize::new(720.0, height)).map_err(|e| e.to_string())
}

fn start_companion_watchdog(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(4));
        let state = app.state::<RuntimeState>();
        let active = state.session_state.lock().map(|value| value.as_str() != "IDLE").unwrap_or(false);
        if !active || !state.companion_expected.load(Ordering::SeqCst) || state.dragging.load(Ordering::SeqCst) { continue; }
        if let Some(cat) = app.get_webview_window("companion") {
            if !has_safe_visible_area(&app).unwrap_or(false) {
                let _ = ensure_companion_position(&app);
            }
            // Windows can leave a transparent WebView physically hidden while its
            // cached visibility flag still says true. Reasserting these two flags is
            // idempotent and does not focus or activate the companion window.
            let _ = cat.set_always_on_top(true);
            let _ = cat.show();
            force_show_without_activation(&cat);
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| { let _ = restore_main(app.clone()); }))
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "打开小猫学习进度", true, None::<&str>)?;
            let session_toggle = MenuItem::with_id(app, "session_toggle", "暂停 / 继续学习", false, None::<&str>)?;
            let toggle_cat = MenuItem::with_id(app, "toggle_cat", "显示 / 隐藏陪伴猫", true, None::<&str>)?;
            let reset_cat = MenuItem::with_id(app, "reset_cat", "重置小猫位置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            *app.state::<RuntimeState>().session_menu.lock().expect("session menu lock") = Some(session_toggle.clone());
            let menu = Menu::with_items(app, &[&open, &session_toggle, &toggle_cat, &reset_cat, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("小猫学习进度");
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "open" => { let _ = restore_main(app.clone()); }
                "session_toggle" => { let _ = app.emit_to("main", "session-control-request", "toggle"); }
                "toggle_cat" => { let _ = toggle_companion(app.clone()); }
                "reset_cat" => { let _ = reset_companion_position(app.clone()); }
                "quit" => app.exit(0),
                _ => {}
            }).build(app)?;
            let _ = ensure_companion_position(app.handle());
            start_companion_watchdog(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![enter_companion, restore_main, drag_companion, finish_companion_drag, reset_companion_position, get_companion_edge, sync_session_state, set_main_view])
        .run(tauri::generate_context!())
        .expect("failed to run cat-study");
}
