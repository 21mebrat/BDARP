import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";

import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  NotificationEvent,
  PresenceEvent,
} from "./types/socket.types.ts";

import { registerChatHandlers, rooms } from "./services/chat.service.ts";


// ═══════════════════════════════════════════════════════════════════════════
// socket/socket.registry.ts
//
// In-memory online-user registry.
//
// Design: Map<userId, Set<socketId>>
//  • A user is "online" as long as their Set is non-empty.
//  • Multiple tabs / devices each contribute one socketId to the Set.
//  • The user is truly offline only when every socket disconnects.
//  • All operations are O(1) — no array scanning.
//
// NOTE: This registry is process-local. For a multi-node deployment
//       (e.g. PM2 cluster or Kubernetes pods), replace this module with a
//       Redis-backed equivalent and use @socket.io/redis-adapter so the
//       Socket.IO server can route events across nodes.
// ═══════════════════════════════════════════════════════════════════════════

const registry = new Map<string, Set<string>>();

/**
 * Register a new socket for the given user.
 * Safe to call multiple times for the same user (different tabs).
 */
export function addSocket(userId: string, socketId: string): void {
  if (!registry.has(userId)) registry.set(userId, new Set());
  registry.get(userId)!.add(socketId);
}

/**
 * Remove a socket from the registry.
 * @returns `true` when this was the user's **last** socket — they are now offline.
 */
export function removeSocket(userId: string, socketId: string): boolean {
  const sockets = registry.get(userId);
  if (!sockets) return false;

  sockets.delete(socketId);

  const wentOffline = sockets.size === 0;
  if (wentOffline) registry.delete(userId);
  return wentOffline;
}

/** Returns `true` when the user has at least one active socket. */
export function isOnline(userId: string): boolean {
  return (registry.get(userId)?.size ?? 0) > 0;
}

/** Returns all active socket IDs for a user, or an empty Set. */
export function getSocketIds(userId: string): ReadonlySet<string> {
  return registry.get(userId) ?? new Set();
}

/** Returns the total number of distinct online users. */
export function onlineCount(): number {
  return registry.size;
}
// ─── Typed aliases ─────────────────────────────────────────────────────────
//
// Import these in every handler file instead of using the raw generics.

export type AppServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// ─── Module-level io reference ────────────────────────────────────────────
//
// Stored here so `pushNotification` can use it without going through
// `global.io` (which would require the caller to import from server.ts and
// risk circular-dependency issues).

let _io: AppServer;

// ─── Initialiser ──────────────────────────────────────────────────────────

export function initSocket(
  httpServer: HttpServer,
  allowedOriginFn: (origin: string | undefined) => boolean,
): AppServer {
  _io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin(origin, callback) {
        allowedOriginFn(origin)
          ? callback(null, true)
          : callback(new Error("Not allowed by CORS"));
      },
      methods:     ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
    // Cleans up empty child namespaces automatically.
    cleanupEmptyChildNamespaces: true,
  });

  // Expose on global so legacy/utility code that imports from server.ts can
  // still reach the instance via `global.io`.
  global.io = _io as unknown as SocketIOServer;

  _io.on("connection", (socket: AppSocket): void => {
    // ── register ─────────────────────────────────────────────────────────
    //
    // The client MUST emit this immediately after connecting.
    //
    // Production checklist:
    //  - Extract userId from a signed JWT (e.g. socket.handshake.auth.token).
    //  - Reject the connection if the token is invalid or expired.
    //  - Never trust a userId coming from an untrusted client payload.
    socket.on("register", ({ userId }): void => {
      if (!userId) return;

      socket.data.userId = userId;
      addSocket(userId, socket.id);

      // Private room — targeted notifications and DMs land here.
      socket.join(rooms.user(userId));

      socket.emit("registered", { userId, socketId: socket.id });

      // Register all domain-specific handlers now that we have an identity.
      registerChatHandlers(socket, _io);
    });

    // ── disconnect ────────────────────────────────────────────────────────

    socket.on("disconnect", (): void => {
      const userId = socket.data.userId;
      if (!userId) return;

      const wentOffline = removeSocket(userId, socket.id);

      // Broadcast offline presence only when this was the user's last socket
      // (no other tabs / devices are still connected).
      if (wentOffline) {
        socket.rooms.forEach((room) => {
          if (room.startsWith("presence:")) {
            const event: PresenceEvent = { userId, isOnline: false };
            socket.to(room).emit("presenceUpdate", event);
          }
        });
      }
    });
  });

  return _io;
}

// ─── pushNotification ─────────────────────────────────────────────────────
//
// Call this from any controller, service, or scheduler to deliver a real-time
// notification to a specific user — regardless of how many sockets they have
// open or which node their sockets are on (with the Redis adapter).
//
// The event maps to a row in the `notifications` table.  Always persist the
// row first, then call pushNotification with the saved row's id.
//
// Usage:
//
//   import { pushNotification } from "../socket/socket.init";
//
//   // After persisting a new-follower notification row:
//   pushNotification(followingUserId, {
//     notificationId: savedRow.id,
//     type:           "new_follower",
//     title:          `${actor.fullName} started following you`,
//     actorId:        actorId,
//     entityType:     "user",
//     entityId:       actorId,
//     createdAt:      savedRow.createdAt.toISOString(),
//   });

export function pushNotification(userId: string, payload: NotificationEvent): void {
  if (!_io) throw new Error("[socket] pushNotification called before initSocket");
  _io.to(rooms.user(userId)).emit("notification", payload);
}