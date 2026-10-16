//! A framed connection: turn a byte stream into typed request/response frames.
//!
//! `Conn` owns the socket, assigns a monotonic `seq` per (stream, id), and
//! serializes `Msg` into the JSON header. It is transport-agnostic (`Read +
//! Write`); in the spike both `swing-server` and `swing-guest` use it over a
//! `std::os::unix::net::UnixStream` — the server↔guest socketpair and the
//! coordinator↔child socketpairs (the child side via a stdin/stdout `Duplex`).

use std::collections::HashMap;
use std::io::{self, Read, Write};

use crate::frame::{self, Frame, Stream};
use crate::msg::Msg;

pub struct Conn<S> {
    io: S,
    seq: HashMap<(Stream, u32), u64>,
}

#[derive(Debug)]
pub struct RecvFrame {
    pub stream: Stream,
    pub id: u32,
    pub call: u32,
    pub seq: u64,
    pub msg: Msg,
    pub body: Vec<u8>,
}

impl<S: Read + Write> Conn<S> {
    pub fn new(io: S) -> Self {
        Conn { io, seq: HashMap::new() }
    }

    pub fn send(
        &mut self,
        stream: Stream,
        id: u32,
        call: u32,
        msg: &Msg,
        body: Vec<u8>,
    ) -> io::Result<()> {
        let seq = self.seq.entry((stream, id)).or_insert(0);
        *seq += 1;
        let header = serde_json::to_value(msg)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let frame = Frame {
            stream,
            id,
            call,
            seq: *seq,
            header,
            body,
        };
        frame::write_frame(&mut self.io, &frame)
    }

    /// Receive one frame. `Ok(None)` means a clean EOF at a frame boundary.
    pub fn recv(&mut self) -> io::Result<Option<RecvFrame>> {
        let frame = match frame::read_frame(&mut self.io)? {
            Some(f) => f,
            None => return Ok(None),
        };
        let msg: Msg = serde_json::from_value(frame.header)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Ok(Some(RecvFrame {
            stream: frame.stream,
            id: frame.id,
            call: frame.call,
            seq: frame.seq,
            msg,
            body: frame.body,
        }))
    }

    pub fn into_inner(self) -> S {
        self.io
    }
}
