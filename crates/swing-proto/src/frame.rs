//! Frame layout and codec (design.md §7).
//!
//! Fixed header (29 bytes, big-endian):
//!   0  magic   4  "SWNG"
//!   4  version 1  currently 1
//!   5  kind    1  0 = header only, 1 = header + body
//!   6  stream  1  0 = control, 1 = exec, 2 = bulk, 3 = log
//!   7  id      4  attempt / container id
//!   11 call     4  call id, 0 if none
//!   15 seq      8  monotonic per (stream, id)
//!   23 hlen     2  header length (JSON)
//!   25 blen     4  body length (opaque bytes)
//!   29 header   hlen  JSON
//!   --  body    blen  opaque bytes

use std::io::{self, Read, Write};
use serde_json::Value;

pub const MAGIC: [u8; 4] = *b"SWNG";
pub const VERSION: u8 = 1;
pub const FIXED_HEADER_LEN: usize = 29;

/// Max frame size is a protocol constant, not a runtime choice (D-42,
/// provisional). Large payloads are chunked across frames on the bulk stream.
pub const MAX_FRAME_SIZE: usize = 4096;

/// Body budget so the whole frame (fixed header + JSON header + body) stays
/// within MAX_FRAME_SIZE. Shared so every crate uses the same accounting.
///
/// The 256 bytes of slack assumes a small JSON header. That holds for
/// `exec_output` and for `fs_read`'s `fs_result`; it does *not* hold for a
/// `fs_result` carrying a large `entries` array, whose entries grow the header
/// itself (see the `fs_list` TODO in `swing-guest/src/fs.rs`, and todo.md T3).
pub const MAX_BODY: usize = MAX_FRAME_SIZE - 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Stream {
    Control = 0,
    Exec = 1,
    Bulk = 2,
    Log = 3,
}

impl Stream {
    pub fn from_u8(v: u8) -> Option<Stream> {
        match v {
            0 => Some(Stream::Control),
            1 => Some(Stream::Exec),
            2 => Some(Stream::Bulk),
            3 => Some(Stream::Log),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub stream: Stream,
    pub id: u32,
    pub call: u32,
    pub seq: u64,
    pub header: Value,
    pub body: Vec<u8>,
}

pub fn encode(frame: &Frame) -> io::Result<Vec<u8>> {
    let header_bytes = serde_json::to_vec(&frame.header)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let hlen = header_bytes.len();
    let blen = frame.body.len();
    let total = FIXED_HEADER_LEN + hlen + blen;
    if total > MAX_FRAME_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("frame too large: {total} > {MAX_FRAME_SIZE}"),
        ));
    }
    let kind: u8 = if blen > 0 { 1 } else { 0 };

    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(kind);
    out.push(frame.stream as u8);
    out.extend_from_slice(&frame.id.to_be_bytes());
    out.extend_from_slice(&frame.call.to_be_bytes());
    out.extend_from_slice(&frame.seq.to_be_bytes());
    out.extend_from_slice(&(hlen as u16).to_be_bytes());
    out.extend_from_slice(&(blen as u32).to_be_bytes());
    out.extend_from_slice(&header_bytes);
    out.extend_from_slice(&frame.body);
    Ok(out)
}

pub fn write_frame<W: Write>(w: &mut W, frame: &Frame) -> io::Result<()> {
    let bytes = encode(frame)?;
    w.write_all(&bytes)?;
    w.flush()?;
    Ok(())
}

/// Fill `buf` completely. Returns `Ok(false)` only on a clean EOF at the very
/// start of a read (i.e. a frame boundary); a partial read is an error.
fn read_exact_or_eof<R: Read>(r: &mut R, buf: &mut [u8]) -> io::Result<bool> {
    let mut filled = 0;
    while filled < buf.len() {
        match r.read(&mut buf[filled..])? {
            0 => {
                if filled == 0 {
                    return Ok(false);
                }
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "partial frame"));
            }
            n => filled += n,
        }
    }
    Ok(true)
}

/// Read one frame. `Ok(None)` means a clean EOF at a frame boundary.
pub fn read_frame<R: Read>(r: &mut R) -> io::Result<Option<Frame>> {
    let mut fixed = [0u8; FIXED_HEADER_LEN];
    if !read_exact_or_eof(r, &mut fixed)? {
        return Ok(None);
    }
    if fixed[0] != b'S' || fixed[1] != b'W' || fixed[2] != b'N' || fixed[3] != b'G' {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bad magic"));
    }
    let version = fixed[4];
    if version != VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unsupported protocol version {version}"),
        ));
    }
    let stream = Stream::from_u8(fixed[6])
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad stream"))?;
    let id = u32::from_be_bytes(fixed[7..11].try_into().unwrap());
    let call = u32::from_be_bytes(fixed[11..15].try_into().unwrap());
    let seq = u64::from_be_bytes(fixed[15..23].try_into().unwrap());
    let hlen = u16::from_be_bytes(fixed[23..25].try_into().unwrap()) as usize;
    let blen = u32::from_be_bytes(fixed[25..29].try_into().unwrap()) as usize;
    if FIXED_HEADER_LEN + hlen + blen > MAX_FRAME_SIZE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }

    let mut header_bytes = vec![0u8; hlen];
    if hlen > 0 && !read_exact_or_eof(r, &mut header_bytes)? {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "partial header"));
    }
    let mut body = vec![0u8; blen];
    if blen > 0 && !read_exact_or_eof(r, &mut body)? {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "partial body"));
    }

    let header: Value = serde_json::from_slice(&header_bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(Some(Frame {
        stream,
        id,
        call,
        seq,
        header,
        body,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let f = Frame {
            stream: Stream::Exec,
            id: 7,
            call: 42,
            seq: 3,
            header: serde_json::json!({"type": "exec_output", "stderr": false}),
            body: b"hello\nworld".to_vec(),
        };
        let bytes = encode(&f).unwrap();
        assert!(bytes.len() <= MAX_FRAME_SIZE);
        let got = read_frame(&mut &bytes[..]).unwrap().unwrap();
        assert_eq!(got.stream, Stream::Exec);
        assert_eq!(got.id, 7);
        assert_eq!(got.call, 42);
        assert_eq!(got.seq, 3);
        assert_eq!(got.body, b"hello\nworld");
    }

    #[test]
    fn clean_eof_at_boundary() {
        assert!(read_frame(&mut &[][..]).unwrap().is_none());
    }
}
