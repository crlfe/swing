# Wire protocol

**Sections:** §7 · **Read this if:** you are implementing either side of the control
channel. · **Depends on:** [tool-protocol.md](tool-protocol.md) (§6, the message set)
· **Decisions here:** D-14, D-15, D-19, D-27, D-42, D-44, D-45, D-46 · **Open:** OQ-3, OQ-22

**Binary from the start.** Rationale: most payloads are JSON blobs, but file
contents, command output, and later package closures are arbitrary bytes. A binary
frame avoids double-escaping and base64 entirely, and we are writing a pretty-printer
(`swing trace`) either way.

Fixed header + JSON header + opaque body:

| Offset | Field | Size | Notes |
|---|---|---|---|
| 0 | magic | 4 | `SWNG` |
| 4 | version | 1 | currently `1` |
| 5 | kind | 1 | 0 = header only, 1 = header + body |
| 6 | stream | 1 | 0 = control, 1 = exec, 2 = bulk, 3 = log |
| 7 | id | 4 | attempt / container id |
| 11 | call | 4 | call id, 0 if none |
| 15 | seq | 8 | monotonic per (stream, id) |
| 23 | hlen | 2 | header length |
| 25 | blen | 4 | body length |
| 29 | header | hlen | JSON |
| — | body | blen | opaque bytes |

- `stream` lets us split into multiple virtio-serial ports later without changing
  message semantics.
- `call` gives every request/response pair an identity and makes cancellation trivial.
- Max frame size is a protocol constant, not a runtime choice: **4 KiB** (D-42;
  provisional — chosen arbitrarily for the prototype; large payloads are chunked across
  frames on the bulk stream).

**Versioning.** `swing` pins exactly one base image, which contains exactly one
`swing-guest`. The pair is tightly coupled; there is no negotiation and no
compatibility matrix. The header's `version` and a build-id pair exist only so a
mismatch produces a clear error instead of garbage.

Serialization is **serde** (`serde_json` header, body framed with `tokio-util`);
`postcard` is not used (D-42). Document the message set in `schema.toml` so both sides
and the pretty-printer share one definition (still open, OQ-3).

---

**Related:** the transport this rides on — inherited fd / Unix socket on Unix, DACL'd
named pipe on Windows — is §14 ([../sandbox/vm.md](../sandbox/vm.md)) and §15
([../architecture/process-model.md](../architecture/process-model.md)). Throughput and
port count are [T12 / T13a](../../todo/tier2-b1.md). Implemented in
`crates/swing-proto`; documented in [`schema.toml`](../../schema.toml).
