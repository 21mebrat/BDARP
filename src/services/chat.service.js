// ═══════════════════════════════════════════════════════════════════════════
// socket/handlers/chat.handler.ts
//
// Handles all real-time chat events for a single connected socket.
//
// Room conventions (defined once here, used consistently everywhere):
//
//   conversation:<id>   — receives messages, typing updates, read receipts.
//                         Every participant of that conversation joins this room.
//
//   presence:<id>       — lightweight overlay on top of conversation:<id>
//                         that carries ONLY online/offline events.
//                         Keeps presence subscribers decoupled from the full
//                         message stream.
//
// ═══════════════════════════════════════════════════════════════════════════

import { type AppSocket, type AppServer, isOnline } from "../socket.js";
import {
  ConversationPayload,
  SendMessagePayload,
  TypingPayload,
  NewMessageEvent,
  ReadReceiptEvent,
  TypingEvent,
  PresenceEvent,
  NotificationEvent,
} from "../types/socket.types.ts";

// ─── Room name helpers (single source of truth) ───────────────────────────

export const rooms = {
  user:         (userId: string)         => `user:${userId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  presence:     (conversationId: string) => `presence:${conversationId}`,
} as const;

// ─── Handler registration ─────────────────────────────────────────────────

/**
 * Attaches all chat-related event listeners to the given socket.
 * Called once per connection from the main socket initialiser.
 */
export function registerChatHandlers(socket: AppSocket, io: AppServer): void {
  const userId = socket.data.userId;

  // ── joinConversation ─────────────────────────────────────────────────
  //
  // Joins the message room and the lightweight presence room.
  // Notifies existing participants that this user is now active.
  socket.on("joinConversation", ({ conversationId }: ConversationPayload): void => {
    if (!conversationId) return;

    socket.join(rooms.conversation(conversationId));
    socket.join(rooms.presence(conversationId));

    const event: PresenceEvent = { userId, isOnline: true };
    socket.to(rooms.presence(conversationId)).emit("presenceUpdate", event);
  });

  // ── leaveConversation ────────────────────────────────────────────────
  //
  // Leaves both rooms and reports the user's real online state.
  // The user may still be online in another tab — isOnline() accounts for that.
  socket.on("leaveConversation", ({ conversationId }: ConversationPayload): void => {
    if (!conversationId) return;

    socket.leave(rooms.conversation(conversationId));
    socket.leave(rooms.presence(conversationId));

    const event: PresenceEvent = { userId, isOnline: isOnline(userId) };
    socket.to(rooms.presence(conversationId)).emit("presenceUpdate", event);
  });

  // ── sendMessage ──────────────────────────────────────────────────────
  //
  // Full flow:
  //  1. Validate required fields.
  //  2. Persist the message via ChatMessageService (stub shown inline).
  //  3. Broadcast the enriched event to all sockets in the conversation room
  //     (including the sender — needed for multi-tab/device sync).
  //  4. Push a "new_message" notification to every other participant's
  //     private user room via pushNotification().
  socket.on("sendMessage", async (payload: SendMessagePayload): Promise<void> => {
    const { conversationId, tempId, content, messageType, metadata, replyToMessageId } = payload;
    if (!conversationId || !tempId) return;

    try {
      // ── Persist ────────────────────────────────────────────────────────
      // Replace the two stub lines below with your service call:
      //
      // const saved = await ChatMessageService.create({
      //   conversationId,
      //   senderId:          userId,
      //   content,
      //   messageType:       messageType ?? "text",
      //   metadata:          metadata    ?? null,
      //   replyToMessageId:  replyToMessageId ?? null,
      // });
      //
      // const messageId = saved.id;
      // const createdAt = saved.createdAt.toISOString();
      const messageId = crypto.randomUUID(); // ← replace with saved.id
      const createdAt = new Date().toISOString(); // ← replace with saved.createdAt.toISOString()

      // ── Broadcast to conversation ──────────────────────────────────────
      const newMessageEvent: NewMessageEvent = {
        conversationId,
        tempId,
        messageId,
        senderId:          userId,
        content,
        messageType:       messageType ?? "text",
        metadata,
        replyToMessageId,
        createdAt,
      };

      // io.to() (not socket.to()) includes the sender — important for multi-tab.
      io.to(rooms.conversation(conversationId)).emit("newMessage", newMessageEvent);

      // ── Fan-out notifications ──────────────────────────────────────────
      // Fetch participant IDs from the DB, then push to each recipient's
      // private room so they see an unread badge even if they're not in the
      // conversation room at that moment.
      //
      // const participantIds =
      //   await ConversationService.getParticipantIds(conversationId);
      //
      // for (const recipientId of participantIds) {
      //   if (recipientId === userId) continue;
      //
      //   const notif: NotificationEvent = {
      //     notificationId: crypto.randomUUID(), // ← use saved notification row id
      //     type:           "new_message",
      //     title:          "New message",
      //     body:           content.slice(0, 100),
      //     actorId:        userId,
      //     entityType:     "conversation",
      //     entityId:       conversationId,
      //     createdAt,
      //   };
      //
      //   io.to(rooms.user(recipientId)).emit("notification", notif);
      // }

    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : "Unexpected error";
      socket.emit("messageError", { tempId, error });
    }
  });

  // ── markRead ─────────────────────────────────────────────────────────
  //
  // Updates conversation_participants.last_read_at in the DB and broadcasts
  // a read receipt so other participants can render "Seen" ticks.
  socket.on("markRead", async ({ conversationId }: ConversationPayload): Promise<void> => {
    if (!conversationId) return;

    const readAt = new Date().toISOString();

    // await ConversationService.markRead(conversationId, userId);

    const event: ReadReceiptEvent = { conversationId, userId, readAt };

    // socket.to() excludes the reader — they already know they read it.
    socket.to(rooms.conversation(conversationId)).emit("readReceipt", event);
  });

  // ── typing ────────────────────────────────────────────────────────────
  //
  // Pure relay — no persistence needed.
  // Clients should throttle: emit once on first keypress, then once every
  // ~2 s while typing, and finally { isTyping: false } on blur or send.
  socket.on("typing", ({ conversationId, isTyping }: TypingPayload): void => {
    if (!conversationId) return;

    const event: TypingEvent = { conversationId, userId, isTyping };
    socket.to(rooms.conversation(conversationId)).emit("typingUpdate", event);
  });
}