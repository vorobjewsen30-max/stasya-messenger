import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext, SocketContext } from '../App';
import CallInterface from '../components/CallInterface';
import api from '../services/api';

function Chat() {
  const { user, logout } = useContext(AuthContext);
  const socket = useContext(SocketContext);
  const navigate = useNavigate();

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
  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // РћРїСЂРµРґРµР»РµРЅРёРµ РјРѕР±РёР»СЊРЅРѕРіРѕ
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // РЎР»СѓС€Р°РµРј СЃРѕР±С‹С‚РёСЏ РІС‹Р±РѕСЂР° РєР°РЅР°Р»Р° РёР· MobileSearch
  useEffect(() => {
    const handleSelectChannel = (e) => {
      const channel = e.detail;
      if (channel) {
        const existing = channels.find(c => (c.id || c._id) === (channel.id || channel._id));
        if (existing) {
          selectChannel(existing);
        } else {
          setChannels(prev => [...prev, channel]);
          selectChannel(channel);
        }
      }
    };
    window.addEventListener('selectChannel', handleSelectChannel);
    return () => window.removeEventListener('selectChannel', handleSelectChannel);
  }, [channels]);

  // Р—Р°РіСЂСѓР·РєР° РєР°РЅР°Р»РѕРІ Рё Р°РІС‚Рѕ-РІС‹Р±РѕСЂ РїРµСЂРІРѕРіРѕ
  useEffect(() => {
    loadChannels();
  }, []);

  useEffect(() => {
    if (channels.length > 0 && !activeChannel) {
      selectChannel(channels[0]);
    }
  }, [channels]);

  // РџРѕРґРїРёСЃРєР° РЅР° WebSocket
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
      console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РєР°РЅР°Р»РѕРІ:', err);
    }
  };

  const selectChannel = async (channel) => {
    setActiveChannel(channel);
    if (socket) socket.emit('joinChannel', channel._id || channel.id);
    await loadMessages(channel._id || channel.id);
    if (isMobile) setShowSidebar(false);
  };

  const loadMessages = async (channelId) => {
    if (!channelId) return;
    try {
      const res = await api.get(`/api/messages/${channelId}?limit=50`);
      setMessages(res.data.messages);
      scrollToBottom();
    } catch (err) {
      console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё СЃРѕРѕР±С‰РµРЅРёР№:', err);
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
      setMessages(prev => prev.map(m => (m.id === data.messageId || m._id === data.messageId) ? { ...m, deleted: 1, content: '[РЎРѕРѕР±С‰РµРЅРёРµ СѓРґР°Р»РµРЅРѕ]' } : m));
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
  const handleCallSignal = (data) => {
    // РџСЂРѕР±СЂР°СЃС‹РІР°РµС‚СЃСЏ РІ CallInterface С‡РµСЂРµР· activeCall
    console.log('Call signal received');
  };

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
      console.error('РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё:', err);
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
      console.error('РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ:', err);
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
      alert(err.response?.data?.error || 'РќРµРІРµСЂРЅС‹Р№ РєРѕРґ');
    }
  };

  const searchUsers = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/api/users/search?q=${query}`);
      setSearchResults(res.data.users);
    } catch (err) { console.error('РћС€РёР±РєР° РїРѕРёСЃРєР°:', err); }
  };

  const startDM = async (userId) => {
    try {
      const res = await api.post(`/api/channels/dm/${userId}`);
      const existing = channels.find(c => (c.id || c._id) === (res.data.channel.id || res.data.channel._id));
      if (!existing) setChannels(prev => [...prev, res.data.channel]);
      selectChannel(res.data.channel);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) { console.error('РћС€РёР±РєР° DM:', err); }
  };

  const verifyUser = async (userId) => {
    try {
      await api.post(`/api/auth/verify/user/${userId}`);
      alert('РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РІРµСЂРёС„РёС†РёСЂРѕРІР°РЅ! вњ…');
    } catch (err) { alert(err.response?.data?.error || 'РћС€РёР±РєР°'); }
  };

  const unverifyUser = async (userId) => {
    try {
      await api.delete(`/api/auth/verify/user/${userId}`);
      alert('Р’РµСЂРёС„РёРєР°С†РёСЏ СЃРЅСЏС‚Р°');
    } catch (err) { alert(err.response?.data?.error || 'РћС€РёР±РєР°'); }
  };

  const verifyChannel = async (channelId) => {
    try {
      await api.post(`/api/auth/verify/channel/${channelId}`);
      alert('РљР°РЅР°Р» РІРµСЂРёС„РёС†РёСЂРѕРІР°РЅ! вњ…');
    } catch (err) { alert(err.response?.data?.error || 'РћС€РёР±РєР°'); }
  };

  const startCall = (targetUserId, callType = 'voice') => {
    if (socket) {
      socket.emit('callUser', { targetUserId, callType });
      // РџРѕРєР°Р·С‹РІР°РµРј РёРЅС‚РµСЂС„РµР№СЃ СЃСЂР°Р·Сѓ
      setActiveCall({
        from: { id: user.id, username: user.username, display_name: user.display_name },
        targetUser: { id: targetUserId },
        callType,
        callId: `call_${Date.now()}`
      });
    }
  };

  const acceptCall = () => {
    if (socket && incomingCall) {
      socket.emit('callAccepted', { targetUserId: incomingCall.from.id, callType: incomingCall.callType });
      setActiveCall({
        ...incomingCall,
        targetUser: incomingCall.from,
        callId: `call_${Date.now()}`
      });
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
  const typingText = typingNames.length > 0 ? `${typingNames.join(', ')} РїРµС‡Р°С‚Р°РµС‚...` : '';

  const activeChId = getChannelId(activeChannel);

  // Р•СЃР»Рё Р°РєС‚РёРІРµРЅ Р·РІРѕРЅРѕРє вЂ” РїРѕРєР°Р·С‹РІР°РµРј CallInterface
  if (activeCall) {
    return <CallInterface callData={activeCall} onEnd={() => setActiveCall(null)} />;
  }

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className={`sidebar ${isMobile && !showSidebar ? 'hidden' : ''}`}>
        <div className="sidebar-header">
          <h2>рџ’¬ Stasya</h2>
          <div className="user-status-badge" onClick={() => setShowStatusMenu(!showStatusMenu)}>
            <span className={`status-dot ${user?.status || 'offline'}`}></span>
            <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {user?.username}
              {user?.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }}>вњ“</span> : null}
              {user?.is_ceo ? <span style={{ color: '#f39c12', fontSize: '10px', fontWeight: 700 }}>CEO</span> : null}
            </span>
            {showStatusMenu && (
              <div className="status-menu">
                <div className="status-menu-item" onClick={() => changeStatus('online')}><span className="status-dot online"></span> Р’ СЃРµС‚Рё</div>
                <div className="status-menu-item" onClick={() => changeStatus('idle')}><span className="status-dot idle"></span> РќРµ Р°РєС‚РёРІРµРЅ</div>
                <div className="status-menu-item" onClick={() => changeStatus('dnd')}><span className="status-dot dnd"></span> РќРµ Р±РµСЃРїРѕРєРѕРёС‚СЊ</div>
                <div className="status-menu-item" onClick={() => changeStatus('offline')}><span className="status-dot offline"></span> РќРµРІРёРґРёРјРєР°</div>
                <div className="status-menu-item" onClick={logout} style={{ borderTop: '1px solid var(--border)', color: 'var(--danger)' }}>рџљЄ Р’С‹Р№С‚Рё</div>
              </div>
            )}
          </div>
        </div>

        {/* РљРЅРѕРїРєР° РјРѕР±РёР»СЊРЅРѕРіРѕ РїРѕРёСЃРєР° */}
        {isMobile && (
          <div style={{ padding: '8px 16px' }}>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', padding: '10px', fontSize: '14px' }}
              onClick={() => navigate('/mobile-search')}
            >
              рџ”Ќ Р Р°СЃС€РёСЂРµРЅРЅС‹Р№ РїРѕРёСЃРє
            </button>
          </div>
        )}

        <div className="search-bar">
          <input type="text" placeholder="рџ”Ќ РџРѕРёСЃРє РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№..." value={searchQuery} onChange={e => searchUsers(e.target.value)} />
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
                      {u.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }}>вњ“</span> : null}
                      {u.is_ceo ? <span style={{ color: '#f39c12', fontSize: '10px', fontWeight: 700 }}>CEO</span> : null}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{u.username}</div>
                  </div>
                  {user?.is_ceo && !u.is_ceo && (
                    <button style={{ fontSize: '10px', padding: '2px 6px', background: u.verified ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); u.verified ? unverifyUser(getUserId(u)) : verifyUser(getUserId(u)); }}>
                      {u.verified ? 'вњ•' : 'вњ“'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '8px 16px', display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '8px' }} onClick={() => setShowCreateModal(true)}>+ РљР°РЅР°Р»</button>
          <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '8px' }} onClick={() => setShowInviteModal(true)}>рџ”— Р’РѕР№С‚Рё</button>
        </div>

        <div className="channel-list">
          {channels.map(channel => (
            <div key={getChannelId(channel)} className={`channel-item ${activeChId === getChannelId(channel) ? 'active' : ''}`} onClick={() => selectChannel(channel)}>
              <div className="channel-icon">
                {channel.type === 'dm' ? 'рџ‘¤' : channel.type === 'voice' ? 'рџ”Љ' : 'рџ’¬'}
              </div>
              <div className="channel-info">
                <div className="channel-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {channel.type === 'dm'
                    ? channel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user?.display_name || channel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.display_name || 'DM'
                    : `# ${channel.name}`}
                  {channel.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }}>вњ“</span> : null}
                </div>
                <div className="channel-preview">
                  {channel.lastMessage?.content?.substring(0, 40) || 'РќРµС‚ СЃРѕРѕР±С‰РµРЅРёР№'}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isMobile && (
                  <button className="icon-btn" onClick={() => setShowSidebar(true)} title="РљР°РЅР°Р»С‹">
                    в°
                  </button>
                )}
                <div className="chat-header-info">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {activeChannel.type === 'dm'
                      ? activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user?.display_name || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.display_name || 'DM'
                      : `# ${activeChannel.name}`}
                    {activeChannel.verified ? <span style={{ color: '#6C5CE7', fontSize: '14px' }} title="Р’РµСЂРёС„РёС†РёСЂРѕРІР°РЅ">вњ“</span> : null}
                    {user?.is_ceo && activeChannel.type !== 'dm' && (
                      <button style={{ fontSize: '10px', padding: '2px 6px', background: activeChannel.verified ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        onClick={() => activeChannel.verified ? 
                          api.delete(`/api/auth/verify/channel/${activeChId}`).then(() => setActiveChannel(prev => ({ ...prev, verified: 0 }))) :
                          api.post(`/api/auth/verify/channel/${activeChId}`).then(() => setActiveChannel(prev => ({ ...prev, verified: 1 })))
                        }>
                        {activeChannel.verified ? 'РЎРЅСЏС‚СЊ вњ“' : 'вњ“ Р’РµСЂРёС„.'}
                      </button>
                    )}
                  </h3>
                  <p>
                    {activeChannel.type === 'dm'
                      ? `@${activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user?.username || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.username || ''}`
                      : `${activeChannel.members?.length || 0} СѓС‡Р°СЃС‚РЅРёРєРѕРІ`}
                  </p>
                </div>
              </div>
              <div className="chat-header-actions">
                {activeChannel.type === 'dm' && (
                  <>
                    <button className="icon-btn" title="Р“РѕР»РѕСЃРѕРІРѕР№ Р·РІРѕРЅРѕРє" onClick={() => {
                      const targetId = getUserId(activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user)));
                      if (targetId) startCall(targetId, 'voice');
                    }}>рџ“ћ</button>
                    <button className="icon-btn" title="Р’РёРґРµРѕР·РІРѕРЅРѕРє" onClick={() => {
                      const targetId = getUserId(activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user))?.user || activeChannel.members?.find(m => getUserId(m.user || m) !== getUserId(user)));
                      if (targetId) startCall(targetId, 'video');
                    }}>рџ“№</button>
                  </>
                )}
                {isMobile && (
                  <button className="icon-btn" onClick={() => navigate('/mobile-search')} title="РџРѕРёСЃРє">
                    рџ”Ќ
                  </button>
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
                        {author.display_name || author.username || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№'}
                        {author.verified ? <span style={{ color: '#6C5CE7', fontSize: '12px' }} title="Р’РµСЂРёС„РёС†РёСЂРѕРІР°РЅ">вњ“</span> : null}
                        {author.is_ceo ? <span style={{ color: '#f39c12', fontSize: '10px', fontWeight: 700, background: 'rgba(243,156,18,0.15)', padding: '1px 4px', borderRadius: '3px' }}>CEO</span> : null}
                      </span>
                      {author.is_bot ? <span className="bot-badge">BOT</span> : null}
                      <span className="message-time">{formatTime(msg.created_at || msg.createdAt)}</span>
                      {msg.edited ? <span className="message-edited">(РёР·РјРµРЅРµРЅРѕ)</span> : null}
                      {user?.is_ceo && !author.is_ceo && !author.is_bot && (
                        <button style={{ fontSize: '9px', padding: '1px 4px', background: author.verified ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '4px' }}
                          onClick={() => author.verified ? unverifyUser(authorId) : verifyUser(authorId)}>
                          {author.verified ? 'вњ•' : 'вњ“'}
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
                  placeholder={`РќР°РїРёСЃР°С‚СЊ РІ ${activeChannel.type === 'dm' ? 'Р»РёС‡РЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ' : '#' + activeChannel.name}...`}
                  rows={1} />
                <button className="send-btn" onClick={sendMessage} disabled={!messageInput.trim()}>вћ¤</button>
              </div>
            </div>
          </>
        ) : (
          <div className="welcome-screen">
            <div className="icon">рџ’¬</div>
            <h2>Stasya Messenger</h2>
            <p>Р’С‹Р±РµСЂРёС‚Рµ РєР°РЅР°Р» РёР»Рё РЅР°С‡РЅРёС‚Рµ РґРёР°Р»РѕРі. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРѕРёСЃРє С‡С‚РѕР±С‹ РЅР°Р№С‚Рё РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.</p>
            {isMobile && (
              <button className="btn btn-primary" style={{ maxWidth: '250px' }} onClick={() => navigate('/mobile-search')}>
                рџ”Ќ РџРѕРёСЃРє РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ Рё РєР°РЅР°Р»РѕРІ
              </button>
            )}
          </div>
        )}
      </div>

      {/* Incoming Call */}
      {incomingCall && (
        <div className="call-notification">
          <h4>рџ“ћ Р’С…РѕРґСЏС‰РёР№ {incomingCall.callType === 'video' ? 'РІРёРґРµРѕ' : 'РіРѕР»РѕСЃРѕРІРѕР№'} Р·РІРѕРЅРѕРє</h4>
          <p>РћС‚: {incomingCall.from.display_name || incomingCall.from.username}</p>
          <div className="call-notification-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptCall}>РџСЂРёРЅСЏС‚СЊ</button>
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={rejectCall}>РћС‚РєР»РѕРЅРёС‚СЊ</button>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>РЎРѕР·РґР°С‚СЊ РєР°РЅР°Р»</h3>
            <form onSubmit={createChannel}>
              <div className="form-group"><label>РќР°Р·РІР°РЅРёРµ</label><input name="name" placeholder="РќР°Р·РІР°РЅРёРµ РєР°РЅР°Р»Р°" required autoFocus /></div>
              <div className="form-group"><label>РўРёРї</label>
                <select name="type" style={{ width: '100%', padding: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '15px' }}>
                  <option value="text">рџ’¬ РўРµРєСЃС‚РѕРІС‹Р№</option>
                  <option value="voice">рџ”Љ Р“РѕР»РѕСЃРѕРІРѕР№</option>
                  <option value="group">рџ‘Ґ Р“СЂСѓРїРїР°</option>
                </select>
              </div>
              <div className="form-group"><label>РћРїРёСЃР°РЅРёРµ</label><input name="description" placeholder="РћРїРёСЃР°РЅРёРµ РєР°РЅР°Р»Р°" /></div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>РћС‚РјРµРЅР°</button>
                <button type="submit" className="btn btn-primary">РЎРѕР·РґР°С‚СЊ</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>РџСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ РїРѕ РєРѕРґСѓ</h3>
            <div className="form-group"><label>РљРѕРґ РїСЂРёРіР»Р°С€РµРЅРёСЏ</label><input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Р’РІРµРґРёС‚Рµ РєРѕРґ..." autoFocus /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowInviteModal(false)}>РћС‚РјРµРЅР°</button>
              <button className="btn btn-primary" onClick={joinByInvite}>РџСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;

