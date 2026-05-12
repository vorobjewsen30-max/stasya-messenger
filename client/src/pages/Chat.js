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

  // Загрузка каналов и авто-выбор первого
  useEffect(() => {
    loadChannels();
  }, []);

  useEffect(() => {
    if (channels.length > 0 && !activeChannel) {
      selectChannel(channels[0]);
    }
  }, [channels]);

  // Подписка на WebSocket
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
    socket.on('verified', handleVerified);
    socket.on('channelVerified', handleChannelVerified);

    return () => {
      socket.off('newMessage'); socket.off('messageEdited'); socket.off('messageDeleted');
      socket.off('messageReaction'); socket.off('userTyping'); socket.off('userStoppedTyping');
      socket.off('incomingCall'); socket.off('callAccepted'); socket.off('callRejected');
      socket.off('callEnded'); socket.off('callSignal'); socket.off('userStatus');
      socket.off('verified'); socket.off('channelVerified');
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
    if (socket) socket.emit('joinChannel', channel._id || channel.id);
    await loadMessages(channel._id || channel.id);
  };

  const loadMessages = async (channelId) => {
    if (!channelId) return;
    try {
      const res = await api.get(`/api/messages/${channelId}?limit=50`);
      setMessages(res.data.messages);
      scrollToBottom();
    } catch (err) {
      console.error('Ошибка загрузки сообщений:', err);
    }
  };

  const handleNewMessage = (data) => {
    const msg = data.message;
    const chId = msg.channel_id || msg.channel;
    if (chId === (activeChannel?.id || activeChannel?._id)) {
      setMessages(prev => [...prev, msg]);
      scrollToBottom();
    }
    setChannels(prev => prev.map(ch => {
      if ((ch.id || ch._id) === chId) return { ...ch, lastMessage: msg };
      return ch;
    }));
  };

  const handleMessageEdited = (data) => {
    if (data.message.channel_id === (activeChannel?.id || activeChannel?._id) || data.message.channel === (activeChannel?.id || activeChannel?._id)) {
      setMessages(prev => prev.map(m => (m.id === data.message.id || m._id === data.message._id) ? data.message : m));
    }
  };

  const handleMessageDeleted = (data) => {
    if (data.channelId === (activeChannel?.id || activeChannel?._id)) {
      setMessages(prev => prev.map(m => (m.id === data.messageId || m._id === data.messageId) ? { ...m, deleted: 1, content: '[Сообщение удалено]' } : m));
    }
  };

  const handleMessageReaction = (data) => {
    if (data.channelId === (activeChannel?.id || activeChannel?._id)) {
      setMessages(prev => prev.map(m => (m.id === data.messageId || m._id === data.messageId) ? { ...m, reactions: data.reactions } : m));
    }
  };

  const handleUserTyping = (data) => {
    if (data.channelId === (activeChannel?.id || activeChannel?._id)) {
      setTypingUsers(prev => ({ ...prev, [data.userId]: data.username }));
    }
  };

  const handleUserStoppedTyping = (data) => {
    if (data.channelId === (activeChannel?.id || activeChannel?._id)) {
      setTypingUsers(prev => { const next = { ...prev }; delete next[data.userId]; return next; });
    }
  };

  const handleIncomingCall = (data) => setIncomingCall(data);
  const handleCallAccepted = (data) => { setActiveCall(data); setIncomingCall(null); };
  const handleCallRejected = () => setIncomingCall(null);
  const handleCallEnded = () => { setActiveCall(null); setIncomingCall(null); };
  const handleCallSignal = (data) => console.log('Call signal:', data);

  const handleUserStatus = (data) => {
    setChannels(prev => prev.map(ch => ({
      ...ch,
      members: ch.members?.map(m => (m.user?.id === data.userId || m.id === data.userId) ? { ...m, user: { ...m.user, status: data.status }, status: data.status } : m)
    })));
  };

  const handleVerified = (data) => {
    if (data.userId === user?.id) {
      user.verified = data.verified;
    }
  };

  const handleChannelVerified = (data) => {
    setChannels(prev => prev.map(ch => (ch.id === data.channelId || ch._id === data.channelId) ? { ...ch, verified: data.verified } : ch));
    if ((activeChannel?.id || activeChannel?._id) === data.channelId) {
      setActiveChannel(prev => ({ ...prev, verified: data.verified }));
    }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeChannel) return;
    const chId = activeChannel.id || activeChannel._id;
    if (!chId) return;

    const content = messageInput;
    setMessageInput('');

    try {
      await api.post(`/api/messages/${chId}`, { content });
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
    const chId = activeChannel.id || activeChannel._id;
    socket.emit('typingStart', chId);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit('typingStop', chId), 2000);
  };

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const createChannel = async (e) => {
    e.preventDefault();
    const name = e.target.name.value;
    const type = e.target.type.value;
    const description = e.target.description.value;
    try {
      const res = await api.post('/api/channels', { name, type, description, isPublic: true });
      setChannels(prev => [...prev, res.data.channel]);
      setShowCreateModal(false);
      selectChannel(res.data.channel);
    } catch (err) {
      console.error('Ошибка создания:', err);
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
    if (query.length < 2) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/api/users/search?q=${query}`);
      setSearchResults(res.data.users);
    } catch (err) { console.error('Ошибка поиска:', err); }
  };

  const startDM = async (userId) => {
    try {
      const res = await api.post(`/api/channels/dm/${userId}`);
      const existing = channels.find(c => (c.id || c._id) === (res.data.channel.id || res.data.channel._id));
      if (!existing) setChannels(prev => [...prev, res.data.channel]);
      selectChannel(res.data.channel);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) { console.error('Ошибка DM:', err); }
  };

  const verifyUser = async (userId) => {
    try {
      await api.post(`/api/auth/verify/user/${userId}`);
      alert('Пользователь верифицирован! ✅');
    } catch (err) { alert(err.response?.data?.error || 'Ошибка'); }
  };

  const unverifyUser = async (userId) => {
    try {
      await api.delete(`/api/auth/verify/user/${userId}`);
      alert('Верификация снята');
    } catch (err) { alert(err.response?.data?.error || 'Ошибка'); }
  };

  const verifyChannel = async (channelId) => {
    try {
      await api.post(`/api/auth/verify/channel/${channelId}`);
      alert('Канал верифицирован! ✅');
    } catch (err) { alert(err.response?.data?.error || 'Ошибка'); }
  };

  const acceptCall = () => {
    if (socket && incomingCall) {
      socket.emit('callAccepted', { targetUserId: incomingCall.from.id, callType: incomingCall.callType });
      setActiveCall({ ...incomingCall, socketId: incomingCall.socketId });
      setIncomingCall(null);
    }
  };

  const rejectCall = () => {
    if (socket && incomingCall) {
      socket.emit('callRejected', { targetUserId: incomingCall.from.id });
      setIncomingCall(null);
    }
  };

  const changeStatus = (status) => {
    if (socket) socket.emit('setStatus', status);
    setShowStatusMenu(false);
  };

  const formatTime = (date) => {
    const d = new Date(date + (date.includes('Z') ? '' : 'Z'));
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const getChannelId = (ch) => ch?.id || ch?._id;
  const getUserId = (u) => u?.id || u?._id;
  const getMsgId = (m) => m?.id || m?._id;

  const typingNames = Object.values(typingUsers);
  const typingText = typingNames.length > 0 ? `${typingNames.join(', ')} печатает...` : '';

  const activeChId = getChannelId(activeChannel);

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>💬 Stasya</h2>
          <div className="user-status-badge" onClick={() => setShowStatusMenu(!showStatusMenu)}>
            <span className={`status-dot ${user?.status || 'offline'}`}></span>
            <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {user?.username}
              {user?.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }}>✓</span> : null}
              {user?.is_ceo ? <span style={{ color: '#f39c12', fontSize: '10px', fontWeight: 700 }}>CEO</span> : null}
            </span>
            {showStatusMenu && (
              <div className="status-menu">
                <div className="status-menu-item" onClick={() => changeStatus('online')}><span className="status-dot online"></span> В сети</div>
                <div className="status-menu-item" onClick={() => changeStatus('idle')}><span className="status-dot idle"></span> Не активен</div>
                <div className="status-menu-item" onClick={() => changeStatus('dnd')}><span className="status-dot dnd"></span> Не беспокоить</div>
                <div className="status-menu-item" onClick={() => changeStatus('offline')}><span className="status-dot offline"></span> Невидимка</div>
                <div className="status-menu-item" onClick={logout} style={{ borderTop: '1px solid var(--border)', color: 'var(--danger)' }}>🚪 Выйти</div>
              </div>
            )}
          </div>
        </div>

        <div className="search-bar">
          <input type="text" placeholder="🔍 Поиск пользователей..." value={searchQuery} onChange={e => searchUsers(e.target.value)} />
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: '4px', width: '248px', maxHeight: '300px', overflowY: 'auto', zIndex: 50 }}>
              {searchResults.map(u => (
                <div key={getUserId(u)} style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  onClick={() => startDM(getUserId(u))}
                  onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}>
                  <div className="message-avatar" style={{ width: '32px', height: '32px', fontSize: '14px' }}>
                    {u.avatar ? <img src={u.avatar} alt="" /> : (u.display_name?.[0] || u.username?.[0] || '?').toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {u.display_name || u.username}
                      {u.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }}>✓</span> : null}
                      {u.is_ceo ? <span style={{ color: '#f39c12', fontSize: '10px', fontWeight: 700 }}>CEO</span> : null}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{u.username}</div>
                  </div>
                  {user?.is_ceo && !u.is_ceo && (
                    <button style={{ fontSize: '10px', padding: '2px 6px', background: u.verified ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); u.verified ? unverifyUser(getUserId(u)) : verifyUser(getUserId(u)); }}>
                      {u.verified ? '✕' : '✓'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '8px 16px', display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '8px' }} onClick={() => setShowCreateModal(true)}>+ Канал</button>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '8px' }} onClick={() => setShowInviteModal(true)}>🔗 Войти</button>
        </div>

        <div className="channel-list">
          {channels.map(channel => (
            <div key={getChannelId(channel)} className={`channel-item ${activeChId === getChannelId(channel) ? 'active' : ''}`} onClick={() => selectChannel(channel)}>
              <div className="channel-icon">
                {channel.type === 'dm' ? '👤' : channel.type === 'voice' ? '🔊' : '💬'}
              </div>
              <div className="channel-info">
                <div className="channel-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {channel.type === 'dm'
                    ? channel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user?.display_name || channel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.display_name || 'DM'
                    : `# ${channel.name}`}
                  {channel.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }}>✓</span> : null}
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
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {activeChannel.type === 'dm'
                    ? activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user?.display_name || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.display_name || 'DM'
                    : `# ${activeChannel.name}`}
                  {activeChannel.verified ? <span style={{ color: '#6C5CE7', fontSize: '14px' }} title="Верифицирован">✓</span> : null}
                  {user?.is_ceo && activeChannel.type !== 'dm' && (
                    <button style={{ fontSize: '10px', padding: '2px 6px', background: activeChannel.verified ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      onClick={() => activeChannel.verified ? 
                        api.delete(`/api/auth/verify/channel/${activeChId}`).then(() => setActiveChannel(prev => ({ ...prev, verified: 0 }))) :
                        api.post(`/api/auth/verify/channel/${activeChId}`).then(() => setActiveChannel(prev => ({ ...prev, verified: 1 })))
                      }>
                      {activeChannel.verified ? 'Снять ✓' : '✓ Вериф.'}
                    </button>
                  )}
                </h3>
                <p>
                  {activeChannel.type === 'dm'
                    ? `@${activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user?.username || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.username || ''}`
                    : `${activeChannel.members?.length || 0} участников`}
                </p>
              </div>
              <div className="chat-header-actions">
                {activeChannel.type === 'dm' && (
                  <>
                    <button className="icon-btn" title="Звонок" onClick={() => {
                      const targetId = getUserId(activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user)));
                      if (targetId) socket?.emit('callUser', { targetUserId: targetId, callType: 'voice' });
                    }}>📞</button>
                  </>
                )}
              </div>
            </div>

            <div className="messages-container">
              {messages.map(msg => {
                const author = msg.author || {};
                const authorId = getUserId(author);
                return (
                <div key={getMsgId(msg)} className="message">
                  <div className="message-avatar">
                    {author.avatar ? <img src={author.avatar} alt="" /> : (author.display_name?.[0] || author.username?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="message-content">
                    <div className="message-header">
                      <span className={`message-author ${author.is_bot ? 'bot' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {author.display_name || author.username || 'Неизвестный'}
                        {author.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }} title="Верифицирован">✓</span> : null}
                        {author.is_ceo ? <span style={{ color: '#f39c12', fontSize: '10px', fontWeight: 700, background: 'rgba(243,156,18,0.15)', padding: '1px 4px', borderRadius: '3px' }}>CEO</span> : null}
                      </span>
                      {author.is_bot ? <span className="bot-badge">BOT</span> : null}
                      <span className="message-time">{formatTime(msg.created_at || msg.createdAt)}</span>
                      {msg.edited ? <span className="message-edited">(изменено)</span> : null}
                      {/* CEO может верифицировать пользователя через сообщение */}
                      {user?.is_ceo && !author.is_ceo && !author.is_bot && (
                        <button style={{ fontSize: '9px', padding: '1px 4px', background: author.verified ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '4px' }}
                          onClick={() => author.verified ? unverifyUser(authorId) : verifyUser(authorId)}>
                          {author.verified ? '✕' : '✓'}
                        </button>
                      )}
                    </div>
                    <div className={`message-text ${msg.deleted ? 'deleted' : ''}`}>{msg.content}</div>
                    {msg.embed && (
                      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', marginTop: '8px', borderLeft: `4px solid ${msg.embed.color || 'var(--accent)'}` }}>
                        {msg.embed.title && <div style={{ fontWeight: 600, marginBottom: '4px' }}>{msg.embed.title}</div>}
                        {msg.embed.description && <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{msg.embed.description}</div>}
                      </div>
                    )}
                    {msg.reactions?.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                        {msg.reactions.map(r => (
                          <span key={r.emoji} style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '10px', fontSize: '12px', cursor: 'pointer' }}>
                            {r.emoji} {r.users?.length || 0}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )})}
              <div ref={messagesEndRef} />
            </div>

            {typingText && <div className="typing-indicator">{typingText}</div>}

            <div className="message-input-container">
              <div className="message-input-wrapper">
                <textarea ref={inputRef} value={messageInput}
                  onChange={e => { setMessageInput(e.target.value); handleTyping(); }}
                  onKeyDown={handleKeyDown}
                  placeholder={`Написать в ${activeChannel.type === 'dm' ? 'личные сообщения' : '#' + activeChannel.name}...`}
                  rows={1} />
                <button className="send-btn" onClick={sendMessage} disabled={!messageInput.trim()}>➤</button>
              </div>
            </div>
          </>
        ) : (
          <div className="welcome-screen">
            <div className="icon">💬</div>
            <h2>Stasya Messenger</h2>
            <p>Выберите канал или начните диалог. Используйте поиск чтобы найти пользователей.</p>
          </div>
        )}
      </div>

      {/* Incoming Call */}
      {incomingCall && (
        <div className="call-notification">
          <h4>📞 Входящий {incomingCall.callType === 'video' ? 'видео' : 'голосовой'} звонок</h4>
          <p>От: {incomingCall.from.display_name || incomingCall.from.username}</p>
          <div className="call-notification-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptCall}>Принять</button>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={rejectCall}>Отклонить</button>
          </div>
        </div>
      )}

      {activeCall && (
        <div className="call-notification" style={{ borderColor: 'var(--success)' }}>
          <h4>🔊 Звонок активен</h4>
          <button className="btn btn-danger" style={{ marginTop: '8px' }}
            onClick={() => { socket?.emit('callEnded', { targetUserId: activeCall.from?.id }); setActiveCall(null); }}>Завершить</button>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Создать канал</h3>
            <form onSubmit={createChannel}>
              <div className="form-group"><label>Название</label><input name="name" placeholder="Название канала" required autoFocus /></div>
              <div className="form-group"><label>Тип</label>
                <select name="type" style={{ width: '100%', padding: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '15px' }}>
                  <option value="text">💬 Текстовый</option>
                  <option value="voice">🔊 Голосовой</option>
                  <option value="group">👥 Группа</option>
                </select>
              </div>
              <div className="form-group"><label>Описание</label><input name="description" placeholder="Описание канала" /></div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Отмена</button>
                <button type="submit" className="btn btn-primary">Создать</button>
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
            <div className="form-group"><label>Код приглашения</label><input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Введите код..." autoFocus /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowInviteModal(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={joinByInvite}>Присоединиться</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
