'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Phone, PhoneOff, Video, Mic, MicOff } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

export default function CallSection({ socket, username, currentRoomId }) {
  const [inCall, setInCall] = useState(false) // 是否已加入通話
  const [callUsers, setCallUsers] = useState([]) // 目前通話中的成員 (不含自己)
  const [videoStreams, setVideoStreams] = useState({}) // { [user]: MediaStream }
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const localStreamRef = useRef(null) // 自己的音/視訊
  const peerConnectionsRef = useRef({}) // { [user]: RTCPeerConnection }
  const pendingCandidatesRef = useRef({}) // { [remoteUser]: candidate[] }

  // 加入通話
  const joinCall = async () => {
    if (!socket || !currentRoomId) return
    // 先取得自己音視頻
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
    } catch (err) {
      console.error('取得媒體失敗:', err)
      return
    }
    // 送請求到 server: joinCall
    socket.emit('joinCall', currentRoomId)
    setInCall(true)
    // 讓自己顯示本地視訊
    setVideoStreams((prev) => ({ ...prev, [username]: localStreamRef.current }))
  }

  // 離開通話
  const leaveCall = () => {
    if (!socket || !currentRoomId) return
    socket.emit('leaveCall', currentRoomId)
    // 關閉所有 Peer
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close())
    peerConnectionsRef.current = {}
    // 關閉自己攝影機
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
      const audioTracks = localStreamRef.current.getAudioTracks()
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  // 切換視訊
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks()
      videoTracks.forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsVideoOff(!isVideoOff)
    }
  }

  // 當 server 回傳 callMembers (已在通話中其他成員)
  useEffect(() => {
    if (!socket) return
    const handleCallMembers = (members) => {
      // 逐一跟這些成員做 p2p 連線，根據使用者名稱大小來決定誰發起連線
      // createOffer -> sendOffer
      members.forEach((m) => {
        const isInitiator = username < m // 若自己的 username 字串較小，則發起連線
        createPeerConnection(m, isInitiator)
      })
      setCallUsers(members)
    }
    socket.on('callMembers', handleCallMembers)

    const handleNewPeer = ({ username: newUser }) => {
      // 有人新加入，跟他做 p2p
      setCallUsers((prev) => {
        if (prev.includes(newUser)) return prev
        return [...prev, newUser]
      })
      // 根據使用者名稱大小來決定誰發起連線
      const isInitiator = username < newUser
      createPeerConnection(newUser, isInitiator)
    }
    socket.on('newPeer', handleNewPeer)

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

    // 收到對方 Offer
    const handleReceiveOffer = async ({ from, offer }) => {
      // 建立 peerConnection, setRemoteDescription(offer), createAnswer -> sendAnswer，如果已存在 peerConnection，則直接設定 remoteDescription 並回應 answer
      let pc = peerConnectionsRef.current[from]
      if (pc) {
        await pc.setRemoteDescription(offer)
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
        createPeerConnection(from, false, offer)
      }
    }

    // 收到對方Answer
    const handleReceiveAnswer = async ({ from, answer }) => {
      const pc = peerConnectionsRef.current[from]
      if (pc) {
        await pc.setRemoteDescription(answer)
      }
    }

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

    socket.on('removePeer', handleRemovePeer)
    socket.on('receiveOffer', handleReceiveOffer)
    socket.on('receiveAnswer', handleReceiveAnswer)
    socket.on('receiveICECandidate', handleReceiveICECandidate)

    return () => {
      socket.off('callMembers', handleCallMembers)
      socket.off('newPeer', handleNewPeer)
      socket.off('removePeer', handleRemovePeer)
      socket.off('receiveOffer', handleReceiveOffer)
      socket.off('receiveAnswer', handleReceiveAnswer)
      socket.off('receiveICECandidate', handleReceiveICECandidate)
    }
  }, [socket])

  // 建立或回應 PeerConnection
  async function createPeerConnection(
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
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // { urls: "turn:xxx", username: "xxx", credential: "xxx" }
      ],
    })
    peerConnectionsRef.current[remoteUser] = pc

    // 加入本地音視頻 track
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    // 當有遠端串流 track
    pc.ontrack = (event) => {
      // event.streams[0] 是對方的音/視訊
      setVideoStreams((prev) => ({
        ...prev,
        [remoteUser]: event.streams[0],
      }))
    }

    // ICE candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('sendICECandidate', {
          roomId: currentRoomId,
          targetUser: remoteUser,
          candidate: event.candidate,
        })
      }
    }

    // 對方已先給Offer
    if (remoteOffer) {
      await pc.setRemoteDescription(remoteOffer)
      // 通常 setRemoteDescription 後再處理所有累積的 Candidate
      if (pendingCandidatesRef.current[remoteUser]) {
        for (let candidate of pendingCandidatesRef.current[remoteUser]) {
          await pc.addIceCandidate(candidate)
        }
        delete pendingCandidatesRef.current[remoteUser]
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      // 發送 answer
      socket.emit('sendAnswer', {
        roomId: currentRoomId,
        targetUser: remoteUser,
        answer,
      })
    } else if (isInitiator) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('sendOffer', {
        roomId: currentRoomId,
        targetUser: remoteUser,
        offer,
      })
    }
  }

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
        <div className="flex justify-end">
          <Button
            variant="default"
            className="gap-1.5"
            onClick={joinCall}
            disabled={!currentRoomId}
          >
            <Phone size={16} />
            加入通話
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
