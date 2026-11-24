import { expect } from "chai";
import { buildConnectionString, parseConnectionString, validIceServers } from "../src/peerjsChannel";

// No network: only the connection string, which travels in the QR code and must be strictly checked.
const KEY = "a".repeat(64);
const ALLOWED = ["peer.example.org"];

describe("PeerJS connection string", () => {
  it("always carries the host and the ICE servers (no default public server)", () => {
    const text = buildConnectionString(KEY, { host: "peer.example.org", iceServers: [] });
    expect(text).to.equal(`vaultys://peerjs?key=${KEY}&host=peer.example.org&ice=W10`);
    expect(parseConnectionString(text, ALLOWED)).to.deep.equal({ key: KEY, options: { host: "peer.example.org", secure: true, iceServers: [] } });
  });

  it("carries port, path, secure and ICE servers to the receiver (round trip)", () => {
    const options = {
      host: "peer.example.org",
      port: 9443,
      path: "/vaultys",
      secure: false,
      iceServers: [{ urls: "stun:stun.example.org:3478" }, { urls: ["turns:turn.example.org:5349"], username: "u", credential: "p" }],
    };
    const text = buildConnectionString(KEY, options);
    expect(text).to.match(/&port=9443&path=%2Fvaultys&secure=0&ice=[A-Za-z0-9_-]+$/);
    expect(parseConnectionString(text, ALLOWED)).to.deep.equal({ key: KEY, options });
  });

  it("carries the API key only when it is not the default `peerjs`", () => {
    const base = { host: "peer.example.org", iceServers: [] };
    expect(buildConnectionString(KEY, { ...base, apiKey: "peerjs" })).to.equal(buildConnectionString(KEY, base));
    const text = buildConnectionString(KEY, { ...base, apiKey: "sas-relay" });
    expect(text).to.equal(`vaultys://peerjs?key=${KEY}&host=peer.example.org&apikey=sas-relay&ice=W10`);
    expect(parseConnectionString(text, ALLOWED)).to.deep.equal({ key: KEY, options: { host: "peer.example.org", secure: true, iceServers: [], apiKey: "sas-relay" } });
    expect(parseConnectionString(`vaultys://peerjs?key=${KEY}&host=peer.example.org&apikey=peerjs&ice=W10`, ALLOWED)?.options.apiKey).to.equal("peerjs");
  });

  it("can say « no STUN/TURN at all » (empty list), instead of PeerJS public servers", () => {
    const parsed = parseConnectionString(buildConnectionString(KEY, { host: "peer.example.org", iceServers: [] }), ALLOWED);
    expect(parsed?.options.iceServers).to.deep.equal([]);
  });

  it("refuses anything invalid instead of falling back silently to public servers", () => {
    const base = `vaultys://peerjs?key=${KEY}&host=peer.example.org`;
    const ice = (value: unknown) => `${base}&ice=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
    for (const bad of [
      `vaultys://other?key=${KEY}&host=h&ice=W10`,
      `vaultys://peerjs?key=short&host=peer.example.org&ice=W10`,
      `vaultys://peerjs?key=${KEY}&ice=W10`,
      `vaultys://peerjs?key=${KEY}&host=bad host&ice=W10`,
      `${base}&ice=W10&port=0`,
      `${base}&ice=W10&port=70000`,
      `${base}&ice=W10&path=noslash`,
      `${base}&ice=@@@`,
      ice({ urls: "stun:x" }),
      ice([{ urls: "https://evil.example" }]),
      ice([{ urls: "stun:a" }, { urls: "stun:b" }, { urls: "stun:c" }, { urls: "stun:d" }, { urls: "stun:e" }]),
      ice([{ urls: "stun:a", extra: 1 }]),
      `${base}&ice=${"A".repeat(3000)}`,
      `${base}&ice=W10&apikey=`,
      `${base}&ice=W10&apikey=a%26id%3Dother`,
      `${base}&ice=W10&apikey=a%20b`,
      `${base}&ice=W10&apikey=${"x".repeat(65)}`,
      `${base}&ice=W10&apikey=%2E%2E`,
      `${base}&ice=W10&apikey=.`,
    ]) {
      expect(parseConnectionString(bad, ALLOWED), bad).to.equal(null);
    }
  });

  it("refuses a connection string without ICE servers (the receiver would use PeerJS public STUN/TURN)", () => {
    expect(parseConnectionString(`vaultys://peerjs?key=${KEY}&host=peer.example.org`, ALLOWED)).to.equal(null);
  });

  it("validates ICE servers strictly", () => {
    expect(validIceServers([{ urls: "turn:t.example.org", username: "u", credential: "c" }])).to.deep.equal([{ urls: "turn:t.example.org", username: "u", credential: "c" }]);
    expect(validIceServers([{ urls: [] }])).to.equal(null);
    expect(validIceServers([{ urls: "stun:a", username: 3 }])).to.equal(null);
    expect(validIceServers("stun:a")).to.equal(null);
  });
});

