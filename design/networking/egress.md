# Mediated egress (planned, not v1)

**Sections:** §10a · **Read this if:** you want to know how a container could ever reach the
network — and why the answer is not a NIC. **This is a security section.** · **Depends on:**
[networking.md](networking.md) (§10), [../sandbox/containers.md](../sandbox/containers.md)
(§11, per-container netns and uid), [../security/security-model.md](../security/security-model.md)
· **Decisions here:** D-28 … D-34, D-38, D-39, D-40 · **Open:** OQ-17, OQ-18, OQ-20, OQ-21

When containers need to reach the network — because the program under test calls an
API, or because real dev tools must work — the mechanism is **transparent interception
inside the guest using the TPROXY family of kernel mechanisms, tunneled over the serial
link, filtered by `swing-server`.**

Applications are not involved. There is no proxy configuration, no environment
variables, and no cooperation required from the code running in a container.

Rejected alternatives, recorded so they are not re-litigated:

- **QEMU user networking (slirp).** Puts a full userspace TCP/IP stack *inside the
  process that is the security boundary*, requires granting QEMU outbound socket
  syscalls (weakening `-sandbox on`), offers essentially no destination filtering, and
  produces no audit trail. Has a relevant CVE history.
- **passt.** Architecturally attractive — mediation in a separate daemon, real NIC,
  resolver under our control — but **passt's own documentation states it is not
  portable**, and it depends on Linux network namespaces. Since cross-platform support
  is the reason QEMU is in this design at all, passt is out unless that changes.
- **`-netdev dgram` with `local.type=fd|inet`.** Portable, and the `fd` variant gives
  the tightest possible QEMU grant — but it is a **packet pipe, not a byte pipe**. The
  guest kernel would run a full TCP/IP stack talking to *us*, obliging us to write and
  permanently maintain a userspace L2/L3/L4 stack including TCP termination. That is
  "passt's transport without passt's stack": strictly more work than SOCKS and strictly
  worse than passt. virtio-serial already provides the byte stream for free.

- **SOCKS5 over the serial link.** Portable and simple, and it was the initial proposal.
  Superseded: it requires application cooperation (`pip`, `git`, curl, and anything with
  a hardcoded endpoint need the right environment variables or silently bypass), and
  local DNS resolution defeats hostname filtering. Transparent interception keeps every
  advantage SOCKS had — portability, QEMU stays socket-free, no NIC, data path equals
  audit path — and removes both failure modes.

## Mechanism

Textbook TPROXY targets the netfilter `prerouting` chain, which handles *transit*
packets. Our traffic is locally generated inside a guest that has **no NIC**, so the
variant used is policy routing with a `local` route type:

```
ip route add local 0.0.0.0/0 dev lo table <n>
ip rule add fwmark <mark> table <n>
nft add rule ip mangle output ... meta skuid <agent-uid> mark set <mark>
```

A `local` route tells the kernel the destination is local, so the packet is delivered
into the local stack and lands on the `swing-guest` interception socket. The socket is
bound with `IP_TRANSPARENT`, and the original destination address is recovered with
`IP_RECVORIGDSTADDR`. `swing-guest` then asks `swing-server` for a tunnel and relays
bytes.

**This works with only `lo` present.** No NIC, no tap device, no QEMU netdev — so D-28
(no network backend compiled in) survives intact. That is the decisive advantage over
slirp, passt, and `dgram`. To be confirmed by spike; see T24 in
[todo/tier4-product.md](../../todo/tier4-product.md).

## Initial egress policy: an IP-address allowlist

Initial policy is deliberately crude and explicit:

- **Deny by default.**
- **Grants are IP addresses and CIDR ranges, not hostnames.**
- **Allowlisted public DNS resolvers are on the list, and DNS requests are forwarded to
  them blindly.** We do not run our own resolver, do not synthesize addresses, and do
  not interpret DNS. Applications resolve normally and get real answers.
- The application's subsequent connection is then allowed or denied by destination IP.

This trades expressiveness for simplicity: no name→IP mapping to maintain, no resolver to
implement, no synthetic address space to leak. Its costs are recorded in OQ-17 and OQ-18.

## The property that makes this safe: it fails closed

With a real NIC, a compromised guest that deletes the firewall rules gains actual network
access. With no NIC, a compromised guest that deletes the rules gains **nothing** — there
is no route, and the only way to regain connectivity is to re-establish the interception
path to `swing-guest`, which is the thing we are trying to prevent.

**The filter's failure mode is disconnection, not bypass.** This comes for free from the
no-NIC decision and is the strongest argument for this design over any NIC-based
alternative.

## Per-container attribution

