'use client'

import { useState } from 'react'
import { Users, User } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"

export default function RoomCreateModal({
  onClose,
  onCreate,
  currentUsername,
  userList,
}) {
  const [isGroup, setIsGroup] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [selectedUsers, setSelectedUsers] = useState([])

  const handleSetIsGroup = (val) => {
    setIsGroup(val === "group")
    if (val !== "group" && selectedUsers.length > 1) {
      setSelectedUsers([])
    }
  }

  const handleToggleUser = (user) => {
    if (user === currentUsername) return
    if (selectedUsers.includes(user)) {
      setSelectedUsers(selectedUsers.filter((u) => u !== user))
    } else {
      setSelectedUsers([...selectedUsers, user])
    }
  }

  const handleSubmit = () => {
    if (isGroup) {
      if (selectedUsers.length < 1) {
        alert('群組聊天室至少需選擇1位參與者')
        return
      }
      if (!roomName.trim()) {
        alert('請輸入群組名稱')
        return
      }
      onCreate({
        isGroup: true,
        roomName,
        participants: [...selectedUsers],
      })
    } else {
      // 1對1
      if (selectedUsers.length !== 1) {
        alert('1對1 聊天請選擇一位使用者')
        return
      }
      onCreate({
        isGroup: false,
        roomName: '',
        participants: [...selectedUsers],
      })
    }
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>建立新聊天室</DialogTitle>
          <DialogDescription>選擇聊天類型並添加參與者來開始對話</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <RadioGroup defaultValue="private" onValueChange={handleSetIsGroup} className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="private" id="private" />
              <Label htmlFor="private" className="flex items-center gap-1.5">
                <User size={16} />
                1對1 聊天
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="group" id="group" />
              <Label htmlFor="group" className="flex items-center gap-1.5">
                <Users size={16} />
                群組聊天室
              </Label>
            </div>
          </RadioGroup>

          {isGroup && (
            <div className="grid gap-2">
              <Label htmlFor="roomName">群組名稱</Label>
              <Input
                id="roomName"
                placeholder="輸入群組名稱"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label>選擇參與者 (除你自己)</Label>
            <ScrollArea className="h-[180px] border rounded-md p-2">
              {userList
                .filter((u) => u !== currentUsername)
                .map((user) => (
                  <div key={user} className="flex items-center space-x-2 py-2">
                    <Checkbox
                      id={`user-${user}`}
                      checked={selectedUsers.includes(user)}
                      onCheckedChange={() => handleToggleUser(user)}
                    />
                    <Label htmlFor={`user-${user}`} className="cursor-pointer">
                      {user}
                    </Label>
                  </div>
                ))}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit}>建立</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
