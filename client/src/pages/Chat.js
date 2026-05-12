import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { AuthContext, SocketContext } from '../App';
import api from '../services/api';

function Chat() {
  const { user, logout } = useContext(AuthContext);
  const socket = useContext(SocketContext);

  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Загрузка каналов
  useEffect(() => {
    loadChannels();
  }, []);

  // Подписка на WebSocket события
  useEffect(() => {
    if (!socket) return;

    socket.on('newMessage', handleNewMessage);
    socket.on('messageEdited', handleMessageEdited);
    socket.on('messageDeleted', handleMessageDeleted);
    socket.on('messageReaction', handleMessageReaction);
    socket.on('userTyping', handleUserTyping);
    socket.on('userStoppedTyping', handleUserStoppedTyping);
    socket.on('incomingCall', handleIncomingCall);
    socket.on('callAccepted', handleCallAccepted);
    socket.on('callRejected', handleCallRejected);
    socket.on('callEnded', handleCallEnded);
    socket.on('callSignal', handleCallSignal);
    socket.on('userStatus', handleUserStatus);

    return () => {
      socket.off('newMessage');
      socket.off('messageEdited');
      socket.off('messageDeleted');
      socket.off('messageReaction');
      socket.off('userTyping');
      socket.off('userStoppedTyping');
      socket.off('incomingCall');
      socket.off('callAccepted');
      socket.off('callRejected');
      socket.off('callEnded');
      socket.off('callSignal');
      socket.off('userStatus');
    };
  }, [socket, activeChannel]);

  const loadChannels = async () => {
    try {
      const res = await api.get('/api/channels');
      setChannels(res.data.channels);
    } catch (err) {
      console.error('Ошибка загрузки каналов:', err);
    }
  };

  const selectChannel = async (channel) => {
    setActiveChannel(channel);
    if (socket) {
      socket.emit('joinChannel', channel._id);
    }
    await loadMessages(channel._id);
  };

  const loadMessages = async (channelId) => {
    try {
      const res = await api.get(`/api/messages/${channelId}?limit=50`);
      setMessages(res.data.messages);
      scrollToBottom();
    } catch (err) {
      console.error('Ошибка загрузки сообщений:', err);
    }
  };

  const handleNewMessage = (data) => {
    if (data.message.channel === activeChannel?._id) {
      setMessages(prev => [...prev, data.message]);
      scrollToBottom();
    }
    // Обновляем превью канала
    setChannels(prev => prev.map(ch => {
      if (ch._id === data.message.channel) {
        return { ...ch, lastMessage: data.message };
      }
      return ch;
    }));
  };

  const handleMessageEdited = (data) => {
    if (data.message.channel === activeChannel?._id) {
      setMessages(prev => prev.map(m => 
        m._id === data.message._id ? data.message : m
      ));
    }
  };

  const handleMessageDeleted = (data) => {
    if (data.channelId === activeChannel?._id) {
      setMessages(prev => prev.map(m => 
        m._id === data.messageId ? { ...m, deleted: true, content: '[Сообщение удалено]' } : m
      ));
    }
  };

  const handleMessageReaction = (data) => {
    if (data.channelId === activeChannel?._id) {
      setMessages(prev => prev.map(m => 
        m._id === data.messageId ? { ...m, reactions: data.reactions } : m
      ));
    }
  };

  const handleUserTyping = (data) => {
    if (data.channelId === activeChannel?._id) {
      setTypingUsers(prev => ({ ...prev, [data.userId]: data.username }));
    }
  };

  const handleUserStoppedTyping = (data) => {
    if (data.channelId === activeChannel?._id) {
      setTypingUsers(prev => {
        const next = { ...prev };
        delete next[data.userId];
        return next;
      });
    }
  };

  const handleIncomingCall = (data) => {
    setIncomingCall(data);
  };

  const handleCallAccepted = (data) => {
    setActiveCall(data);
    setIncomingCall(null);
  };

  const handleCallRejected = () => {
    setIncomingCall(null);
  };

  const handleCallEnded = () => {
    setActiveCall(null);
    setIncomingCall(null);
  };

  const handleCallSignal = (data) => {
    // WebRTC signaling handled here
    console.log('Call signal:', data);
  };

  const handleUserStatus = (data) => {
    setChannels(prev => prev.map(ch => ({
      ...ch,
      members: ch.members?.map(m => 
        m.user?._id === data.userId 
          ? { ...m, user: { ...m.user, status: data.status } }
          : m
      )
    })));
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeChannel) return;

    const content = messageInput;
    setMessageInput('');

    try {
      await api.post(`/api/messages/${activeChannel._id}`, { content });
    } catch (err) {
      console.error('Ошибка отправки:', err);
      setMessageInput(content);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTyping = () => {
    if (!socket || !activeChannel) return;

    socket.emit('typingStart', activeChannel._id);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typingStop', activeChannel._id);
    }, 2000);
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const createChannel = async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value;
    const type = form.type.value;
    const description = form.description.value;

    try {
      const res = await api.post('/api/channels', { name, type, description, isPublic: true });
      setChannels(prev => [...prev, res.data.channel]);
      setShowCreateModal(false);
      selectChannel(res.data.channel);
    } catch (err) {
      console.error('Ошибка создания канала:', err);
    }
  };

  const joinByInvite = async () => {
    try {
      const res = await api.post(`/api/channels/join/${inviteCode}`);
      setChannels(prev => [...prev, res.data.channel]);
      setShowInviteModal(false);
      setInviteCode('');
      selectChannel(res.data.channel);
    } catch (err) {
      alert(err.response?.data?.error || 'Неверный код');
    }
  };

  const searchUsers = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.get(`/api/users/search?q=${query}`);
      setSearchResults(res.data.users);
    } catch (err) {
      console.error('Ошибка поиска:', err);
    }
  };

  const startDM = async (userId) => {
    try {
      const res = await api.post(`/api/channels/dm/${userId}`);
      const existingChannel = channels.find(c => c._id === res.data.channel._id);
      if (!existingChannel) {
        setChannels(prev => [...prev, res.data.channel]);
      }
      selectChannel(res.data.channel);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      console.error('Ошибка создания DM:', err);
    }
  };

  const acceptCall = () => {
    if (socket && incomingCall) {
      socket.emit('callAccepted', {
        targetUserId: incomingCall.from._id,
        callType: incomingCall.callType
      });
      setActiveCall({
        ...incomingCall,
        socketId: incomingCall.socketId
      });
      setIncomingCall(null);
    }
  };

  const rejectCall = () => {
    if (socket && incomingCall) {
      socket.emit('callRejected', {
        targetUserId: incomingCall.from._id
      });
      setIncomingCall(null);
    }
  };

  const changeStatus = async (status) => {
    if (socket) {
      socket.emit('setStatus', status);
    }
    setShowStatusMenu(false);
  };

  const formatTime = (date) => {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    
    if (isToday) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + 
           ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const typingNames = Object.values(typingUsers);
  const typingText = typingNames.length > 0 
    ? `${typingNames.join(', ')} печатает...` 
    : '';

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>💬 Stasya</h2>
          <div className="user-status-badge" onClick={() => setShowStatusMenu(!showStatusMenu)}>
            <span className={`status-dot ${user?.status || 'offline'}`}></span>
            <span style={{ fontSize: '13px' }}>{user?.username}</span>
            {showStatusMenu && (
              <div className="status-menu">
                <div className="status-menu-item" onClick={() => changeStatus('online')}>
                  <span className="status-dot online"></span> В сети
                </div>
                <div className="status-menu-item" onClick={() => changeStatus('idle')}>
                  <span className="status-dot idle"></span> Не активен
                </div>
                <div className="status-menu-item" onClick={() => changeStatus('dnd')}>
                  <span className="status-dot dnd"></span> Не беспокоить
                </div>
                <div className="status-menu-item" onClick={() => changeStatus('offline')}>
                  <span className="status-dot offline"></span> Невидимка
                </div>
                <div className="status-menu-item" onClick={logout} style={{ borderTop: '1px solid var(--border)', color: 'var(--danger)' }}>
                  🚪 Выйти
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="search-bar">
          <input
            type="text"
            placeholder="🔍 Поиск пользователей..."
            value={searchQuery}
            onChange={e => searchUsers(e.target.value)}
          />
          {searchResults.length > 0 && (
            <div style={{ 
              position: 'absolute', 
              background: 'var(--bg-tertiary)', 
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              marginTop: '4px',
              width: '248px',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 50
            }}>
              {searchResults.map(u => (
                <div
                  key={u._id}
                  style={{
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)'
                  }}
                  onClick={() => startDM(u._id)}
                  onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >
                  <div className="message-avatar" style={{ width: '32px', height: '32px', fontSize: '14px' }}>
                    {u.avatar ? <img src={u.avatar} alt="" /> : u.displayName?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>{u.displayName || u.username}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{u.username}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '8px 16px', display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '8px' }}
            onClick={() => setShowCreateModal(true)}>
            + Канал
          </button>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '8px' }}
            onClick={() => setShowInviteModal(true)}>
            🔗 Войти
          </button>
        </div>

        <div className="channel-list">
          {channels.map(channel => (
            <div
              key={channel._id}
              className={`channel-item ${activeChannel?._id === channel._id ? 'active' : ''}`}
              onClick={() => selectChannel(channel)}
            >
              <div className="channel-icon">
                {channel.type === 'dm' ? '👤' : channel.type === 'voice' ? '🔊' : '💬'}
              </div>
              <div className="channel-info">
                <div className="channel-name">
                  {channel.type === 'dm' 
                    ? channel.members?.find(m => m.user?._id !== user?._id)?.user?.displayName || 
                      channel.members?.find(m => m.user?._id !== user?._id)?.user?.username || 'DM'
                    : channel.name}
                </div>
                <div className="channel-preview">
                  {channel.lastMessage?.content?.substring(0, 40) || 'Нет сообщений'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat */}
      <div className="chat-main">
        {activeChannel ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                <h3>
                  {activeChannel.type === 'dm'
                    ? activeChannel.members?.find(m => m.user?._id !== user?._id)?.user?.displayName || 'DM'
                    : `# ${activeChannel.name}`}
                </h3>
                <p>
                  {activeChannel.type === 'dm'
                    ? `@${activeChannel.members?.find(m => m.user?._id !== user?._id)?.user?.username || ''}`
                    : `${activeChannel.members?.length || 0} участников`}
                </p>
              </div>
              <div className="chat-header-actions">
                {activeChannel.type !== 'dm' && (
                  <>
                    <button className="icon-btn" title="Голосовой звонок"
                      onClick={() => socket?.emit('callUser', { 
                        targetUserId: activeChannel.members?.find(m => m.user?._id !== user?._id)?.user?._id,
                        callType: 'voice'
                      })}>
                      📞
                    </button>
                    <button className="icon-btn" title="Видеозвонок"
                      onClick={() => socket?.emit('callUser', { 
                        targetUserId: activeChannel.members?.find(m => m.user?._id !== user?._id)?.user?._id,
                        callType: 'video'
                      })}>
                      📹
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="messages-container">
              {messages.map(msg => (
                <div key={msg._id} className="message">
                  <div className="message-avatar">
                    {msg.author?.avatar 
                      ? <img src={msg.author.avatar} alt="" />
                      : (msg.author?.displayName?.[0] || msg.author?.username?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="message-content">
                    <div className="message-header">
                      <span className={`message-author ${msg.author?.isBot ? 'bot' : ''}`}>
                        {msg.author?.displayName || msg.author?.username || 'Неизвестный'}
                      </span>
                      {msg.author?.isBot && <span className="bot-badge">BOT</span>}
                      <span className="message-time">{formatTime(msg.createdAt)}</span>
                      {msg.edited && <span className="message-edited">(изменено)</span>}
                    </div>
                    <div className={`message-text ${msg.deleted ? 'deleted' : ''}`}>
                      {msg.content}
                    </div>
                    {msg.embed && (
                      <div style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '12px',
                        marginTop: '8px',
                        borderLeft: `4px solid ${msg.embed.color || 'var(--accent)'}`
                      }}>
                        {msg.embed.title && <div style={{ fontWeight: 600, marginBottom: '4px' }}>{msg.embed.title}</div>}
                        {msg.embed.description && <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{msg.embed.description}</div>}
                      </div>
                    )}
                    {msg.reactions?.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                        {msg.reactions.map(r => (
                          <span key={r.emoji} style={{
                            background: 'var(--bg-tertiary)',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}>
                            {r.emoji} {r.users?.length}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {typingText && <div className="typing-indicator">{typingText}</div>}

            <div className="message-input-container">
              <div className="message-input-wrapper">
                <textarea
                  ref={inputRef}
                  value={messageInput}
                  onChange={e => {
                    setMessageInput(e.target.value);
                    handleTyping();
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={`Написать сообщение...`}
                  rows={1}
                />
                <button className="send-btn" onClick={sendMessage} disabled={!messageInput.trim()}>
                  ➤
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="welcome-screen">
            <div className="icon">💬</div>
            <h2>Stasya Messenger</h2>
            <p>Выберите канал или начните диалог. Используйте поиск чтобы найти пользователей.</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Поддерживаются: чаты, голосовые/видео звонки, API для ботов, реакции, эмбеды
            </p>
          </div>
        )}
      </div>

      {/* Incoming Call */}
      {incomingCall && (
        <div className="call-notification">
          <h4>📞 Входящий {incomingCall.callType === 'video' ? 'видео' : 'голосовой'} звонок</h4>
          <p>От: {incomingCall.from.displayName || incomingCall.from.username}</p>
          <div className="call-notification-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptCall}>
              Принять
            </button>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={rejectCall}>
              Отклонить
            </button>
          </div>
        </div>
      )}

      {/* Active Call */}
      {activeCall && (
        <div className="call-notification" style={{ borderColor: 'var(--success)' }}>
          <h4>🔊 Звонок активен</h4>
          <p>С: {activeCall.from?.displayName || activeCall.from?.username}</p>
          <button className="btn btn-danger" style={{ marginTop: '8px' }}
            onClick={() => {
              socket?.emit('callEnded', { targetUserId: activeCall.from?._id });
              setActiveCall(null);
            }}>
            Завершить
          </button>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Создать канал</h3>
            <form onSubmit={createChannel}>
              <div className="form-group">
                <label>Название</label>
                <input name="name" placeholder="Название канала" required autoFocus />
              </div>
              <div className="form-group">
                <label>Тип</label>
                <select name="type" style={{
                  width: '100%', padding: '12px', background: 'var(--bg-primary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  color: 'var(--text-primary)', fontSize: '15px'
                }}>
                  <option value="text">💬 Текстовый</option>
                  <option value="voice">🔊 Голосовой</option>
                  <option value="group">👥 Группа</option>
                </select>
              </div>
              <div className="form-group">
                <label>Описание</label>
                <input name="description" placeholder="Описание канала" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Присоединиться по коду</h3>
            <div className="form-group">
              <label>Код приглашения</label>
              <input
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder="Введите код..."
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowInviteModal(false)}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={joinByInvite}>
                Присоединиться
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
