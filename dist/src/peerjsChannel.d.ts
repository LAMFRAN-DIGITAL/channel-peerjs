import { Peer } from "peerjs";
import { Channel, crypto } from "@vaultys/id";
/** ICE server accepted in a connection string: STUN/TURN only, with optional TURN credentials. */
export interface IceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
}
/**
 * Where the channel connects. Everything here is also carried by the connection string, so that the party who scans
 * the QR code (the receiver) uses the SAME signalling server and the SAME ICE servers as the party who created it
 * (the initiator), instead of PeerJS defaults.
 *
 * There is no default server: `host` and `iceServers` are mandatory, so that neither a public signalling server nor
 * the public STUN/TURN servers built into PeerJS (Google, peerjs.com) are ever reached by accident.
 */
export interface PeerjsChannelOptions {
    /** PeerJS signalling server host (mandatory, no default). */
    host: string;
    /** Port of the signalling server (default: 443 when `secure`). */
    port?: number;
    /** Path of the PeerJS server (default `/`). */
    path?: string;
    /** Use TLS for signalling (default true). */
    secure?: boolean;
    /**
     * API key of the PeerJS server (PeerJS's `key` option; default `"peerjs"`, the default of PeerJS and of the `peer`
     * server). NOT a secret and never an access control: it travels in clear in the signalling URL, in the connection
     * string and in every client. Letters, digits and `.`, `_`, `~`, `-` only, 1 to 64 characters (PeerJS writes it
     * into the signalling URL without encoding it).
     */
    apiKey?: string;
    /**
     * ICE servers given to WebRTC (mandatory, no default: PeerJS's public STUN/TURN servers are never used). `[]`: no
     * STUN/TURN at all (host candidates only: same network, or a peer with a public address).
     */
    iceServers: IceServer[];
    /** PeerJS log level (0 none … 3 all, default 0). Message contents are never logged. */
    debug?: 0 | 1 | 2 | 3;
}
/** Fields of a parsed `vaultys://peerjs?…` connection string. */
export interface PeerjsConnection {
    key: string;
    options: Required<Pick<PeerjsChannelOptions, "host" | "secure" | "iceServers">> & Omit<PeerjsChannelOptions, "host" | "secure" | "iceServers" | "debug">;
}
/** Options of the receiver that reads a connection string (from a link or a QR code, untrusted input). */
export interface PeerjsReceiverOptions {
    /**
     * Signalling hosts this application accepts (exact host names, case-insensitive). A connection string naming any
     * other host is refused. Mandatory: an absent or empty list refuses every connection string.
     */
    allowedHosts: readonly string[];
    /** PeerJS log level (0 none … 3 all, default 0). */
    debug?: PeerjsChannelOptions["debug"];
}
/** PeerJS's own default API key (`Peer.DEFAULT_KEY`), and the `peer` server's. */
export declare const DEFAULT_API_KEY = "peerjs";
/** Strictly validates ICE servers coming from a connection string (a QR code is untrusted input). */
export declare function validIceServers(value: unknown): IceServer[] | null;
/**
 * Throws a clear error unless a signalling host and an explicit list of ICE servers are given, and the API key, if
 * any, is well formed.
 */
export declare function checkOptions(options: unknown): asserts options is PeerjsChannelOptions;
/**
 * Builds `vaultys://peerjs?key=…&host=…[&port=…][&path=…][&secure=0][&apikey=…]&ice=…`. `ice` is the base64url of the
 * JSON array of ICE servers, always present; `apikey` only when it is not the default `peerjs`.
 */
export declare function buildConnectionString(key: string, options: PeerjsChannelOptions): string;
/**
 * Parses a connection string (from a link or a QR code) ; `null` if it is not a PeerJS one, if any parameter is
 * invalid or missing (`ice` included), or if its host is not in `allowedHosts` (never a silent fallback).
 */
export declare function parseConnectionString(string: string, allowedHosts: readonly string[]): PeerjsConnection | null;
export declare class PeerjsChannel implements Channel {
    host: string;
    options: PeerjsChannelOptions;
    status: "initiator" | "receiver";
    otherstatus: string;
    key: string;
    id: string;
    otherid: string;
    peer: Peer;
    conn: any;
    _onConnected?: () => void;
    _onStarted: () => void;
    _onError: (error: string) => void;
    _onData: (data: crypto.Buffer) => void;
    /** Messages received while no receive() was pending (they used to be dropped). */
    private _queue;
    private _waiting;
    /** The data connection is open: start() resolves at once. */
    private _started;
    /** First error reported by PeerJS (relay unreachable, unknown peer…), kept if it comes before start(). */
    _error?: string;
    /**
     * @param key shared secret (hex, 32 bytes) ; absent: a new one (initiator).
     * @param status initiator or receiver (default: receiver when a key is given).
     * @param options signalling server and ICE servers, both mandatory (no default public server).
     */
    constructor(key: string | undefined, status: "initiator" | "receiver" | undefined, options: PeerjsChannelOptions);
    /** Receiver side: `null` if the string is invalid or names a host outside `options.allowedHosts`. */
    static fromConnectionString(string: string, options: PeerjsReceiverOptions): PeerjsChannel | null;
    fromConnectionString(string: string, options: PeerjsReceiverOptions): PeerjsChannel | null;
    getConnectionString(): string;
    onConnected(callback: () => void): void;
    start(): Promise<void>;
    _markStarted(): void;
    /** Hands a message to the oldest pending receive(), or keeps it until the next one. */
    _deliver(data: crypto.Buffer): void;
    send(data: crypto.Buffer): Promise<void>;
    receive(): Promise<crypto.Buffer>;
    close(): Promise<void>;
}
