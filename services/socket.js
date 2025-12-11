import { io } from 'socket.io-client';

// 실제 socket.io 연결 상태 관리(실제 connect/disconnect/heartbeat/큐)
// useSocketHandling 훅에서는 상태 관리 및 UI 반영에 집중

const CLEANUP_REASONS = {
  DISCONNECT: 'disconnect',
  MANUAL: 'manual',
  RECONNECT: 'reconnect'
};

class SocketService {
  constructor() {
    this.socket = null;
    this.heartbeatInterval = null;
    this.messageHandlers = new Map();
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    // this.isReconnecting = false; // Socket.IO가 내부적으로 재연결 상태 관리
    this.connectionPromise = null;
    this.baseRetryDelay = 1000; // 1초 기본 지연
    this.maxRetryDelay = 10000; // 최대 10초
    this.reactionHandlers = new Set();
    this.connected = false;
    this.isConnecting = false; // 연결 시도 중 플래그
    this.lastConnectOptions = null; // 마지막 연결 옵션 저장
  }


  async ensureConnected(options = {}) {
    // 이미 연결되어 있으면 재사용
    if (this.socket?.connected) {
      return this.socket;
    }

    // 연결 시도 중이면 대기
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // 새 연결
    return this.connect(options);
  }


  /**
   * 지수 백오프 + 랜덤 지터로 재연결 분산
   */
  getRetryDelay(attempt) {
    const exponentialDelay = Math.min(
      this.baseRetryDelay * Math.pow(2, attempt),
      this.maxRetryDelay
    );
    // 0~20% 랜덤 지터 추가로 동시 재연결 방지
    const jitter = exponentialDelay * 0.2 * Math.random();
    return exponentialDelay + jitter;
  }

  /**
   * 단일 진입점 연결 관리
   * - 중복 호출 차단
   * - 연결 중이면 기존 Promise 반환
   * - forceNew 제거하여 소켓 재사용
   */
  async connect(options = {}) {
    
    // 연결 시도 중이면 기존 Promise 대기
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // 이미 연결됐다면 기존 소켓 반환
    if (this.socket?.connected) {
      return Promise.resolve(this.socket);
    }

    this.connectionPromise = this._createConnection(options)
      .finally(() => {
        this.connectionPromise = null;
        this.isConnecting = false;
      });
      
    return this.connectionPromise;
  }

