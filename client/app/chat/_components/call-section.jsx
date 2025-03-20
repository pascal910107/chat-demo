'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Phone, PhoneOff, Video, Mic, MicOff } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export default function CallSection({
  socket,
  username,
  currentRoomId,
  isGroup,
  handleSelectRoom,
}) {
  const [inCall, setInCall] = useState(false) // 是否已加入通話
  const [callUsers, setCallUsers] = useState([]) // 目前通話中的成員 (不含自己)
  const [videoStreams, setVideoStreams] = useState({}) // { [user]: MediaStream }
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const localStreamRef = useRef(null) // 自己的音/視訊
  const peerConnectionsRef = useRef({}) // { [user]: RTCPeerConnection }
  const pendingCandidatesRef = useRef({}) // { [remoteUser]: candidate[] }
  const [callType, setCallType] = useState('video') // 'video' | 'audio'

  // 加入通話
  const joinCall = async (type, roomIdParam) => {
    const roomId = roomIdParam || currentRoomId
    console.log('加入通話:', roomId)

    if (!socket || !roomId) return
    // 先取得自己音視頻
    setCallType(type)
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true,
      })
    } catch (err) {
      console.error('取得媒體失敗:', err)
      return
    }
    socket.emit('joinCall', { roomId, type })
    setInCall(true)
    if (type === 'video') {
      // 顯示本地視訊
      setVideoStreams((prev) => ({
        ...prev,
        [username]: localStreamRef.current,
      }))
    }
  }

  // 離開通話
  const leaveCall = () => {
    if (!socket || !currentRoomId) return
    socket.emit('leaveCall', currentRoomId)
    // 關閉所有 Peer
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close())
    peerConnectionsRef.current = {}
    // 關閉本地媒體串流
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    setVideoStreams({})
    setCallUsers([])
    setInCall(false)
    setIsMuted(false)
    setIsVideoOff(false)
  }

  // 切換麥克風
  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  // 切換視訊
  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsVideoOff(!isVideoOff)
    }
  }

  // 建立或回應 PeerConnection
  async function createPeerConnection(
    type,
    remoteUser,
    isInitiator,
    remoteOffer = null,
  ) {
    // 防重複
    if (peerConnectionsRef.current[remoteUser]) {
      console.warn('已經有連線了:', remoteUser)
      return
    }
    // 配置 ICE servers (STUN/TURN)
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      // { urls: "turn:xxx", username: "xxx", credential: "xxx" }
    })
    peerConnectionsRef.current[remoteUser] = pc

    // 加入本地媒體 track
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    // 當接收到遠端串流時更新畫面
    pc.ontrack = (event) => {
      // event.streams[0] 是對方的音/視訊
      setVideoStreams((prev) => ({
        ...prev,
        [remoteUser]: event.streams[0],
      }))
    }

    // 當 ICE candidate 產生時，送出給對方
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('sendICECandidate', {
          roomId: currentRoomId,
          targetUser: remoteUser,
          candidate: event.candidate,
        })
      }
    }

    // 若有遠端 Offer 則設定並回應 Answer
    if (remoteOffer) {
      await pc.setRemoteDescription(remoteOffer)
      if (pendingCandidatesRef.current[remoteUser]) {
        for (let candidate of pendingCandidatesRef.current[remoteUser]) {
          await pc.addIceCandidate(candidate)
        }
        delete pendingCandidatesRef.current[remoteUser]
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('sendAnswer', {
        roomId: currentRoomId,
        targetUser: remoteUser,
        answer,
      })
    } else if (isInitiator) {
      // 若為發起端則創建 Offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('sendOffer', {
        roomId: currentRoomId,
        targetUser: remoteUser,
        offer,
        type,
      })
    }
  }

  // 當 server 回傳 callMembers (已在通話中其他成員)
  useEffect(() => {
    if (!socket) return
    const handleCallMembers = ({ otherUser, type }) => {
      console.log('callMembers:', otherUser, type)

      // 1v1直接建立連線
      if (!isGroup) {
        if (otherUser.length === 0) return
        const [targetUser] = otherUser
        createPeerConnection(type, targetUser, true)
      } else {
        // 逐一跟這些成員做 p2p 連線，根據使用者名稱大小來決定誰發起連線
        // createOffer -> sendOffer
        otherUser.forEach((m) => {
          const isInitiator = username < m // 若自己的 username 字串較小，則發起連線
          createPeerConnection(type, m, isInitiator)
        })
        setCallUsers(otherUser)
      }
    }
    socket.on('callMembers', handleCallMembers)

    const handleNewPeer = ({ username: newUser, type }) => {
      if (!isGroup) {
        return
      }

      // 群組有人新加入，跟他做 p2p
      setCallUsers((prev) => {
        if (prev.includes(newUser)) return prev
        return [...prev, newUser]
      })
      // 根據使用者名稱大小來決定誰發起連線
      const isInitiator = username < newUser
      createPeerConnection(type, newUser, isInitiator)
    }
    socket.on('newPeer', handleNewPeer)

    const handleCallRejected = ({ from: rejectUser }) => {
      // 1v1的對方拒絕通話
      if (!isGroup) {
        toast(`${rejectUser} 拒絕了您的通話邀請`)
        leaveCall()
      }
    }
    socket.on('callRejected', handleCallRejected)

    const handleRemovePeer = ({ username: removeUser }) => {
      // 有人退出通話
      setCallUsers((prev) => prev.filter((u) => u !== removeUser))
      // 關閉peer
      const pc = peerConnectionsRef.current[removeUser]
      if (pc) {
        pc.close()
        delete peerConnectionsRef.current[removeUser]
      }
      // 移除該user的video
      setVideoStreams((prev) => {
        const updated = { ...prev }
        delete updated[removeUser]
        return updated
      })
    }
    socket.on('removePeer', handleRemovePeer)

    // 收到對方 Offer
    const handleReceiveOffer = async ({ from, offer, roomId, type }) => {
      // 建立 peerConnection, setRemoteDescription(offer), createAnswer -> sendAnswer，如果已存在 peerConnection，則直接設定 remoteDescription 並回應 answer
      let pc = peerConnectionsRef.current[from]
      if (pc) {
        await pc.setRemoteDescription(offer)
        // 處理暫存的 ICE 候選人
        if (pendingCandidatesRef.current[from]) {
          for (let candidate of pendingCandidatesRef.current[from]) {
            await pc.addIceCandidate(candidate)
          }
          delete pendingCandidatesRef.current[from]
        }
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('sendAnswer', {
          roomId: currentRoomId,
          targetUser: from,
          answer,
        })
      } else {
        // 1v1若尚未加入通話，提示使用者是否接受
        if (!isGroup && !inCall) {
          const accept = window.confirm(`${from} 邀請您加入通話，是否接受？`)
          if (!accept) {
            socket.emit('rejectCall', from)
            return
          }
          handleSelectRoom(roomId)
          await joinCall(type, roomId)
          setCallUsers([from])
        }
        // 建立連線並回應 Offer
        createPeerConnection(type, from, false, offer)
      }
    }
    socket.on('receiveOffer', handleReceiveOffer)

    // 收到對方Answer
    const handleReceiveAnswer = async ({ from, answer }) => {
      const pc = peerConnectionsRef.current[from]
      if (pc) {
        await pc.setRemoteDescription(answer)
      }
      if (!isGroup) {
        setCallUsers([from])
      }
    }
    socket.on('receiveAnswer', handleReceiveAnswer)

    // 收到對方ICE
    const handleReceiveICECandidate = async ({ from, candidate }) => {
      const pc = peerConnectionsRef.current[from]
      if (!pc) return

      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        if (!pendingCandidatesRef.current[from]) {
          pendingCandidatesRef.current[from] = []
        }
        pendingCandidatesRef.current[from].push(candidate)
      } else {
        await pc.addIceCandidate(candidate)
      }
    }
    socket.on('receiveICECandidate', handleReceiveICECandidate)

    return () => {
      socket.off('callMembers', handleCallMembers)
      socket.off('newPeer', handleNewPeer)
      socket.off('callRejected', handleCallRejected)
      socket.off('removePeer', handleRemovePeer)
      socket.off('receiveOffer', handleReceiveOffer)
      socket.off('receiveAnswer', handleReceiveAnswer)
      socket.off('receiveICECandidate', handleReceiveICECandidate)
    }
  }, [
    socket,
    currentRoomId,
    isGroup,
    callType,
    inCall,
    username,
    handleSelectRoom,
  ])

  // 動態顯示自己與他人的視訊
  return (
    <div className="bg-card border-t border-border p-4">
      {inCall ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-primary font-medium flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse"></span>
              通話中 (含自己共 {callUsers.length + 1} 人)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className={cn(
                  isMuted &&
                    'bg-destructive/10 text-destructive border-destructive/50',
                )}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </Button>
              {callType === 'video' && (
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    isVideoOff &&
                      'bg-destructive/10 text-destructive border-destructive/50',
                  )}
                  onClick={toggleVideo}
                >
                  {isVideoOff ? (
                    <Video size={16} className="line-through" />
                  ) : (
                    <Video size={16} />
                  )}
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="gap-1"
                onClick={leaveCall}
              >
                <PhoneOff size={14} />
                離開通話
              </Button>
            </div>
          </div>

          {/* Video區: 排列所有 participant (含自己) 的視訊 */}
          <ScrollArea className="h-[180px]">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(videoStreams).map(([user, stream]) => (
                <VideoPlayer
                  key={user}
                  user={user}
                  stream={stream}
                  self={user === username}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        // 未加入通話時顯示兩個按鈕：視訊通話與僅語音通話
        <div className="flex justify-end gap-2">
          <Button
            variant="default"
            className="gap-1.5"
            onClick={() => joinCall('video')}
            disabled={!currentRoomId}
          >
            <Video size={16} />
            視訊通話
          </Button>
          <Button
            variant="default"
            className="gap-1.5"
            onClick={() => joinCall('audio')}
            disabled={!currentRoomId}
          >
            <Phone size={16} />
            語音通話
          </Button>
        </div>
      )}
    </div>
  )
}

function VideoPlayer({ user, stream, self }) {
  const videoRef = React.useRef(null)

  React.useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="relative bg-black rounded-md overflow-hidden aspect-video">
      <video
        ref={videoRef}
        autoPlay
        muted={self}
        className="w-full h-full object-cover"
        onLoadedMetadata={(e) => e.currentTarget.play()}
      />
      <div className="absolute bottom-1 left-1 right-1 flex justify-between items-center">
        <span className="text-white text-xs bg-black/60 px-1.5 py-0.5 rounded-sm">
          {user}
          {self && ' (你)'}
        </span>
        {self && (
          <span className="text-white text-xs bg-primary/80 px-1.5 py-0.5 rounded-sm">
            自己
          </span>
        )}
      </div>
    </div>
  )
}
