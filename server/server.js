const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors()); // 跨域，開發用，正式要設定白名單
app.use(express.json());

// 建立 uploads 資料夾
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 設定 Multer 儲存設定 (檔名用時間戳+原檔名)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + file.originalname;
    cb(null, uniqueSuffix);
  }
});
const upload = multer({ storage });

// 靜態檔案存取 (提供上傳後的圖片可被取用)
app.use('/uploads', express.static(uploadDir));

// 以集合儲存所有已註冊的使用者名稱
const globalUserList = new Set();

/**
 * 使用者資料
 * socketUserMap: {
 *   [socket.id]: {
 *     username: string
 *   }
 * }
 */
const socketUserMap = {};

/**
 * 聊天室資料
 * chatRooms: {
 *   [roomId]: {
 *     id: string,
 *     name: string, // 群組聊天室名稱；一對一則用對方名稱
 *     isGroup: boolean, // true: 群組, false: 1v1
 *     participants: string[], // 參與的使用者名稱陣列
 *     messages: [
 *       {
 *         sender: string,
 *         text: string,
 *         time: string
 *       },
 *       ...
 *     ],
 *     lastReadMap: {
 *       [username]: number // 使用者目前已讀到第幾筆訊息(以 messages 長度為基準)
 *     },
 *     lastMessage: string,
 *     lastUpdateTime: number, // 用 timestamp 來排序
 *   }
 * }
 */
const chatRooms = {};

// 產生聊天室 ID
let roomIdCounter = 1;
function generateRoomId() {
  return `room_${roomIdCounter++}`;
}

// 正在通話的參與者資訊: callParticipants[roomId] = Set of userNames，用於標示「哪些用戶目前正在該聊天室進行通話」
const callParticipants = {};

// 取得 socket 對應的使用者名稱
function getUsernameFromSocketId(socketId) {
  return socketUserMap[socketId]?.username || null;
}

// 當前時間戳
function now() {
  return Date.now(); // 毫秒
}

// 計算某使用者可見的聊天室列表(含排序及未讀)
function getUserRooms(username) {
  const userRooms = Object.values(chatRooms).filter((room) =>
    room.participants.includes(username)
  );

  // 按 lastUpdateTime 降冪排序（最新訊息的聊天室在最上面）
  userRooms.sort((a, b) => b.lastUpdateTime - a.lastUpdateTime);

  // 計算未讀數
  const data = userRooms.map((room) => {
    const totalMessages = room.messages.length;
    const readCount = room.lastReadMap[username] || 0;
    const unreadCount = totalMessages - readCount;
    return {
      id: room.id,
      name: room.name,
      isGroup: room.isGroup,
      lastMessage: room.lastMessage,
      lastUpdateTime: room.lastUpdateTime,
      unreadCount,
      // 此聊天室是否正在通話
      inCall: !!callParticipants[room.id] && callParticipants[room.id].size > 0,
      // callParticipants 數量
      callCount: callParticipants[room.id] ? callParticipants[room.id].size : 0
    };
  });
  return data;
}

// 更新指定使用者的聊天室列表
function updateUserRooms(username) {
  // 取得該使用者可見的聊天室資料
  const rooms = getUserRooms(username);
  // 找到所有 socket，將 roomsUpdated 發送給屬於該 username 的連線
  for (let socketId in socketUserMap) {
    if (socketUserMap[socketId].username === username) {
      io.to(socketId).emit('roomsUpdated', rooms);
    }
  }
}

// HTTP API: 取得所有已註冊的使用者
app.get('/users', (req, res) => {
  // 字串陣列回傳所有使用者
  res.json(Array.from(globalUserList));
});

// HTTP API: 上傳圖片
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // 回傳圖片的 URL (相對後端)
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 前端網址
    methods: ["GET", "POST"]
  }
});

