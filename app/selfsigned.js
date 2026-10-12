// A self-signed certificate made in memory (RSA 2048, SHA-256, 3 years), for the twin's HTTPS server: the
// Quest browser opens WebXR only on a secure page. Nothing goes to the Windows certificate store.
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

const len = (n) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const oid = (text) => {
  const [a, b, ...rest] = text.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) { const parts = []; let v = n; do { parts.unshift(v & 0x7f); v >>= 7; } while (v); out.push(...parts.map((p, i) => (i < parts.length - 1 ? p | 0x80 : p))); }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const time = (d) => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
const explicit = (n, body) => tlv(0xa0 + n, body);
const octets = (buf) => tlv(0x04, buf);
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;

/** { key, cert } in PEM for the names (DNS) and addresses (IPv4) given. */
export function selfSigned({ name = "aurora-gemeo", dns = ["localhost"], ips = ["127.0.0.1"] } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const algorithm = seq(oid("1.2.840.113549.1.1.11"), Buffer.from([0x05, 0x00]));
  const who = seq(set(seq(oid("2.5.4.3"), utf8(name))));
  const now = new Date(Date.now() - 86_400_000);
  const until = new Date(Date.now() + 3 * 365 * 86_400_000);
  const san = seq(...dns.map((d) => tlv(0x82, Buffer.from(d))), ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split(".").map(Number)))));
  const extensions = explicit(3, seq(
    seq(oid("2.5.29.17"), octets(san)),
    seq(oid("2.5.29.37"), octets(seq(oid("1.3.6.1.5.5.7.3.1")))),
  ));
  const tbs = seq(explicit(0, int(Buffer.from([2]))), int(randomBytes(12)), algorithm, who, seq(time(now), time(until)), who, publicKey.export({ type: "spki", format: "der" }), extensions);
  const signature = sign("sha256", tbs, privateKey);
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }), cert: pem("CERTIFICATE", seq(tbs, algorithm, bits(signature))) };
}
