import { Conversation } from "../database/models/Conversation.model.js";
import {
  IMessage,
  TUser,
  TUserSockets,
  IConversation,
} from "../types/local/messaging.js";
import { CustomSocket } from "../types/local/socketIo.js";
import { Message } from "../database/models/Message.model.js";
import { ISucessError } from "../types/local/Info.js";
import { User } from "../database/models/User.model.js";
import { Op } from "@sequelize/core";
import { ConversationCard } from "./conversations.js";
import { Room } from "../database/models/Room.model.js";

export class MessageInstance {
  to: IConversation;
  message: {
    type: "message" | "system";
    content: string;
    status: "sent" | "delivered" | "read" | "failed to deliver";
    id?: number;
  };
  sendTo: string | string[] | undefined;
  from: TUser;

  constructor(message: IMessage, user: TUser) {
    this.to = message.to;
    this.message = message.message;
    this.sendTo = undefined;
    this.from = user;
    this.message.status = "sent";
  }
  updateRecipientsId(id: number) {
    this.to.id = id;
  }

  async setRecipient(recipients: TUserSockets, users?: number[]) {
    const { type, childId, id } = this.to;
    const { id: myId } = this.from;
    const conversation = await Conversation.findByPk(id, {
      include: [
        { model: User, where: { [Op.not]: { id: this.from.id } } },
        { model: Room },
      ],
    });

    const conversationCard = conversation
      ? new ConversationCard(conversation)
      : null;

    this.sendTo = await getRecipient(type, childId, myId, recipients, users);
    return conversationCard;
  }

  async saveMessage(): Promise<ISucessError> {
    const { id: userId } = this.from;
    const { id: conversationId } = this.to;
    const { content } = this.message;
    if (conversationId) {
      try {
        const savedMessage = await Message.create({
          userId,
          conversationId,
          content,
          status: "delivered",
        });
        this.message.id = savedMessage.id;
        this.message.status = "delivered";
        return { status: true, message: "Message saved successfully" };
      } catch (e) {
        console.error(e);
        this.message.status = "failed to deliver";
        return { status: false, message: "Couldn't add message to DB." };
      }
    } else {
      return { status: false, message: "No conversation id" };
    }
  }

  get messageBody() {
    return {
      to: this.to,
      from: this.from,
      message: this.message,
    };
  }
}

export const getRecipient = async (
  type: "room" | "user",
  childId: number,
  myId: number,
  recipients: TUserSockets,
  users?: number[]
) => {
  let sendTo: string | string[];
  if (typeof users === "undefined") {
    if (type === "room") {
      sendTo = "room" + childId;
    } else {
      const ids = [childId, myId];
      sendTo = ids.map((id) => recipients[id]).flat();
    }
  } else {
    sendTo = users.map((id) => recipients[id]).flat();
  }
  return sendTo;
};

export const sendMessage = (message: MessageInstance, socket: CustomSocket) => {
  let eventName = message.to.type;
  if (message.to.type === "user") {
    eventName += message.from.id;
  } else {
    eventName += message.to.childId;
  }
  const eventNameSelf = "user" + message.to.childId;
  if (typeof message.sendTo !== "undefined") {
    socket.to(message.sendTo).emit("message", message.messageBody);
    socket.to(message.sendTo).emit(eventName, message.messageBody);
    socket.to(message.sendTo).emit(eventNameSelf, message.messageBody);
  }
};

export const sendConfirmationMessage = (
  message: MessageInstance,
  conversation: ConversationCard,
  socket: CustomSocket,
  status: boolean
) => {
  if (status) {
    const eventName = "confirmation" + message.to.type + message.to.childId;
    socket.emit(eventName, { message: message.messageBody, conversation });
  } else {
    socket.emit("error", { message: "Couldn't send message" });
  }
};

export const readMessageConfirmation = async (
  socket: CustomSocket,
  users: TUserSockets,
  conversation: Conversation,
  messageId: number
) => {
  if (conversation && socket.user) {
    const { id } = socket.user;
    conversation.messages?.forEach(async (message) => {
      if (
        id !== message.user.id &&
        message.status === "delivered" &&
        message.id <= messageId
      ) {
        message.status = "seen";
        await message.save();
      }
    });
    conversation.users?.forEach((user) => {
      if (user.id !== socket.user?.id) {
        const userSockets = users[user.id];
        if (userSockets) {
          userSockets.forEach((socketId) => {
            socket.broadcast.to(socketId).emit("readMessages", {
              conversationId: conversation.id,
              messageId,
            });
          });
        }
      }
    });
  }
};
