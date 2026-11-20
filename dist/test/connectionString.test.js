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
    it("can say « no STUN/TURN at all » (empty list), instead of PeerJS public servers", () => {
        const parsed = parseConnectionString(buildConnectionString(KEY, { host: "peer.example.org", iceServers: [] }), ALLOWED);
        expect(parsed?.options.iceServers).to.deep.equal([]);
    });
    it("refuses anything invalid instead of falling back silently to public servers", () => {
        const base = `vaultys://peerjs?key=${KEY}&host=peer.example.org`;
        const ice = (value) => `${base}&ice=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
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
    const text = (host) => buildConnectionString(KEY, { host, iceServers: [] });
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
        expect(parseConnectionString(text("peer.example.org"), undefined)).to.equal(null);
    });
});
