//! Per-runtime seeding.
//!
//! Seeds a dormant "Terminal" slot + session definition for brand-new
//! runtimes that have zero slot definitions. Existing runtimes (with or
//! without slots) are left alone — idempotent, safe to call on every
//! workspace open.

use crate::database::AppDatabase;

/// Seed a dormant Terminal slot if the runtime has no slot definitions yet.
/// Returns `Ok(())` even when nothing was seeded.
pub fn ensure_seed(
    db: &AppDatabase,
    runtime_id: &str,
    default_cwd: &str,
) -> Result<(), String> {
    db.ensure_seed_data(runtime_id, default_cwd)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pandora-seed-{prefix}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn first_call_creates_terminal_then_subsequent_calls_are_noops() {
        let home = temp_home("first");
        let db = AppDatabase::open(&home).expect("open");
        let runtime = "rt";

        ensure_seed(&db, runtime, "/tmp").expect("seed");
        let slots_after_first = db.list_slot_definitions(runtime);
        assert_eq!(slots_after_first.len(), 1);

        ensure_seed(&db, runtime, "/tmp").expect("re-seed");
        let slots_after_second = db.list_slot_definitions(runtime);
        assert_eq!(slots_after_second, slots_after_first);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn does_not_recreate_a_user_deleted_terminal() {
        let home = temp_home("delete");
        let db = AppDatabase::open(&home).expect("open");
        let runtime = "rt";

        ensure_seed(&db, runtime, "/tmp").expect("seed");
        let slot_id = db.list_slot_definitions(runtime)[0].id.clone();
        db.remove_slot_definition(runtime, &slot_id).expect("remove");
        ensure_seed(&db, runtime, "/tmp").expect("seed again");
        assert_eq!(db.list_slot_definitions(runtime).len(), 1);

        let _ = std::fs::remove_dir_all(&home);
    }
}
