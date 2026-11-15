# What happens when a browser opens an HTTPS site for the first time? {#first-visit}

The browser looks up the IP address, opens a TCP connection, and runs a **one-round-trip TLS 1.3 handshake**. That handshake agrees on fresh encryption keys and verifies the server's identity before the browser sends its first HTTP request.

- The browser sends its key share inside `ClientHello`, finishing key agreement in one round trip.[](source:rfc8446)
- Everything after `ServerHello` travels encrypted, including the server's certificate.[](source:rfc8446)
- `CertificateVerify` proves the server holds the private key matching its certificate.
- Both sides discard their one-time key shares afterward, so a future private-key leak cannot decrypt this visit.

@answer scope="TLS 1.3 over TCP · first visit to a host · no proxy, no session resumption"
@meta locale=en
@source rfc8446 title="RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3" url=https://www.rfc-editor.org/rfc/rfc8446

## What crosses the wire before the first request? {#wire}

@sequence id=tls-visit title="First HTTPS visit: DNS to first response"
| actor browser | Browser | frontend |
| actor dns | DNS resolver | external |
| actor server | Web server | backend |
| phase | Name lookup |
| browser | dns | DNS query: example.com |
| dns | browser | IP address | return |
| phase | TCP handshake · 1 RTT |
| browser | server | SYN |
| server | browser | SYN + ACK | return |
| browser | server | ACK |
| phase | TLS 1.3 handshake · 1 RTT |
| browser | server | ClientHello: suites, SNI, key share |
| server | browser | ServerHello: chosen suite, key share | return |
| server | browser | Certificate + CertificateVerify + Finished (encrypted) | return |
| browser | server | Finished | emphasis |
| phase | Encrypted HTTP |
| browser | server | GET / |
| server | browser | 200 OK + page | return |

@steps id=visit-steps
| resolve | DNS resolver | Turns the hostname into an IP address so the browser knows where to connect. | tls-visit | dns |
| hello | Browser | Opens TCP and sends `ClientHello` with supported cipher suites, the hostname (SNI) and a one-time key share. | tls-visit | browser |
| prove | Web server | Returns its key share in `ServerHello`, then sends its certificate, signature and `Finished` message under encryption. | tls-visit | server |

@callout id=quic level=note title="What changes with HTTP/3?"
| HTTP/3 runs over QUIC instead of TCP. QUIC folds the TLS 1.3 handshake into transport setup, so connection setup and encryption finish together in one round trip.

## How does the browser know this is the real site? {#trust}

| Check | What the browser verifies |
| --- | --- |
| Chain | The certificate chains back to a root CA in the browser's trust store. |
| Hostname | The site's domain matches the certificate's Subject Alternative Name (SAN) list. |
| Validity | Today's date falls between the certificate's `notBefore` and `notAfter` timestamps. |
| Ownership | `CertificateVerify` signs the live handshake transcript; only the private-key holder can produce that signature. |
| Revocation | Stapled OCSP or browser revocation lists check whether the certificate was revoked, often best-effort. {caution:Soft-fail} |

## Where do the session keys come from? {#keys}

@facts id=key-facts
| Key shares | Browser and server each generate a one-time Diffie-Hellman share, usually `X25519`. |
| Shared secret | Each side combines its own private share with the other side's public share to reach the same secret. |
| Key derivation | HKDF mixes that secret with the handshake transcript to derive handshake keys, then separate HTTP traffic keys. |
| Forward secrecy | Both sides delete the ephemeral shares after handshake, keeping recorded traffic safe if a server key leaks later. |
| Client `Finished` | MAC over the full transcript confirming neither side saw tampered messages; HTTP data can follow immediately. |

## What changes on the next visit? {#revisit}

| Aspect | First visit | Resumed visit |
| --- | --- | --- |
| Server proof | Full certificate chain and live signature check | Pre-shared key from an earlier `NewSessionTicket` |
| Round trips before HTTP | DNS + 1 RTT TCP + 1 RTT TLS | 1 RTT TCP, then request can ride inside `ClientHello` {good:0-RTT} |
| Replay risk | None; request waits until `Finished` | 0-RTT early data can be replayed, so servers restrict it to safe reads {caution:Replayable} |
