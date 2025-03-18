'use client'

import { useState, useEffect, useRef } from "react"
import { Image, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export default function ChatMessages({
  currentRoomId,
  rooms,
  messages,
  onSendMessage,
  onUploadImage,
  socketRef,
}) {
  const [text, setText] = useState('')
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)

  // 自動捲到底
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const handleSend = () => {
    if (!text.trim()) return
    onSendMessage(text.trim())
    setText('')
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClickMessagesArea = () => {
    if (currentRoomId) {
      socketRef.current.emit('readRoom', currentRoomId);
    }
  };

  if (!currentRoomId) {
    return (
      <div className="flex-1 flex flex-col bg-card">
        <div className="flex-1 flex items-center justify-center flex-col p-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <MessageIcon className="h-8 w-8 text-primary" />
          </div>
          <span className="text-muted-foreground text-center">請選擇或建立一個聊天室開始對話</span>
        </div>
      </div>
    )
  }

  const room = rooms.find((r) => r.id === currentRoomId)
  if (!room) {
    return (
      <div className="flex-1 flex flex-col bg-card">
        <div className="flex-1 flex items-center justify-center">
          <span className="text-muted-foreground">你無權限查看此聊天室或聊天室不存在</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-card" onClick={handleClickMessagesArea}>
      {/* 聊天室標題 */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{room.name}</h2>
          <span className="text-xs text-muted-foreground">{room.isGroup ? "群組聊天室" : "1對1 聊天"}</span>
        </div>
      </div>

      {/* 聊天訊息列表 */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg, idx) => {
            // Get initials for avatar
            const initials = msg.sender
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .substring(0, 2)

            return (
              <div key={idx} className="flex items-start gap-3">
                <Avatar className="h-8 w-8 bg-primary/20 text-primary">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{msg.sender}</span>
                    <span className="text-xs text-muted-foreground">{msg.time}</span>
                  </div>
                  {msg.type === "text" && <div className="rounded-md bg-muted p-3 text-sm">{msg.text}</div>}
                  {msg.type === "image" && (
                    <div className="rounded-md overflow-hidden border border-border">
                      <img
                        src={msg.text || "/placeholder.svg"}
                        alt="uploaded"
                        className="max-w-xs max-h-64 object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <Separator />

      {/* 送出訊息區 */}
      <div className="p-4 flex items-center gap-2">
        <Button variant="outline" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
          <Image size={18} />
          <span className="sr-only">上傳圖片</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onUploadImage(e.target.files[0])
                e.target.value = null
              }
            }}
          />
        </Button>
        <Input
          className="flex-1"
          placeholder="輸入訊息..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button onClick={handleSend} className="shrink-0" disabled={!text.trim()}>
          <Send size={18} className="mr-2" />
          送出
        </Button>
      </div>
    </div>
  )
}

function MessageIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
