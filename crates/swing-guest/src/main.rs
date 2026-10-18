//! swing-guest (design §5.2): one binary, two roles.
//!
//!   swing-guest                 # coordinator: control channel + container children
//!   swing-guest container ...   # container child: sandbox + exec/fs serving
//!
//! The coordinator speaks the framed protocol to `swing-server` over its control
//! channel — a `socketpair` inherited from the server that spawns it (the prototype
//! form; a private local channel — socketpair/pipe — in production, revised D-27) —
//! and spawns `bwrap … swing-guest container` children (via
//! `std::process::Command`, never `fork()` from an async runtime), routing
//! exec/fs frames to the child for that container id. bubblewrap sandboxes each
//! child and runs it as PID 1 of its own PID namespace before it reads its first
//! frame.
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
    coordinator::run(&args[1..])
}
