'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const router = useRouter()

  const handleJoinApp = () => {
    if (!username.trim()) return
    localStorage.setItem('username', username.trim())
    router.push('/chat')
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-[380px] py-10">
        <CardHeader>
          <CardTitle className="text-2xl">歡迎來到聊天室</CardTitle>
          <CardDescription className="text-base">請輸入暱稱：</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Input
              type="text"
              placeholder="暱稱"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinApp()}
            />
            <Button onClick={handleJoinApp}>加入</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
