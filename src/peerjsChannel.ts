import { LogLevel, Peer, PeerOptions } from "peerjs";
import { Channel, CryptoChannel, crypto } from "@vaultys/id";
const { randomBytes } = crypto;

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

const MAX_ICE_SERVERS = 4;
const MAX_ICE_LENGTH = 2048;
const ICE_SCHEME = /^(stun|stuns|turn|turns):[^\s]{1,253}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;
const PATH = /^\/[A-Za-z0-9._~\/-]{0,200}$/;
const KEY = /^[0-9a-f]{64}$/;
/** RFC 3986 unreserved characters only: PeerJS concatenates the API key into the signalling URL as is. */
const API_KEY = /^[A-Za-z0-9._~-]{1,64}$/;
/** PeerJS's own default API key (`Peer.DEFAULT_KEY`), and the `peer` server's. */
export const DEFAULT_API_KEY = "peerjs";

const b64url = (text: string) => crypto.Buffer.from(text, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => crypto.Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

/** Strictly validates ICE servers coming from a connection string (a QR code is untrusted input). */
export function validIceServers(value: unknown): IceServer[] | null {
  if (!Array.isArray(value) || value.length > MAX_ICE_SERVERS) return null;
  const out: IceServer[] = [];
  for (const server of value) {
    if (!server || typeof server !== "object") return null;
    const { urls, username, credential, ...rest } = server as Record<string, unknown>;
    if (Object.keys(rest).length) return null;
    const list = typeof urls === "string" ? [urls] : urls;
    if (!Array.isArray(list) || !list.length || list.length > MAX_ICE_SERVERS || !list.every((u) => typeof u === "string" && ICE_SCHEME.test(u))) return null;
    if (username !== undefined && (typeof username !== "string" || username.length > 256)) return null;
    if (credential !== undefined && (typeof credential !== "string" || credential.length > 256)) return null;
    out.push({ urls: urls as string | string[], ...(username !== undefined ? { username } : {}), ...(credential !== undefined ? { credential } : {}) });
  }
  return out;
}

/**
 * Throws a clear error unless a signalling host and an explicit list of ICE servers are given, and the API key, if
 * any, is well formed.
 */
export function checkOptions(options: unknown): asserts options is PeerjsChannelOptions {
  const { host, iceServers, apiKey } = (options ?? {}) as Partial<PeerjsChannelOptions>;
  if (typeof host !== "string" || !HOST.test(host)) {
    throw new Error("PeerjsChannel: a signalling server `host` is mandatory (there is no default public server)");
  }
  if (iceServers === undefined || validIceServers(iceServers) === null) {
    throw new Error("PeerjsChannel: `iceServers` is mandatory (an explicit list, `[]` for none); PeerJS public STUN/TURN servers are never used");
  }
  if (apiKey !== undefined && (typeof apiKey !== "string" || !API_KEY.test(apiKey))) {
    throw new Error("PeerjsChannel: invalid `apiKey` (1 to 64 letters, digits, `.`, `_`, `~` or `-`)");
  }
}

/**
 * Builds `vaultys://peerjs?key=…&host=…[&port=…][&path=…][&secure=0][&apikey=…]&ice=…`. `ice` is the base64url of the
 * JSON array of ICE servers, always present; `apikey` only when it is not the default `peerjs`.
 */
export function buildConnectionString(key: string, options: PeerjsChannelOptions): string {
  checkOptions(options);
  const params = new URLSearchParams({ key, host: options.host });
  if (options.port !== undefined) params.set("port", String(options.port));
  if (options.path !== undefined && options.path !== "/") params.set("path", options.path);
  if (options.secure === false) params.set("secure", "0");
  if (options.apiKey !== undefined && options.apiKey !== DEFAULT_API_KEY) params.set("apikey", options.apiKey);
  params.set("ice", b64url(JSON.stringify(options.iceServers)));
  return `vaultys://peerjs?${params.toString()}`;
}

/**
 * Parses a connection string (from a link or a QR code) ; `null` if it is not a PeerJS one, if any parameter is
 * invalid or missing (`ice` included), or if its host is not in `allowedHosts` (never a silent fallback).
 */
export function parseConnectionString(string: string, allowedHosts: readonly string[]): PeerjsConnection | null {
  if (typeof string !== "string" || !string.startsWith("vaultys://peerjs?")) return null;
  let url: URL;
  try {
    url = new URL(string);
  } catch {
    return null;
  }
  const p = url.searchParams;
  const key = p.get("key");
  const host = p.get("host");
  if (!key || !KEY.test(key) || !host || !HOST.test(host)) return null;
  if (!Array.isArray(allowedHosts) || !allowedHosts.some((allowed) => typeof allowed === "string" && allowed.toLowerCase() === host.toLowerCase())) return null;
  const options: PeerjsConnection["options"] = { host, secure: p.get("secure") !== "0", iceServers: [] };
  const port = p.get("port");
  if (port !== null) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    options.port = n;
  }
  const path = p.get("path");
  if (path !== null) {
    if (!PATH.test(path)) return null;
    options.path = path;
  }
  const apiKey = p.get("apikey");
  if (apiKey !== null) {
    if (!API_KEY.test(apiKey)) return null;
    options.apiKey = apiKey;
  }
  // ICE servers are mandatory: without them the receiver would fall back to PeerJS public STUN/TURN servers.
  const ice = p.get("ice");
  if (ice === null || ice.length > MAX_ICE_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromB64url(ice));
  } catch {
    return null;
  }
  const servers = validIceServers(parsed);
  if (!servers) return null;
  options.iceServers = servers;
  return { key, options };
}