describe("PeerJS connection string, allowed hosts", () => {
  const text = (host: string) => buildConnectionString(KEY, { host, iceServers: [] });

  it("accepts a host of the list (case-insensitive)", () => {
    expect(parseConnectionString(text("peer.example.org"), ALLOWED)?.options.host).to.equal("peer.example.org");
    expect(parseConnectionString(text("Peer.Example.ORG"), ALLOWED)?.options.host).to.equal("Peer.Example.ORG");
    expect(parseConnectionString(text("b.example.org"), ["a.example.org", "b.example.org"])?.options.host).to.equal("b.example.org");
  });

  it("refuses a host outside the list, even a former default or a look-alike", () => {
    for (const host of ["peerjs.92k.de", "0.peerjs.com", "evil.example.org", "peer.example.org.evil.example", "example.org", "xpeer.example.org"]) {
      expect(parseConnectionString(text(host), ALLOWED), host).to.equal(null);
    }
  });

  it("refuses every host when the list is empty or missing (fails closed)", () => {
    expect(parseConnectionString(text("peer.example.org"), [])).to.equal(null);
    expect(parseConnectionString(text("peer.example.org"), undefined as unknown as string[])).to.equal(null);
  });
});

describe("PeerJS connection string, service of the initiator", () => {
  const base = { host: "peer.example.org", iceServers: [] };

  it("carries the service only when given, before `ice` (round trip)", () => {
    expect(buildConnectionString(KEY, base)).to.not.include("service=");
    const text = buildConnectionString(KEY, { ...base, service: "https://salon.example.org" });
    expect(text).to.equal(`vaultys://peerjs?key=${KEY}&host=peer.example.org&service=https%3A%2F%2Fsalon.example.org&ice=W10`);
    expect(parseConnectionString(text, ALLOWED)).to.deep.equal({ key: KEY, options: { ...base, secure: true, service: "https://salon.example.org" } });
  });

  it("keeps a port and accepts http (canonicity and development hosts are the receiver's check)", () => {
    for (const service of ["https://salon.example.org:8443", "http://localhost:3202"]) {
      expect(parseConnectionString(buildConnectionString(KEY, { ...base, service }), ALLOWED)?.options.service, service).to.equal(service);
    }
  });

  it("refuses the whole string for a repeated or malformed service (never a guess)", () => {
    const head = `vaultys://peerjs?key=${KEY}&host=peer.example.org&ice=W10`;
    for (const bad of [
      `${head}&service=https%3A%2F%2Fa.example.org&service=https%3A%2F%2Fb.example.org`,
      `${head}&service=`,
      `${head}&service=salon.example.org`,
      `${head}&service=app%3Afr.example.salon`,
      `${head}&service=contact%3A${"a".repeat(64)}`,
      `${head}&service=https%3A%2F%2Fa.example.org%2F%3Fx`,
      `${head}&service=https%3A%2F%2Fa.example.org%23x`,
      `${head}&service=https%3A%2F%2Fu%40a.example.org`,
      `${head}&service=https%3A%2F%2Fa.example.org%2F%2525`,
      `${head}&service=https%3A%2F%2Fa.example.org%5C`,
      `${head}&service=https%3A%2F%2Fa%20b.example.org`,
      `${head}&service=https%3A%2F%2F%C3%A9.example.org`,
      `${head}&service=https%3A%2F%2F${"a".repeat(300)}`,
    ]) {
      expect(parseConnectionString(bad, ALLOWED), bad).to.equal(null);
    }
  });

  it("refuses to build a string with a malformed service", () => {
    for (const service of ["", "salon.example.org", "https://a.example.org/?x", "https://u@a.example.org", "app:fr.example"]) {
      expect(() => buildConnectionString(KEY, { ...base, service }), service).to.throw(/service/);
    }
  });

  it("is ignored by a receiver that does not read it: the rest of the string is unchanged", () => {
    const withService = parseConnectionString(buildConnectionString(KEY, { ...base, service: "https://salon.example.org" }), ALLOWED);
    const { service, ...rest } = withService!.options;
    expect(service).to.equal("https://salon.example.org");
    expect({ key: withService!.key, options: rest }).to.deep.equal(parseConnectionString(buildConnectionString(KEY, base), ALLOWED));
  });
});