Marking by socket owner (`nft` `meta skuid`) attributes traffic to the uid that created
the socket. Since each container runs its agent processes under a distinct uid,
**per-container egress policy falls out of the uid assignment.** Grant lifetime maps onto
container lifetime: allocate uid → install rules → destroy container (on ticket delete) →
release uid → remove rules.

Separate network namespaces are still used for isolation; `skuid` matching is what makes
the *policy* per-container rather than per-guest.

## Two problems this must not conflate

- **(a) Dependency and package supply** — `pip`, `npm`, `cargo`, `git clone`. A
  transparent tunnel makes these work but makes them **unverifiable and
  unreproducible**: two runs of the same ticket get different dependency trees, nothing
  is signature-checked, and the Nix store stops being the record of the environment.
  Supply should be an explicit, recorded, verified fetch (OQ-4), not a tunnel.
- **(b) Runtime egress for the program under test.** Here a mediated tunnel is the
  right answer and there is no better alternative.

Keep these as separate features with separate trust models. Conflating them means
dependency supply inherits the runtime egress policy.

## Constraints that make it sound

1. **Policy decisions live in `swing-server`; the guest only installs rules the server
   told it to install.** Keep this line sharp. If grant logic migrates into guest-side
   netfilter configuration, the design has failed.
2. **`swing-guest` needs `CAP_NET_ADMIN` in the guest.** It is already root, so this is
   free — but it is a real capability and it should be scoped to interception setup only.
3. **An allowed IP is a full tunnel.** Interception is L4: once a tunnel is open there is
   no HTTP visibility — no method, path, or content filtering, and no blocking of
   exfiltration to an allowed destination. State this explicitly so nobody believes the
   allowlist is finer-grained than it is.
4. **Deny by default, per-ticket grants, human approval for anything not granted**, with
   a live connections view in the TUI/webapp.
5. **Audit every connection into the ticket** as durable entries — grants, denials, byte
   counts. The data path is the same path we log, so this is structural rather than
   something to remember to implement.
6. **Its own `stream` id and its own virtserialport.** A long-lived tunnel must not
   head-of-line block control or exec traffic.
7. **Denied connections must be surfaced to the model as a denial, not as a socket
   error.** With transparent interception there is no visible proxy for anyone to notice;
   a refused connection looks like the remote host being down. The model needs a way to
   learn it was denied and to request a grant (OQ-17).

## L4 relay vs. MITM — a deliberate fork

TLS is relayed untouched: `swing-guest` forwards bytes, `swing-server` re-originates, and
certificates verify against the real destination. That is the first-release behavior.

Transparent interception makes **MITM** feasible — install our CA in containers, terminate
TLS, and gain L7 filtering on method, path, and content, including the ability to block
exfiltration to an allowed host. That is a genuinely useful capability and a genuinely bad
liability: we would hold a CA able to sign any certificate, in every container, on
**Stay L4 relay in the first egress release**; treat MITM as a decision made
explicitly, never as an implementation convenience (OQ-20).

## Costs, stated honestly

- It amends principle 2: the guest initiates transfers through this subsystem.
- It amends principle 4: containers can have network, subject to policy.
- It enlarges the threat model. Today the risk is "the model is persuaded to call
  `web_fetch`." With mediated egress the risk is "**any code inside a container,
  including a malicious dependency, can open connections subject to an L4 filter.**"
- Per-container setup is heavier than setting environment variables: netns, routing
  table, mangle rules, interception socket.
- An IP allowlist is operationally annoying for CDNs, package registries, and any
  service with rotating addresses (OQ-18).
- DNS-over-HTTPS and other DNS-over-an-allowed-HTTPS-endpoint paths bypass the DNS part
  of the policy entirely (OQ-18).
- Blind DNS forwarding means the guest learns real addresses for hosts we never granted;
  those connections are then denied, which is correct behavior but produces confusing
  failures for the model (OQ-17).
- Throughput is bounded by the link and our framing; a dedicated bulk port is required.
- IPv6 needs a parallel setup.

## Provider-side web search is a separate mechanism

Provider web search (the configured provider's search mechanism, if any — not part of
the Chat Completions spike) runs **entirely on the host**, with no guest involvement, no
egress policy, and no tunnel. "The model looks
something up" and "code in a container opens a socket" are different features and must
not share a design.

---

**Related:** [networking.md](networking.md) (§10) · [../sandbox/containers.md](../sandbox/containers.md)
(§11, netns + uid) · [../security/security-model.md](../security/security-model.md) (§13, the
enlarged threat model) · [../security/accepted-risks.md](../security/accepted-risks.md) ·
spikes and policy work: [T24, T24a, T24b, T24c](../../todo/tier4-product.md) ·
open: [OQ-17, OQ-18, OQ-20, OQ-21](../reference/open-questions.md).
