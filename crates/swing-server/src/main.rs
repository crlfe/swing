//! swing-server (spike): a terminal chat that runs model sessions against a
//! `swing-guest` container over the control channel.
//!
//! Spike scope (todo.md "First step"): UI is stdin/stdout — no TUI, no webapp,
//! no HTTP API, no daemon, no token auth. The server spawns `swing-guest` as a
//! child and speaks to it over a `socketpair` it hands the child as its control
//! channel (revised D-27); the server owns the guest's lifetime.
//!
//! TODO (deferred): daemon + pidfile + crash semantics (T8b), ticket DB (T8),
//! scheduler (T6), metering (T28). The container sandbox is always on (T4); what
//! is still open is proving it contains (T14) and closing the tool-error
//! recovery gap in `tools.rs` (T1).

mod config;
mod guest;
mod provider;
mod session;
mod tools;

use std::io::{self, BufRead, Write};

use anyhow::Result;
use serde_json::{json, Value};

const SYSTEM_PROMPT: &str = "\
You are Swing, an agent working inside a sandboxed workspace mounted at /work. \
You have four tools: shell (run a shell command via sh -c), read_file, \
write_file, and list_dir. All paths are relative to /work. \
When you are finished with a step, reply with plain text and no tool call; \
that hands control back to the human.";

fn main() -> Result<()> {
    let cfg = config::Config::from_env()?;
    println!("swing-server (spike)");
    println!("  model: {}", cfg.model.as_deref().unwrap_or("(unset)"));
    println!("  guest: {} (spawned)", cfg.guest_bin);
    println!("  work dir: {} (mounted at /work in the container)", cfg.work_dir);
    println!("  sandbox: always on");
    println!("Type a message and press enter. ':quit' to exit.\n");

    let mut guest = guest::GuestClient::spawn(&cfg.guest_bin, &cfg.work_dir)?;
    let provider = provider::Provider::new(&cfg);
    let session = session::Session::new(provider);

    // Full-transcript context (T2). Recording to the ticket DB is deferred (T8).
    let mut transcript: Vec<Value> = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];

    let stdin = io::stdin();
    loop {
        print!("you> ");
        io::stdout().flush()?;

        let mut line = String::new();
        if stdin.lock().read_line(&mut line)? == 0 {
            break; // EOF
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line == ":quit" {
            break;
        }

        transcript.push(json!({ "role": "user", "content": line }));
        if let Err(e) = session.run_attempt(&mut transcript, &mut guest) {
            eprintln!("[attempt error: {e:#}]");
        }
    }

    guest.shutdown()?;
    Ok(())
}
