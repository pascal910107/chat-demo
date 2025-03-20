'use client'

import CallSection from './call-section'
import ChatList from './chat-list'
import ChatMessages from './chat-messages'
import RoomCreateModal from './room-create-modal'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import io from 'socket.io-client'

const SERVER_URL = 'http://localhost:4000'

export default function ChatApp() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [rooms, setRooms] = useState([])
  const [currentRoomId, setCurrentRoomId] = useState(null)
  const [messages, setMessages] = useState([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [userList, setUserList] = useState([])

  // Socket
  const socketRef = useRef(null)

  // 初始化 Socket.IO
  useEffect(() => {
    const storedUsername = localStorage.getItem('username')
    if (!storedUsername) {
      router.push('/')
    } else {
      setUsername(storedUsername)
      // 建立 socket 連線
      const socket = io(SERVER_URL)
      socketRef.current = socket

      // 註冊使用者
      socket.emit('registerUser', storedUsername)

      // 監聽後端：使用者聊天室列表更新
      socket.on('roomsUpdated', (updatedRooms) => {
        setRooms(updatedRooms)
      })

      // 監聽後端：取得聊天室歷史訊息
      socket.on('roomMessages', (roomMessages) => {
        setMessages(roomMessages)
      })

      // 監聽後端：有新訊息時更新訊息列表
      socket.on('newMessage', (messageObj) => {
        setMessages((prev) => [...prev, messageObj])
      })

      socket.on('usersUpdated', (list) => {
        setUserList(list)
      })

      // 清理 socket 連線
      return () => {
        socket.disconnect()
      }
    }
  }, [])

  // 抓取使用者清單
  useEffect(() => {
    axios
      .get(`${SERVER_URL}/users`)
      .then((res) => setUserList(res.data || []))
      .catch((err) => console.error(err))
  }, [])

  // 建立聊天室
  const handleCreateRoom = (roomData) => {
    // roomData: { isGroup, roomName, participants: [] }
    // participants 要包含自己
    if (!roomData.participants.includes(username)) {
      roomData.participants.push(username)
    }
    socketRef.current.emit('createRoom', roomData)
    setShowCreateModal(false)
  }

  // 選擇聊天室
  const handleSelectRoom = (roomId) => {
    if (roomId === currentRoomId) return
    setCurrentRoomId(roomId)
    setMessages([])
    socketRef.current.emit('joinRoom', roomId)
  }

  // 送文字訊息
  const handleSendMessage = (text) => {
    if (!currentRoomId) return
    socketRef.current.emit('sendMessage', { roomId: currentRoomId, text })
  }

  // 上傳圖片並傳送圖片訊息
  const handleUploadImage = async (file) => {
    if (!currentRoomId || !file) return
    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await axios.post(`${SERVER_URL}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const imageUrl = res.data.url
      socketRef.current.emit('sendImageMessage', {
        roomId: currentRoomId,
        imageUrl,
      })
    } catch (err) {
      console.error('上傳失敗', err)
    }
  }

  return (
    <div className="h-screen flex bg-muted/30">
      <ChatList
        rooms={rooms}
        currentRoomId={currentRoomId}
        onSelectRoom={handleSelectRoom}
        onOpenCreateModal={() => setShowCreateModal(true)}
      />
      <div className="flex-1 flex flex-col">
        <ChatMessages
          currentRoomId={currentRoomId}
          rooms={rooms}
          messages={messages}
          onSendMessage={handleSendMessage}
          onUploadImage={handleUploadImage}
          socket={socketRef.current}
        />
        {/* 通話區域 */}
        <CallSection
          socket={socketRef.current}
          username={username}
          currentRoomId={currentRoomId}
          isGroup={rooms.find((r) => r.id === currentRoomId)?.isGroup}
          handleSelectRoom={handleSelectRoom}
        />
      </div>

      {showCreateModal && (
        <RoomCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateRoom}
          currentUsername={username}
          userList={userList}
        />
      )}
    </div>
  )
}
