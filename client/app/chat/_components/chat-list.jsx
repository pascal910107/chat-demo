import { MessageCirclePlus, Search, Users } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export default function ChatList({
  rooms,
  currentRoomId,
  onSelectRoom,
  onOpenCreateModal,
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const filteredRooms = rooms.filter((room) => room.name.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="w-80 border-r border-border bg-card flex flex-col h-full md:w-72 sm:w-full sm:max-w-[260px]">
      {/* 標題區 */}
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-primary">我的聊天室</h2>
          <Button onClick={onOpenCreateModal} size="icon" variant="ghost" className="h-8 w-8 text-primary">
            <MessageCirclePlus size={20} />
            <span className="sr-only">新聊天室</span>
          </Button>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋聊天室..."
            className="pl-8 h-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <Separator />

      {/* 聊天室清單 */}
      <ScrollArea className="flex-1">
        {filteredRooms.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">沒有找到聊天室</div>
        ) : (
          filteredRooms.map((room) => {
            const isSelected = room.id === currentRoomId
            return (
              <div
                key={room.id}
                className={cn(
                  "p-3 border-b border-border cursor-pointer transition-colors",
                  isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted",
                )}
                onClick={() => onSelectRoom(room.id)}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="font-medium flex items-center gap-1.5">
                    {room.isGroup && <Users size={14} className="text-muted-foreground" />}
                    <span className={cn(isSelected && "text-primary")}>{room.name}</span>
                  </div>
                  {room.unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                      {room.unreadCount}
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground truncate">{room.lastMessage || "(尚無訊息)"}</div>
                {/* 顯示通話狀態 */}
                {room.inCall && (
                  <div className="text-xs text-primary flex items-center gap-1 mt-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse"></span>
                    通話中 ({room.callCount} 人)
                  </div>
                )}
              </div>
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}
