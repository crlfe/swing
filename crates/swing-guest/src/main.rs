//! swing-guest (design.md §5.2): one binary, two roles.
//!
//!   swing-guest                 # coordinator: control channel + container children
//!   swing-guest container ...   # container child: sandbox + exec/fs serving
//!
//! The coordinator speaks the framed protocol to `swing-server` over loopback
//! TCP and forks `swing-guest container` children (via `std::process::Command`,
//! never `fork()` from an async runtime), routing exec/fs frames to the child
//! for that container id. The child optionally sandboxes itself (unshare/mount/
//! cap-drop) and then serves exec/fs within that sandbox.
//!
//! The framed server<->guest boundary is real from day 1, so the later
//! virtio-serial swap is a config change, not a rewrite.

mod container;
mod coordinator;
mod exec;
mod fs;
mod sandbox;

use anyhow::Result;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("container") {
        return container::run(&args[2..]);
    }
    coordinator::run()
}
