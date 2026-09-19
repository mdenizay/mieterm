//! Storage round-trips and the path check that stops a recording id escaping its folder.

use mieterm_lib::storage::is_inside;
use std::fs;

#[test]
fn a_path_inside_the_root_is_accepted() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("session.log");
    fs::write(&file, b"x").unwrap();
    assert!(is_inside(root.path(), &file));
}

#[test]
fn a_path_that_climbs_out_of_the_root_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let outside = root.path().join("..").join("escaped.log");
    assert!(!is_inside(root.path(), &outside));
}

#[test]
fn a_target_that_does_not_exist_yet_is_judged_by_its_parent() {
    // Downloads name a file that is about to be created; refusing those outright would
    // break the feature the check exists to protect.
    let root = tempfile::tempdir().unwrap();
    let pending = root.path().join("not-created-yet.log");
    assert!(is_inside(root.path(), &pending));
}