export class PeerjsChannel implements Channel {
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
  _onStarted!: () => void;
  _onError!: (error: string) => void;
  _onData!: (data: crypto.Buffer) => void;
  /** Messages received while no receive() was pending (they used to be dropped). */
  private _queue: crypto.Buffer[] = [];
  private _waiting: ((data: crypto.Buffer) => void)[] = [];
  /** The data connection is open: start() resolves at once. */
  private _started = false;
  /** First error reported by PeerJS (relay unreachable, unknown peer…), kept if it comes before start(). */
  _error?: string;

  /**
   * @param key shared secret (hex, 32 bytes) ; absent: a new one (initiator).
   * @param status initiator or receiver (default: receiver when a key is given).
   * @param options signalling server and ICE servers, both mandatory (no default public server).
   */
  constructor(key: string | undefined, status: "initiator" | "receiver" | undefined, options: PeerjsChannelOptions) {
    checkOptions(options);
    this.options = { ...options };
    this.host = this.options.host;
    if (status) {
      this.status = status;
    } else {
      this.status = key ? "receiver" : "initiator";
    }
    this.otherstatus = this.status == "initiator" ? "receiver" : "initiator";
    this.key = key ?? randomBytes(32).toString("hex");
    this.id = crypto.hash("sha256", crypto.Buffer.from(`vaultys-${this.status}-${this.key}`)).toString("hex");
    this.otherid = crypto.hash("sha256", crypto.Buffer.from(`vaultys-${this.otherstatus}-${this.key}`)).toString("hex");
    const peerOptions: PeerOptions = {
      debug: this.options.debug ?? 0,
      host: this.host,
      secure: this.options.secure ?? true,
      ...(this.options.port !== undefined ? { port: this.options.port } : {}),
      ...(this.options.path !== undefined ? { path: this.options.path } : {}),
      // Always given, so that the key in use is the one of these options, never an implicit default.
      key: this.options.apiKey ?? DEFAULT_API_KEY,
      // Always given: without `config`, PeerJS 1.5.5 uses its own public STUN/TURN servers (Google, peerjs.com) ;
      // with it, ONLY the given ones (`config` replaces PeerJS's default configuration as a whole).
      config: { iceServers: this.options.iceServers },
      logFunction: (level: LogLevel | string, ...rest: unknown[]) => {
        if (level.toString() === "Error:") {
          this._onError?.(String(rest[0]));
        }
      },
    };
    this.peer = new Peer(this.id, peerOptions);
    // The logFunction above only runs when `debug` is at least 1: listen to the Peer's own errors as well, so that an
    // unreachable relay or an unknown peer rejects start() instead of leaving it pending forever.
    this.peer.on("error", (error: unknown) => {
      const type = (error as { type?: string } | null)?.type;
      const message = type ? `peerjs: ${type}` : String(error);
      this._error ??= message;
      this._onError?.(message);
    });
    if (this.status == "initiator") {
      const that = this;
      that.peer.on("connection", (conn) => {
        that._onConnected?.();
        delete that._onConnected;
        that.conn = conn;
        that.conn.on("data", (data: string) => {
          that._deliver(crypto.Buffer.from(data, "base64"));
        });
        that.conn.on("close", () => that.peer.destroy());
        // "connection" fires before the data channel is open: a message sent now would be lost.
        // Resolve start() only once the connection is open.
        if (conn.open) that._markStarted();
        else conn.once("open", () => that._markStarted());
      });
    }
    CryptoChannel.encryptChannel(this, crypto.Buffer.from(this.key, "hex"));
  }

  /** Receiver side: `null` if the string is invalid or names a host outside `options.allowedHosts`. */
  static fromConnectionString(string: string, options: PeerjsReceiverOptions) {
    const parsed = parseConnectionString(string, options?.allowedHosts);
    if (!parsed) return null;
    return new PeerjsChannel(parsed.key, "receiver", { ...parsed.options, ...(options.debug !== undefined ? { debug: options.debug } : {}) });
  }

  fromConnectionString(string: string, options: PeerjsReceiverOptions) {
    return PeerjsChannel.fromConnectionString(string, options);
  }

  getConnectionString() {
    return buildConnectionString(this.key, { ...this.options, host: this.host });
  }

  onConnected(callback: () => void) {
    this._onConnected = callback;
  }

  async start() {
    const that = this;
    if (this.status === "receiver") {
      const connect = () => {
        that.conn = that.peer.connect(that.otherid, { reliable: true });
        that.conn.on("open", () => {
          that._onConnected?.();
          delete that._onConnected;
          that.conn.on("data", (data: string) => {
            that._deliver(crypto.Buffer.from(data, "base64"));
          });
          that.conn.on("close", () => that.peer.destroy());
          that._markStarted();
        });
      };
      // Dial only once our own peer is registered with the signalling server: an offer sent before
      // that can be dropped, leaving start() pending forever.
      if (this.peer.open) connect();
      else this.peer.once("open", connect);
    }
    return new Promise<void>((resolve, reject) => {
      // the initiator's connection may already be open when start() is called
      if (that._started) return resolve();
      if (that._error) return reject(that._error);
      that._onStarted = resolve;
      this._onError = reject;
    });
  }

  _markStarted() {
    this._started = true;
    this._onStarted?.();
  }

  /** Hands a message to the oldest pending receive(), or keeps it until the next one. */
  _deliver(data: crypto.Buffer) {
    const waiting = this._waiting.shift();
    if (waiting) waiting(data);
    else this._queue.push(data);
  }

  async send(data: crypto.Buffer) {
    this.conn.send(data.toString("base64"));
  }

  async receive(): Promise<crypto.Buffer> {
    const queued = this._queue.shift();
    if (queued) return queued;
    return new Promise((resolve) => this._waiting.push(resolve));
  }

  close() {
    if (this.conn) {
      this.conn.close();
    }
    this.peer.destroy();
    return Promise.resolve();
  }
}
