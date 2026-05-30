import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { SocketContext, AuthContext } from '../App';

// Конфигурация STUN/TURN серверов
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

function CallInterface({ callData, onEnd }) {
  const { user } = useContext(AuthContext);
  const socket = useContext(SocketContext);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(callData.callType !== 'video');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [status, setStatus] = useState('connecting'); // connecting | active | ended

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const timerRef = useRef(null);

  const isInitiator = callData.from?.id !== user?.id;
  const remoteUser = isInitiator ? callData.from : callData.targetUser;

  // Инициализация
  useEffect(() => {
    startCall();
    return () => cleanup();
  }, []);

  // Таймер
  useEffect(() => {
    if (status === 'active') {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  const startCall = async () => {
    try {
      // Получаем локальный поток
      const constraints = {
        audio: true,
        video: callData.callType === 'video'
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Создаём peer connection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionRef.current = pc;

      // Добавляем треки
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Обработка ICE кандидатов
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('callSignal', {
            targetUserId: remoteUser?.id,
            signal: { type: 'ice-candidate', candidate: event.candidate },
            callId: callData.callId
          });
        }
      };

      // Получаем удалённый поток
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Статус соединения
      pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          setStatus('active');
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          endCall();
        }
      };

      // Если инициатор — создаём offer
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('callSignal', {
          targetUserId: remoteUser?.id,
          signal: { type: 'offer', sdp: pc.localDescription },
          callId: callData.callId
        });
      }

    } catch (err) {
      console.error('Ошибка запуска звонка:', err);
      // Если нет видео — пробуем только аудио
      if (callData.callType === 'video') {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          localStreamRef.current = audioStream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = audioStream;
          }
          setIsVideoOff(true);

          const pc = new RTCPeerConnection(ICE_SERVERS);
          peerConnectionRef.current = pc;
          audioStream.getTracks().forEach(track => pc.addTrack(track, audioStream));

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit('callSignal', {
                targetUserId: remoteUser?.id,
                signal: { type: 'ice-candidate', candidate: event.candidate },
                callId: callData.callId
              });
            }
          };

          pc.ontrack = (event) => {
            if (remoteVideoRef.current && event.streams[0]) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
          };

          pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') setStatus('active');
            else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') endCall();
          };

          if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('callSignal', {
              targetUserId: remoteUser?.id,
              signal: { type: 'offer', sdp: pc.localDescription },
              callId: callData.callId
            });
          }
        } catch (audioErr) {
          console.error('Даже аудио не работает:', audioErr);
          endCall();
        }
      } else {
        endCall();
      }
    }
  };

  // Обработка сигналов
  useEffect(() => {
    if (!socket) return;

    const handleSignal = async (data) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        if (data.signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('callSignal', {
            targetUserId: data.fromUserId,
            signal: { type: 'answer', sdp: pc.localDescription },
            callId: callData.callId
          });
        } else if (data.signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
        } else if (data.signal.type === 'ice-candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
      } catch (err) {
        console.error('Ошибка обработки сигнала:', err);
      }
    };

    socket.on('callSignal', handleSignal);
    return () => socket.off('callSignal', handleSignal);
  }, [socket, callData.callId]);

  // Mute / Unmute
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Video toggle
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Screen share
  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        // Остановить шаринг
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(t => t.stop());
        }
        // Вернуть видео
        if (localStreamRef.current) {
          const videoTrack = localStreamRef.current.getVideoTracks()[0];
          if (videoTrack) {
            const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
          }
        }
        setIsScreenSharing(false);
      } else {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;

        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          peerConnectionRef.current?.addTrack(screenTrack, screenStream);
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        screenTrack.onended = () => {
          toggleScreenShare();
        };

        setIsScreenSharing(true);
      }
    } catch (err) {
      console.error('Ошибка шаринга экрана:', err);
    }
  };

  const endCall = () => {
    setStatus('ended');
    cleanup();
    if (socket) {
      socket.emit('callEnded', { targetUserId: remoteUser?.id });
    }
    setTimeout(() => onEnd?.(), 300);
  };

  const cleanup = () => {
    clearInterval(timerRef.current);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="call-fullscreen">
      <div className="call-fullscreen-header">
        <h3>{remoteUser?.display_name || remoteUser?.username || 'Неизвестный'}</h3>
        <p>{status === 'connecting' ? 'Соединение...' : status === 'active' ? 'В звонке' : 'Завершён'}</p>
        {status === 'active' && (
          <div className="call-timer">{formatDuration(callDuration)}</div>
        )}
      </div>

      <div className="call-video-container">
        {/* Локальное видео */}
        <div className={`call-video-box local ${isVideoOff ? 'audio-only' : ''}`}>
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="call-video-label">
            {user?.display_name || user?.username} (Вы)
            {isScreenSharing ? ' 📺' : ''}
          </div>
        </div>

        {/* Удалённое видео */}
        <div className="call-video-box">
          <video ref={remoteVideoRef} autoPlay playsInline />
          <div className="call-video-label">
            {remoteUser?.display_name || remoteUser?.username || '...'}
          </div>
        </div>
      </div>

      <div className="call-controls">
        <button
          className={`call-control-btn mute ${isMuted ? 'active' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>

        {callData.callType === 'video' && (
          <button
            className={`call-control-btn video-toggle ${isVideoOff ? 'active' : ''}`}
            onClick={toggleVideo}
            title={isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
          >
            {isVideoOff ? '📷' : '📸'}
          </button>
        )}

        <button
          className={`call-control-btn screen-share ${isScreenSharing ? 'active' : ''}`}
          onClick={toggleScreenShare}
          title={isScreenSharing ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
        >
          {isScreenSharing ? '🖥️' : '💻'}
        </button>

        <button
          className="call-control-btn end-call"
          onClick={endCall}
          title="Завершить звонок"
        >
          📞
        </button>
      </div>
    </div>
  );
}

export default CallInterface;
