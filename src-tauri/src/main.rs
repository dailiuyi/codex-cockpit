#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod linux_compat;

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    #[cfg(target_os = "linux")]
    linux_compat::configure_x11_input_method();

    // Transparent WebKitGTK surfaces can retain stale buffers across resize
    // and focus changes on Linux graphics drivers. Set these before WebKit
    // starts its processes. Explicit launcher settings take precedence.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Keep transparent clipping surfaces on the compatible compositor path.
    // This is independent of GTK's input-method selection above.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    quota_float_lib::run();
}