/* ===================== Socket.IO ======================= */
io.on('connection', (socket) => {
  console.log('使用者連線:', socket.id);

  // 使用者註冊名稱
  socket.on('registerUser', (username) => {
    socketUserMap[socket.id] = { username };
    globalUserList.add(username);
    console.log(`使用者 ${username} 登入 (socket: ${socket.id})`);
    updateUserRooms(username);
    // 通知所有使用者更新使用者列表
    io.emit('usersUpdated', Array.from(globalUserList));
  });

  // 創建聊天室(群組 / 1對1)，data: { isGroup, roomName, participants: [username1, username2, ...] }
  socket.on('createRoom', (data) => {
    const { isGroup, roomName, participants } = data;
    if (!participants || participants.length === 0) return;

    // 不重複建立 1v1 聊天室
    if (!isGroup && participants.length === 2) {
      const [userA, userB] = participants;
      // 檢查是否已存在 1v1 聊天室
      const existingRoom = Object.values(chatRooms).find(r =>
        !r.isGroup &&
        r.participants.length === 2 &&
        r.participants.includes(userA) &&
        r.participants.includes(userB)
      );
      if (existingRoom) {
        console.log(`已存在相同1對1聊天室: ${existingRoom.id}, 不重複建立`);
        return;
      }
    }

    const newRoomId = generateRoomId();
    let finalRoomName = roomName || '未命名群組';
    if (!isGroup && participants.length === 2) {
      finalRoomName = `${participants[0]} & ${participants[1]}`;
    }

    chatRooms[newRoomId] = {
      id: newRoomId,
      name: finalRoomName,
      isGroup,
      participants: participants,
      messages: [],
      lastReadMap: {},
      lastMessage: "",
      lastUpdateTime: now()
    };

    // 初始化 lastReadMap
    participants.forEach((user) => {
      chatRooms[newRoomId].lastReadMap[user] = 0;
    });

    console.log(`建立聊天室: ${newRoomId}, participants=${participants}`);
    // 通知所有參與者更新聊天室列表
    participants.forEach((user) => updateUserRooms(user));
  });

  // 加入聊天室 (文字聊天)
  socket.on('joinRoom', (roomId) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;

    // 如果該聊天室不存在或不包含該使用者就不處理
    const roomData = chatRooms[roomId];
    if (!roomData || !roomData.participants.includes(username)) return;

    // Socket 實際的 join
    socket.join(roomId);
    console.log(`${username} 加入聊天室: ${roomId}`);

    // 將使用者的 lastReadMap 設為目前訊息總數 => unread 歸零
    roomData.lastReadMap[username] = roomData.messages.length;

    // 將該聊天室所有歷史訊息傳給此用戶
    socket.emit('roomMessages', roomData.messages);

    // 更新該使用者的聊天室列表 (未讀數歸零)
    updateUserRooms(username);
  });

  // 傳送文字訊息，data: { roomId, text }
  socket.on('sendMessage', (data) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;

    const { roomId, text } = data;
    const roomData = chatRooms[roomId];
    if (!roomData || !roomData.participants.includes(username)) return;

    const timeStr = new Date().toLocaleString();
    const messageObj = {
      sender: username,
      text,
      time: timeStr,
      type: 'text'
    };

    roomData.messages.push(messageObj);
    roomData.lastMessage = text;
    roomData.lastUpdateTime = now();

    // 發訊息的人，已讀+1
    roomData.lastReadMap[username] = roomData.messages.length;

    // 其他人未讀不變

    // 送給該聊天室所有 socket
    io.to(roomId).emit('newMessage', messageObj);

    // 通知所有參與者更新各自的聊天室列表(排序/未讀)
    roomData.participants.forEach((user) => updateUserRooms(user));
  });

  // 傳送圖片訊息
  socket.on('sendImageMessage', (data) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;
    const { roomId, imageUrl } = data;
    const roomData = chatRooms[roomId];
    if (!roomData || !roomData.participants.includes(username)) return;

    const timeStr = new Date().toLocaleString();
    const messageObj = {
      sender: username,
      text: imageUrl,
      time: timeStr,
      type: 'image'
    };

    roomData.messages.push(messageObj);
    roomData.lastMessage = '[圖片]';
    roomData.lastUpdateTime = now();
    roomData.lastReadMap[username] = roomData.messages.length;

    io.to(roomId).emit('newMessage', messageObj);
    roomData.participants.forEach((user) => updateUserRooms(user));
  });

  // 已讀訊息
  socket.on('readRoom', (roomId) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;
    const roomData = chatRooms[roomId];
    if (!roomData || !roomData.participants.includes(username)) return;
    // 將已讀計數更新為 messages.length
    roomData.lastReadMap[username] = roomData.messages.length;
    updateUserRooms(username);
  });

  /* =============== 多人 WebRTC 通話 (Mesh P2P) ================= */
  // 進入通話，廣播給同聊天室參與者，data: { roomId, type: 'video' | 'audio' }
  socket.on('joinCall', (data) => {
    const { roomId, type } = data;
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;

    const roomData = chatRooms[roomId];
    if (!roomData || !roomData.participants.includes(username)) return;

    // 紀錄此 user 已參與該通話
    if (!callParticipants[roomId]) {
      callParticipants[roomId] = new Set();
    }
    callParticipants[roomId].add(username);

    if (!roomData.isGroup && roomData.participants.length === 2) {
      if (callParticipants[roomId].size === 2) {
        // 已在通話中，不再通知
        return;        
      }
      // 告訴該使用者對方是誰，並詢問是否要通話
      const otherUser = roomData.participants.filter(u => u !== username);
      socket.emit('callMembers', { otherUser, type });
    } else {
      // 告訴該使用者目前已在通話的成員有哪些(不包含自己)
      const otherUser = [...callParticipants[roomId]].filter(u => u !== username);
      // 回傳給自己
      socket.emit('callMembers', { otherUser, type });

      // 通知其他人有新成員進入通話
      roomData.participants.forEach((user) => {
        if (user === username) return; // 不通知自己
        // 如果是群組聊天室，則通知所有在此聊天室且已經在通話中的 socket
        if (callParticipants[roomId].has(user)) {
          for (let sId in socketUserMap) {
            if (socketUserMap[sId].username === user) {
              io.to(sId).emit('newPeer', { username, type });
            }
          }
        }
      });
    }
    // 更新聊天室列表 (inCall 狀態)
    roomData.participants.forEach((user) => updateUserRooms(user));
  });
  
  // 拒絕通話
  socket.on('rejectCall', (targetUser) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;
    console.log(`${username} 拒絕與 ${targetUser} 通話`);

    // 通知對方已被拒絕，並告知拒絕者是誰
    for (let sId in socketUserMap) {
      if (socketUserMap[sId].username === targetUser) {
        io.to(sId).emit('callRejected', { from: username });
      }
    }
  });

  // 離開通話
  socket.on('leaveCall', (roomId) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;

    const roomData = chatRooms[roomId];
    if (!roomData) return;

    if (callParticipants[roomId]) {
      callParticipants[roomId].delete(username);
      // 廣播給其他人此使用者已離開
      roomData.participants.forEach((user) => {
        if (callParticipants[roomId].has(user)) {
          for (let sId in socketUserMap) {
            if (socketUserMap[sId].username === user) {
              io.to(sId).emit('removePeer', { username });
            }
          }
        }
      });
    }
    // 若該 room 沒人則刪除
    if (callParticipants[roomId] && callParticipants[roomId].size === 0) {
      delete callParticipants[roomId];
    }
    // 更新聊天室列表 (inCall 狀態)
    roomData.participants.forEach((user) => updateUserRooms(user));
  });

  // 發送 Offer (針對特定用戶)
  socket.on('sendOffer', (data) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;
    const { roomId, targetUser, offer, type } = data;

    // 找到對方 socketId
    for (let sId in socketUserMap) {
      if (socketUserMap[sId].username === targetUser) {
        io.to(sId).emit('receiveOffer', { from: username, offer, roomId, type });
      }
    }
  });

  // 發送 Answer (針對特定用戶)
  socket.on('sendAnswer', (data) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;
    const { roomId, targetUser, answer } = data;

    for (let sId in socketUserMap) {
      if (socketUserMap[sId].username === targetUser) {
        io.to(sId).emit('receiveAnswer', { from: username, answer });
      }
    }
  });

  // ICE Candidate (針對特定用戶)
  socket.on('sendICECandidate', (data) => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) return;
    const { roomId, targetUser, candidate } = data;

    for (let sId in socketUserMap) {
      if (socketUserMap[sId].username === targetUser) {
        io.to(sId).emit('receiveICECandidate', { from: username, candidate });
      }
    }
  });

  // 使用者斷線
  socket.on('disconnect', () => {
    const username = getUsernameFromSocketId(socket.id);
    if (!username) {
      console.log(`未知使用者斷線: ${socket.id}`);
      return;
    }
    console.log(`使用者斷線: ${username} (socket: ${socket.id})`);
    delete socketUserMap[socket.id];

    // 若有參加中的通話需離開
    for (let roomId in callParticipants) {
      if (callParticipants[roomId].has(username)) {
        callParticipants[roomId].delete(username);
        // 通知其他成員
        const roomData = chatRooms[roomId];
        if (roomData) {
          roomData.participants.forEach((user) => {
            if (callParticipants[roomId].has(user)) {
              for (let sId in socketUserMap) {
                if (socketUserMap[sId].username === user) {
                  io.to(sId).emit('removePeer', { username });
                }
              }
            }
          });
          // 若該 room 沒人則刪除
          if (callParticipants[roomId].size === 0) {
            delete callParticipants[roomId];
          }
          // 更新聊天室列表 (inCall 狀態)
          roomData.participants.forEach((user) => updateUserRooms(user));
        }
      }
    }
  });
});

// 測試用
app.get('/', (req, res) => {
  res.send("Chat server is running.");
});

// 啟動
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
