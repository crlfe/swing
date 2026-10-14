//! Swing control-channel wire protocol (design.md §7).
//!
//! Binary frames: a fixed 29-byte header, a serde_json header, and an opaque
//! body. The `stream` field multiplexes control/exec/bulk/log over a single
//! socket today and over separate virtio-serial ports later without changing
//! message semantics (D-42).
//!
//! This crate is deliberately runtime-agnostic: the codec works over
//! `std::io::Read`/`Write`, so `swing-server` and `swing-guest` can each pick
//! their own transport (loopback TCP in the spike; virtio-serial in production).

pub mod frame;
pub mod msg;
pub mod transport;

pub use frame::{Frame, Stream, FIXED_HEADER_LEN, MAGIC, MAX_FRAME_SIZE, VERSION};
pub use msg::{EntryKind, FsEntry, Msg};
pub use transport::{Conn, RecvFrame};
