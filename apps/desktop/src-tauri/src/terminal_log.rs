//! File-based diagnostic logger for terminal surface operations.
//!
//! Writes timestamped lines to `/tmp/pandora-terminal.log`. Every entry includes
//! an absolute wall-clock timestamp, the thread name (or id), elapsed µs since
//! process start, and a tag so you can grep for specific subsystems:
//!
//!   [FEED]    — feed_output
//!   [FLUSH]   — flush_surface_output (main thread)
//!   [CREATE]  — create_surface
//!   [UPDATE]  — update_surface
//!   [DESTROY] — destroy_surface
//!   [FOCUS]   — focus_surface
//!   [CMD]     — terminal_commands dispatch + completion
//!   [OVERLAY] — begin/end_web_overlay

use chrono::Local;
use std::fmt::Write as FmtWrite;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Once;
use std::time::Instant;

static INIT: Once = Once::new();
static mut EPOCH: Option<Instant> = None;

fn epoch() -> Instant {
    INIT.call_once(|| unsafe {
        EPOCH = Some(Instant::now());
    });
    unsafe { EPOCH.unwrap() }
}

/// Write one line to `/tmp/pandora-terminal.log`.
/// Cheap enough to call on hot paths — opens the file in append mode each time
/// so lines from multiple threads interleave correctly.
pub fn log(tag: &str, msg: &str) {
    let elapsed = epoch().elapsed();
    let secs = elapsed.as_secs();
    let micros = elapsed.subsec_micros();
    let wall = Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z");

    let thread = std::thread::current();
    let tname = thread.name().unwrap_or("?");

    let mut buf = String::with_capacity(192);
    let _ = write!(
        buf,
        "{} +{:>6}.{:06} [{}] ({}) {}\n",
        wall, secs, micros, tag, tname, msg
    );

    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/pandora-terminal.log")
    {
        let _ = f.write_all(buf.as_bytes());
    }
}

/// Convenience: log with format args. Only active in debug (dev) builds.
#[macro_export]
macro_rules! tlog {
    ($tag:expr, $($arg:tt)*) => {
        #[cfg(debug_assertions)]
        {
            $crate::terminal_log::log($tag, &format!($($arg)*))
        }
    };
}
