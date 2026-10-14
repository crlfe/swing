//! OpenAI-compatible Chat Completions client (D-41).
//!
//! Spike uses complete-response tool calls, not streaming. Messages and tools
//! are passed as `serde_json::Value` to stay close to the provider wire format
//! and avoid modeling the whole OpenAI schema.
//!
//! TODO (T7): retry / error taxonomy; tool-schema vs. prompt-based invocation;
//! streaming. Provider web tools (if any) stay host-only (D-34).

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::config::Config;

pub struct Provider {
    cfg: Config,
    http: ureq::Agent,
}

/// One assistant turn: either text (terminal in the spike) and/or tool calls.
pub struct AssistantTurn {
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCall>,
}

pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// Raw JSON string, exactly as the provider returned it.
    pub arguments: String,
}

impl Provider {
    pub fn new(cfg: &Config) -> Self {
        Provider {
            cfg: cfg.clone(),
            http: ureq::Agent::new_with_defaults(),
        }
    }

    pub fn chat(&self, messages: &[Value], tools: &[Value]) -> Result<AssistantTurn> {
        // `model` is omitted entirely when OPENAI_MODEL is unset (D-41).
        let mut body = json!({
            "messages": messages,
            "tools": tools,
        });
        if let Some(model) = &self.cfg.model {
            body["model"] = json!(model);
        }
        let body = serde_json::to_string(&body)?;

        let url = format!(
            "{}/chat/completions",
            self.cfg.base_url.trim_end_matches('/')
        );

        // `Authorization` is omitted entirely when OPENAI_API_KEY is unset.
        let mut req = self.http.post(&url).header("Content-Type", "application/json");
        if let Some(key) = &self.cfg.api_key {
            req = req.header("Authorization", &format!("Bearer {key}"));
        }

        let resp = req
            .send(body.as_str())
            .map_err(|e| anyhow!("provider request failed: {e}"))?;

        let text = resp
            .into_body()
            .read_to_string()
            .map_err(|e| anyhow!("provider response read failed: {e}"))?;
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| anyhow!("provider response not JSON: {e}\n{text}"))?;

        AssistantTurn::from_response(&value)
    }
}

impl AssistantTurn {
    fn from_response(value: &Value) -> Result<AssistantTurn> {
        // Surface provider-level errors ({"error": {...}}) rather than a cryptic
        // "no choices".
        if let Some(err) = value.get("error") {
            return Err(anyhow!("provider error: {err}"));
        }

        let choice = value
            .get("choices")
            .and_then(|c| c.get(0))
            .ok_or_else(|| anyhow!("no choices in provider response: {value}"))?;
        let message = choice
            .get("message")
            .ok_or_else(|| anyhow!("no message in choice: {choice}"))?;

        let content = message
            .get("content")
            .and_then(|c| c.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let mut tool_calls = Vec::new();
        if let Some(calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
            for c in calls {
                let id = c
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_string();
                let func = c.get("function").cloned().unwrap_or(Value::Null);
                let name = func
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let arguments = func
                    .get("arguments")
                    .and_then(|a| a.as_str())
                    .unwrap_or("{}")
                    .to_string();
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments,
                });
            }
        }

        Ok(AssistantTurn {
            content,
            tool_calls,
        })
    }
}
