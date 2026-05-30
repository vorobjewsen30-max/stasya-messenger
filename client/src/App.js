import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Login from './pages/Login';
import Register from './pages/Register';
import Chat from './pages/Chat';
import MobileSearch from './pages/MobileSearch';
import api from './services/api';

// Контексты
export const AuthContext = createContext(null);
export const SocketContext = createContext(null);

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);

  // Загрузка пользователя
  useEffect(() => {
    if (token) {
      api.get('/api/auth/me')
        .then(res => {
          setUser(res.data.user);
        })
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  // Подключение WebSocket
  useEffect(() => {
    if (user && token) {
      const newSocket = io(window.location.origin, {
        auth: { token },
        transports: ['websocket', 'polling']
      });

      newSocket.on('connect', () => {
        console.log('🔌 WebSocket подключён');
      });

      newSocket.on('connect_error', (err) => {
        console.error('Ошибка WebSocket:', err.message);
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    }
  }, [user, token]);

  const login = useCallback((newToken, userData) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    if (socket) {
      socket.close();
    }
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setSocket(null);
  }, [socket]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <h2>Stasya Messenger</h2>
        <p>Загрузка...</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      <SocketContext.Provider value={socket}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
            <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
            <Route path="/mobile-search" element={user ? <MobileSearch /> : <Navigate to="/login" />} />
            <Route path="/*" element={user ? <Chat /> : <Navigate to="/login" />} />
          </Routes>
        </BrowserRouter>
      </SocketContext.Provider>
    </AuthContext.Provider>
  );
}

export default App;
