//! The agent loop (design.md §5.5, T2, T5).
//!
//! Spike rules:
//! - Context = full transcript every turn (T2, naive rule).
//! - Terminal condition: "model produced text with no tool call" ends the turn
//!   and hands control back to the human (T5). No report/park tools yet.
//! - Max iterations per attempt: 40 (T5 proposal).
//!
//! TODO (T2/T8/T20): record the assembled prompt and every entry to the ticket
//! DB; context summarization/pruning. The spike keeps the transcript in memory.

use anyhow::Result;
use serde_json::{json, Value};

use crate::guest::GuestClient;
use crate::provider::Provider;
use crate::tools;

const MAX_ITERATIONS: usize = 40;

pub struct Session {
    provider: Provider,
}

impl Session {
    pub fn new(provider: Provider) -> Self {
        Session { provider }
    }

    /// Run one attempt until a terminal condition. `transcript` is the OpenAI
    /// `messages` array and is mutated in place (full-transcript rule, T2).
    pub fn run_attempt(&self, transcript: &mut Vec<Value>, guest: &mut GuestClient) -> Result<()> {
        for _ in 0..MAX_ITERATIONS {
            let turn = self.provider.chat(transcript, &tools::tool_specs())?;

            if turn.tool_calls.is_empty() {
                // Terminal condition (T5): text with no tool call ends the turn.
                let content = turn.content.unwrap_or_default();
                transcript.push(json!({ "role": "assistant", "content": content }));
                println!("\nmodel> {content}");
                return Ok(());
            }

            // Record the assistant message with its tool calls.
            let mut msg = json!({ "role": "assistant" });
            if let Some(content) = &turn.content {
                msg["content"] = json!(content);
            }
            msg["tool_calls"] = json!(turn
                .tool_calls
                .iter()
                .map(|c| json!({
                    "id": c.id,
                    "type": "function",
                    "function": { "name": c.name, "arguments": c.arguments }
                }))
                .collect::<Vec<_>>());
            transcript.push(msg);

            for call in &turn.tool_calls {
                println!("  [tool] {} {}", call.name, call.arguments);
                let args: Value =
                    serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({}));
                let result_text = tools::dispatch(&call.name, &args, guest)?;
                transcript.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": result_text
                }));
            }
        }

        println!("\n[iteration limit reached — attempt ends as failed]");
        Ok(())
    }
}