  async _createConnection(options) {
    try {
      /*
      if (this.socket) {
        this.cleanup(CLEANUP_REASONS.RECONNECT);
      }
      */
      this.isConnecting = true;
      this.lastConnectOptions = options;

      // 기존 소켓이 있고 연결되지 않은 경우에만 정리
      if (this.socket && !this.socket.connected) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }
      
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

      this.socket = io(socketUrl, {
        ...options,
        transports: ['websocket', 'polling'],
        // socket.io 내장 재연결 설정 (단일 책임)
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.getRetryDelay(0),
        reconnectionDelayMax: this.maxRetryDelay,
        timeout: 20000,
        autoConnect: true
        // forceNew 제거 - 소켓 재사용으로 서버 부하 감소
      });
      /*
      this.socket = io(socketUrl, {
        ...options,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.retryDelay,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        forceNew: true
      });
      */

      return new Promise((resolve, reject) => {
        const connectionTimeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 30000);

        this.setupEventHandlers(resolve, reject, connectionTimeout);
        //this.setupEventHandlers(resolve, reject);
      });

    } catch (error) {
      this.isConnecting = false;
      this.connectionPromise = null;
      throw error;
    }
    /**
    catch (error) {
      this.connectionPromise = null;
      reject(error);
    }
    */
  }

  /**
   * 이벤트 핸들러 설정
   * ✅ connectionTimeout을 파라미터로 받도록 수정
   */
  setupEventHandlers(resolve, reject, connectionTimeout) {
    // ✅ connect 이벤트 개선 - 메시지 큐 처리 추가
    this.socket.on('connect', () => {
      this.connected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      // this.isReconnecting = false; // Socket.IO가 관리
      clearTimeout(connectionTimeout);
      this.startHeartbeat();

      // 메시지 큐 처리
      if (this.messageQueue.length > 0) {
        this.processMessageQueue();
      }

      resolve(this.socket);
    });

    // 연결 실패 (초기 연결만 reject)
    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.cleanup(CLEANUP_REASONS.DISCONNECT);
    });

    this.socket.on('connect_error', (error) => {
      console.log('Socket connection error:', error.message);

      // 세션 에러는 즉시 reject (재시도 불필요)
      if (error.message === 'Invalid session') {
        reject(error);
        return;
      }
      if (error.message === 'websocket error') {
        this.reconnectAttempts++;
      }
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        clearTimeout(connectionTimeout);
        reject(error);
      }
    });

    // duplicate_login 이벤트 수신
    // type: 'new_login_attempt' - 새로 로그인한 디바이스
    // type: 'existing_session' - 기존 세션이 있던 디바이스 (다른 곳에서 로그인함)
    this.socket.on('duplicate_login', (data) => {
      // TODO: 향후 중복 로그인 처리 필요 시 AuthContext에서 구현
    });

    // error 이벤트는 Socket.IO가 자동으로 처리
    /*
    this.socket.on('error', (error) => {
      this.handleSocketError(error);
    });
    */

    // ✅ reconnect 이벤트 개선 - 메시지 큐 처리 추가
    this.socket.on('reconnect', (attemptNumber) => {
      this.connected = true;
      this.reconnectAttempts = 0;
      // this.isReconnecting = false; // Socket.IO가 관리
      this.processMessageQueue();
    });

    this.socket.on('reconnect_failed', () => {
      this.cleanup(CLEANUP_REASONS.MANUAL);
      reject(new Error('Reconnection failed'));
    });

    this.socket.on('messageReaction', (data) => {
      this.reactionHandlers.forEach(handler => handler(data));
    });
  }

  cleanup(reason = CLEANUP_REASONS.MANUAL) {
    // if (reason === CLEANUP_REASONS.DISCONNECT && this.isReconnecting) {
    //   return;
    // }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (reason !== CLEANUP_REASONS.RECONNECT) {
      this.reactionHandlers.clear();
      this.messageQueue = [];
    }

    if (reason === CLEANUP_REASONS.MANUAL && this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    if (reason === CLEANUP_REASONS.MANUAL) {
      this.reconnectAttempts = 0;
      // this.isReconnecting = false; // Socket.IO가 관리
      this.connectionPromise = null;
      this.connected = false;
    }
  }

  disconnect() {
    this.cleanup(CLEANUP_REASONS.MANUAL);
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  handleConnectionError(error) {
    this.reconnectAttempts++;

    if (error.message.includes('auth')) {
      return;
    }

    if (error.message.includes('websocket error')) {
      if (this.socket) {
        this.socket.io.opts.transports = ['polling', 'websocket'];
      }
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.cleanup(CLEANUP_REASONS.MANUAL);
      // this.isReconnecting = false; // Socket.IO가 관리
    }
  }

  // handleSocketError - Socket.IO가 TransportError를 자동으로 처리하므로 불필요
  /*
  handleSocketError(error) {
    if (error.type === 'TransportError') {
      this.reconnect();
    }
  }
  */

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping', null, (error) => {
          if (error) {
            this.cleanup(CLEANUP_REASONS.MANUAL);
          }
        });
      } else {
        this.cleanup(CLEANUP_REASONS.MANUAL);
      }
    }, 25000);
  }

  getSocket() {
    return this.socket;
  }

  queueMessage(event, data) {
    const message = { event, data, timestamp: Date.now() };
    this.messageQueue.push(message);
  }

  processMessageQueue() {
    const now = Date.now();
    const validMessages = this.messageQueue.filter(msg => now - msg.timestamp < 300000);

    while (validMessages.length > 0) {
      const message = validMessages.shift();
      try {
        this.socket.emit(message.event, message.data);
      } catch (error) {
        // Silent error handling
      }
    }

    this.messageQueue = validMessages;
  }

  async emit(event, data) {
    try {
      if (!this.socket?.connected) {
        await this.connect();
      }
      
      return new Promise((resolve, reject) => {
        if (!this.socket?.connected) {
          reject(new Error('Socket is not connected'));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error('Socket event timeout'));
        }, 10000);

        this.socket.emit(event, data, (response) => {
          clearTimeout(timeout);
          if (response?.error) {
            reject(response.error);
          } else {
            resolve(response);
          }
        });
      });
    } catch (error) {
      this.queueMessage(event, data);
      throw error;
    }
  }

  on(event, callback) {
    if (!this.socket) {
      this.messageHandlers.set(event, callback);
      return;
    }

    this.socket.on(event, callback);
  }

  off(event, callback) {
    if (!this.socket) {
      this.messageHandlers.delete(event);
      return;
    }

    this.socket.off(event, callback);
  }

  // reconnect() - Socket.IO의 자동 재연결 기능을 사용하므로 수동 재연결 불필요
  /*
  async reconnect() {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    this.cleanup(CLEANUP_REASONS.RECONNECT);

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    try {
      await new Promise(resolve => setTimeout(resolve, this.getRetryDelay(this.reconnectAttempts)));
      await this.connect();
    } catch (error) {
      this.isReconnecting = false;
      throw error;
    }
  }
  */

  isConnected() {
    return this.connected && this.socket?.connected;
  }

  getConnectionQuality() {
    if (!this.socket?.connected) return 'disconnected';
    // if (this.isReconnecting) return 'reconnecting'; // Socket.IO가 관리
    if (this.socket.conn?.transport?.name === 'polling') return 'poor';
    return 'good';
  }

  // 리액션 관련 메서드들 - 기존 유지
  async addReaction(messageId, reaction, user) {
    try {
      if (!user) {
        throw new Error('Authentication required');
      }

      await this.emit('messageReaction', {
        messageId,
        reaction,
        add: true
      });
    } catch (error) {
      throw error;
    }
  }

  async removeReaction(messageId, reaction, user) {
    try {
      if (!user) {
        throw new Error('Authentication required');
      }

      await this.emit('messageReaction', {
        messageId,
        reaction,
        add: false
      });
    } catch (error) {
      throw error;
    }
  }

  async toggleReaction(messageId, reaction, user) {
    try {
      if (!user) {
        throw new Error('Authentication required');
      }

      await this.emit('messageReaction', {
        messageId,
        reaction,
        toggle: true
      });
    } catch (error) {
      throw error;
    }
  }

  onReactionUpdate(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.reactionHandlers.add(handler);
    return () => this.reactionHandlers.delete(handler);
  }
}

const socketService = new SocketService();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // Socket.IO가 자동으로 재연결을 시도하므로 수동 연결 불필요
    // if (!socketService.isConnected() && !socketService.isReconnecting) {
    //   socketService.connect();
    // }
  });

  window.addEventListener('offline', () => {
    socketService.disconnect();
  });
}

export default socketService;
