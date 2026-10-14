//! swing-server (spike): a terminal chat that runs model sessions against a
//! `swing-guest` container over the control channel.
//!
//! Spike scope (todo.md "First step"): UI is stdin/stdout — no TUI, no webapp,
//! no HTTP API, no daemon, no token auth. The server connects to a guest that
//! is already listening on loopback (D-27); spawning the guest is a later step.
//!
//! TODO (deferred): daemon + pidfile + crash semantics (T8b), ticket DB (T8),
//! scheduler (T6), metering (T28), `unshare` sandbox (T4).

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
    println!("  guest: {}", cfg.guest_addr);
    println!("Type a message and press enter. ':quit' to exit.\n");

    let mut guest = guest::GuestClient::connect(&cfg.guest_addr)?;
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

    Ok(())
}
