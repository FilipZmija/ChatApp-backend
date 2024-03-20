import express from "express";
import http from "http";
import dotenv from "dotenv";
import { sequelize } from "./database/init.js";
import cors from "cors";
import user from "./routes/user.js";
import room from "./routes/room.js";
import conversation from "./routes/conversation.js";
import { ServerSocket } from "./sockets/socket.js";

dotenv.config();
const app = express();
const server = http.createServer(app);

new ServerSocket(server);

app.use(
  cors({
    origin: process.env.ORIGIN,
  })
);
app.use(express.json({ limit: "100mb" }));
app.use("/user", user);
app.use("/room", room);
app.use("/conversation", conversation);

(async () => {
  try {
    await sequelize.sync();
    server.listen(process.env.PORT, () =>
      console.log(`Listening on port ${process.env.PORT}`)
    );
  } catch (error) {
    console.error("Error starting server:", error);
  }
})();
