import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext, SocketContext } from '../App';
import api from '../services/api';

function MobileSearch() {
  const { user } = useContext(AuthContext);
  const socket = useContext(SocketContext);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('users');
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('recentSearches') || '[]');
    } catch { return []; }
  });

  const search = useCallback(async (q) => {
    if (q.length < 2) {
      setUsers([]);
      setChannels([]);
      setMessages([]);
      return;
    }

    setLoading(true);
    try {
      const [usersRes, channelsRes, messagesRes] = await Promise.all([
        api.get(`/api/users/search?q=${encodeURIComponent(q)}`),
        api.get(`/api/channels/search?q=${encodeURIComponent(q)}`).catch(() => ({ data: { channels: [] } })),
        api.get(`/api/messages/search?q=${encodeURIComponent(q)}`).catch(() => ({ data: { messages: [] } }))
      ]);

      setUsers(usersRes.data.users || []);
      setChannels(channelsRes.data.channels || []);
      setMessages(messagesRes.data.messages || []);

      // Сохраняем в историю
      const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 10);
      setRecentSearches(updated);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
    } catch (err) {
      console.error('Ошибка поиска:', err);
    } finally {
      setLoading(false);
    }
  }, [recentSearches]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (query) search(query);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const startDM = async (userId) => {
    try {
      const res = await api.post(`/api/channels/dm/${userId}`);
      navigate('/');
      // Небольшая задержка чтобы Chat успел подгрузить канал
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('selectChannel', { detail: res.data.channel }));
      }, 200);
    } catch (err) {
      console.error('Ошибка DM:', err);
    }
  };

  const joinChannel = async (channelId) => {
    try {
      await api.post(`/api/channels/${channelId}/join`);
      navigate('/');
    } catch (err) {
      console.error('Ошибка входа в канал:', err);
    }
  };

  const goToMessage = (msg) => {
    navigate('/');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('selectChannel', { detail: { id: msg.channel_id, _id: msg.channel_id } }));
    }, 200);
  };

  const getUserId = (u) => u?.id || u?._id;
  const getChannelId = (c) => c?.id || c?._id;
  const getMsgId = (m) => m?.id || m?._id;

  return (
    <div className="mobile-search-page">
      {/* Header */}
      <div className="mobile-search-header">
        <button className="mobile-search-back" onClick={() => navigate('/')}>
          ← Назад
        </button>
        <h2>🔍 Поиск</h2>
      </div>

      {/* Search Input */}
      <div className="mobile-search-input-container">
        <input
          type="text"
          className="mobile-search-input"
          placeholder="Поиск пользователей, каналов, сообщений..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        {query && (
          <button className="mobile-search-clear" onClick={() => setQuery('')}>✕</button>
        )}
      </div>

      {/* Tabs */}
      {query.length >= 2 && (
        <div className="mobile-search-tabs">
          <button
            className={`mobile-search-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👤 Пользователи ({users.length})
          </button>
          <button
            className={`mobile-search-tab ${activeTab === 'channels' ? 'active' : ''}`}
            onClick={() => setActiveTab('channels')}
          >
            💬 Каналы ({channels.length})
          </button>
          <button
            className={`mobile-search-tab ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('messages')}
          >
            💭 Сообщения ({messages.length})
          </button>
        </div>
      )}

      {/* Results */}
      <div className="mobile-search-results">
        {loading && (
          <div className="mobile-search-loading">
            <div className="loading-spinner"></div>
            <p>Поиск...</p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div className="mobile-search-recent">
            <h3>Недавние поиски</h3>
            {recentSearches.length === 0 && (
              <p className="mobile-search-empty">Нет недавних поисков</p>
            )}
            {recentSearches.map((s, i) => (
              <div
                key={i}
                className="mobile-search-recent-item"
                onClick={() => setQuery(s)}
              >
                <span>🕐</span> {s}
              </div>
            ))}
          </div>
        )}

        {!loading && query.length >= 2 && activeTab === 'users' && (
          <div className="mobile-search-list">
            {users.length === 0 && (
              <p className="mobile-search-empty">Пользователи не найдены</p>
            )}
            {users.map(u => (
              <div
                key={getUserId(u)}
                className="mobile-search-item"
                onClick={() => startDM(getUserId(u))}
              >
                <div className="mobile-search-avatar">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" />
                  ) : (
                    (u.display_name?.[0] || u.username?.[0] || '?').toUpperCase()
                  )}
                </div>
                <div className="mobile-search-item-info">
                  <div className="mobile-search-item-name">
                    {u.display_name || u.username}
                    {u.verified ? <span className="verified-badge">✓</span> : null}
                    {u.is_ceo ? <span className="ceo-badge">CEO</span> : null}
                    {u.is_bot ? <span className="bot-badge-sm">BOT</span> : null}
                  </div>
                  <div className="mobile-search-item-sub">@{u.username}</div>
                  {u.bio && <div className="mobile-search-item-bio">{u.bio}</div>}
                </div>
                <div className="mobile-search-item-status">
                  <span className={`status-dot ${u.status || 'offline'}`}></span>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && query.length >= 2 && activeTab === 'channels' && (
          <div className="mobile-search-list">
            {channels.length === 0 && (
              <p className="mobile-search-empty">Каналы не найдены</p>
            )}
            {channels.map(c => (
              <div
                key={getChannelId(c)}
                className="mobile-search-item"
                onClick={() => joinChannel(getChannelId(c))}
              >
                <div className="mobile-search-avatar channel-avatar">
                  {c.type === 'voice' ? '🔊' : '💬'}
                </div>
                <div className="mobile-search-item-info">
                  <div className="mobile-search-item-name">
                    # {c.name}
                    {c.verified ? <span className="verified-badge">✓</span> : null}
                  </div>
                  <div className="mobile-search-item-sub">
                    {c.type === 'voice' ? 'Голосовой канал' : 'Текстовый канал'}
                    {c.members ? ` • ${c.members.length} участников` : ''}
                  </div>
                  {c.description && (
                    <div className="mobile-search-item-bio">{c.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && query.length >= 2 && activeTab === 'messages' && (
          <div className="mobile-search-list">
            {messages.length === 0 && (
              <p className="mobile-search-empty">Сообщения не найдены</p>
            )}
            {messages.map(msg => {
              const author = msg.author || {};
              return (
                <div
                  key={getMsgId(msg)}
                  className="mobile-search-item"
                  onClick={() => goToMessage(msg)}
                >
                  <div className="mobile-search-avatar">
                    {author.avatar ? (
                      <img src={author.avatar} alt="" />
                    ) : (
                      (author.display_name?.[0] || author.username?.[0] || '?').toUpperCase()
                    )}
                  </div>
                  <div className="mobile-search-item-info">
                    <div className="mobile-search-item-name">
                      {author.display_name || author.username || 'Неизвестный'}
                      <span className="mobile-search-time">
                        {new Date(msg.created_at || msg.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    <div className="mobile-search-item-sub">
                      {msg.content?.substring(0, 100)}
                      {msg.content?.length > 100 ? '...' : ''}
                    </div>
                    {msg.channel_name && (
                      <div className="mobile-search-item-channel">
                        в # {msg.channel_name}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileSearch;
