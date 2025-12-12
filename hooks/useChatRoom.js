import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import socketService from "../services/socket";
import { useAuth } from "../contexts/AuthContext";
import { useFileHandling } from "./useFileHandling";
import { useMessageHandling } from "./useMessageHandling";
import { useReactionHandling } from "./useReactionHandling";
import { useSocketHandling } from "./useSocketHandling";
import { useRoomHandling } from "./useRoomHandling";
import { Toast } from "../components/Toast";

const CLEANUP_REASONS = {
  DISCONNECT: "disconnect",
  MANUAL: "manual",
  RECONNECT: "reconnect",
  UNMOUNT: "unmount",
  ERROR: "error",
};

export const useChatRoom = () => {
  const MESSAGE_PAGE_SIZE = 30;
  const router = useRouter();
  const { user: authUser, logout } = useAuth();
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("checking");
  const [messageLoadError, setMessageLoadError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);

  // Refs
  const messageInputRef = useRef(null);
  const messageLoadAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const initializingRef = useRef(false);
  const setupCompleteRef = useRef(false);
  const socketInitializedRef = useRef(false);
  const cleanupInProgressRef = useRef(false);
  const cleanupCountRef = useRef(0);
  const userRooms = useRef(new Map());
  const previousMessagesRef = useRef(new Set());
  const messageProcessingRef = useRef(false);
  const initialLoadCompletedRef = useRef(false);
  const processedMessageIds = useRef(new Set());
  const loadMoreTimeoutRef = useRef(null);
  const chatCacheKey = useMemo(() => {
    return router.query.room ? `chat-room-cache:${router.query.room}` : null;
  }, [router.query.room]);

  // Socket handling setup
  const {
    connected,
    socketRef,
    handleConnectionError,
    handleReconnect,
    setConnected,
  } = useSocketHandling(router);

  // Message handling hook
  const {
    message,
    showEmojiPicker,
    showMentionList,
    mentionFilter,
    mentionIndex,
    filePreview,
    uploading,
    uploadProgress,
    uploadError,
    setMessage,
    setShowEmojiPicker,
    setShowMentionList,
    setMentionFilter,
    setMentionIndex,
    setFilePreview,
    handleMessageChange,
    handleMessageSubmit,
    handleLoadMore,
    handleEmojiToggle,
    getFilteredParticipants,
    insertMention,
    removeFilePreview,
  } = useMessageHandling(
    socketRef,
    currentUser,
    router,
    undefined,
    messages,
    loadingMessages,
    setLoadingMessages
  );

  // Cleanup 함수 수정
  const cleanup = useCallback(
    (reason = "MANUAL") => {
      if (!mountedRef.current || !router.query.room) return;
      try {
        if (cleanupInProgressRef.current) return;
        cleanupInProgressRef.current = true;

        if (router.query.room && socketRef.current?.connected) {
          socketRef.current.emit("leaveRoom", router.query.room);
        }

        if (socketRef.current && reason !== "RECONNECT") {
          socketRef.current.off("message");
          socketRef.current.off("previousMessages");
          socketRef.current.off("previousMessagesLoaded");
          socketRef.current.off("participantsUpdate");
          socketRef.current.off("messagesRead");
          socketRef.current.off("messageReactionUpdate");
          socketRef.current.off("session_ended");
          socketRef.current.off("error");
        }

        if (loadMoreTimeoutRef.current) {
          clearTimeout(loadMoreTimeoutRef.current);
          loadMoreTimeoutRef.current = null;
        }

        processedMessageIds.current.clear();
        previousMessagesRef.current.clear();
        messageProcessingRef.current = false;

        if (reason === "MANUAL" && mountedRef.current) {
          setError(null);
          setLoading(false);
          setLoadingMessages(false);
          setMessages([]);
          if (userRooms.current.size > 0) userRooms.current.clear();
        } else if (reason === "DISCONNECT" && mountedRef.current) {
          setError("채팅 연결이 끊어졌습니다. 재연결을 시도합니다.");
        }
      } catch (error) {
        if (mountedRef.current) setError("채팅방 정리 중 오류가 발생했습니다.");
      } finally {
        cleanupInProgressRef.current = false;
      }
    },
    [
      setMessages,
      setError,
      setLoading,
      setLoadingMessages,
      mountedRef,
      socketRef,
    ]
  );

  const getConnectionState = useCallback(() => {
    if (!socketRef.current) return "disconnected";
    if (loading) return "connecting";
    if (error) return "error";
    return socketRef.current.connected ? "connected" : "disconnected";
  }, [loading, error, socketRef]);

  const { handleReactionAdd, handleReactionRemove, handleReactionUpdate } =
    useReactionHandling(socketRef, currentUser, messages, setMessages);

  // 로컬 캐시 복원: 새로고침 시 이전 메시지/방 정보 즉시 표시
  useEffect(() => {
    if (typeof window === "undefined") return;
    processedMessageIds.current.clear();

    if (!chatCacheKey) {
      setCacheHydrated(false);
      return;
    }

    try {
      const cached = localStorage.getItem(chatCacheKey);
      if (!cached) {
        setCacheHydrated(false);
        return;
      }

      const parsed = JSON.parse(cached);
      if (parsed?.room) setRoom(parsed.room);
      if (Array.isArray(parsed?.messages)) {
        setMessages(parsed.messages);
        setHasMoreMessages(
          typeof parsed.hasMoreMessages === "boolean"
            ? parsed.hasMoreMessages
            : true
        );

        // 중복 메시지 방지를 위해 캐시된 메시지 ID를 기록
        processedMessageIds.current.clear();
        parsed.messages.forEach((msg) => {
          if (msg?._id) processedMessageIds.current.add(msg._id);
        });
      }

      setCacheHydrated(true);
    } catch (error) {
      console.warn("Failed to hydrate chat cache:", error);
      setCacheHydrated(false);
    }
  }, [chatCacheKey, setRoom, setMessages, setHasMoreMessages]);

  // 로컬 캐시에 현재 채팅 상태 저장
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!chatCacheKey) return;

    try {
      const payload = {
        room,
        messages,
        hasMoreMessages,
        savedAt: Date.now(),
      };
      localStorage.setItem(chatCacheKey, JSON.stringify(payload));
    } catch (error) {
      console.warn("Failed to persist chat cache:", error);
    }
  }, [chatCacheKey, room, messages, hasMoreMessages]);

  const processMessages = useCallback(
    (loadedMessages, hasMore, isInitialLoad = false) => {
      if (!Array.isArray(loadedMessages))
        throw new Error("Invalid messages format");

      setMessages((prev) => {
        const newMessages = loadedMessages.filter((msg) => {
          if (!msg._id) return false;
          if (processedMessageIds.current.has(msg._id)) return false;
          processedMessageIds.current.add(msg._id);
          return true;
        });

        const merged = isInitialLoad ? newMessages : [...prev, ...newMessages];
        const messageMap = new Map();
        for (const msg of merged) {
          if (msg?._id) messageMap.set(msg._id, msg);
        }

        return Array.from(messageMap.values()).sort((a, b) => {
          const timeA = new Date(a.timestamp || 0).getTime();
          const timeB = new Date(b.timestamp || 0).getTime();
          if (timeA === timeB) return a._id > b._id ? 1 : -1;
          return timeA - timeB;
        });
      });

      setHasMoreMessages(hasMore);
      if (isInitialLoad) initialLoadCompletedRef.current = true;
    },
    [setMessages, setHasMoreMessages]
  );

  // [중요 수정] setupEventListeners: 소켓 에러 처리 로직 개선
  const setupEventListeners = useCallback(() => {
    if (!socketRef.current || !mountedRef.current) return;

    socketRef.current.on("participantsUpdate", (participants) => {
      if (!mountedRef.current) return;
      setRoom((prev) => ({ ...prev, participants: participants || [] }));
    });

    socketRef.current.on(
      "messagesRead",
      ({ userId, messageIds, timestamp }) => {
        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((msg) => {
            if (messageIds.includes(msg._id)) {
              const alreadyRead = msg.readers?.some(
                (reader) => reader.userId === userId || reader._id === userId
              );
              if (!alreadyRead) {
                return {
                  ...msg,
                  readers: [
                    ...(msg.readers || []),
                    { userId, readAt: timestamp || new Date() },
                  ],
                };
              }
            }
            return msg;
          })
        );
      }
    );

    socketRef.current.on("message", (message) => {
      if (
        !message ||
        !mountedRef.current ||
        messageProcessingRef.current ||
        !message._id
      )
        return;
      if (processedMessageIds.current.has(message._id)) return;
      processedMessageIds.current.add(message._id);
      setMessages((prev) => {
        const isDuplicate = prev.some((msg) => msg._id === message._id);
        if (isDuplicate) return prev;
        return [...prev, message];
      });
    });

    const handlePreviousMessages = (response) => {
      if (!mountedRef.current || messageProcessingRef.current) return;
      try {
        messageProcessingRef.current = true;
        if (!response || typeof response !== "object")
          throw new Error("Invalid response format");
        const { messages: loadedMessages = [], hasMore } = response;
        const isInitialLoad = messages.length === 0;
        // hasMore가 명시되지 않은 경우 페이지 크기 미만이면 더 로드할 것이 없다고 판단
        const nextHasMore =
          typeof hasMore === "boolean"
            ? hasMore
            : loadedMessages.length >= MESSAGE_PAGE_SIZE;

        processMessages(loadedMessages, nextHasMore, isInitialLoad);
        setLoadingMessages(false);
      } catch (error) {
        setLoadingMessages(false);
        // 메시지 로딩 에러는 Toast로 처리하고 전역 에러는 설정하지 않음
        Toast.error("메시지를 불러오는 중 문제가 발생했습니다.");
        setHasMoreMessages(false);
      } finally {
        messageProcessingRef.current = false;
      }
    };

    socketRef.current.on("previousMessages", handlePreviousMessages);
    socketRef.current.on("previousMessagesLoaded", handlePreviousMessages);
    socketRef.current.on("messageReactionUpdate", (data) => {
      if (!mountedRef.current) return;
      handleReactionUpdate(data);
    });

    socketRef.current.on("session_ended", () => {
      if (!mountedRef.current) return;
      cleanup();
      logout();
      router.replace("/?error=session_expired");
    });

    // [중요] 에러 핸들링 수정
    socketRef.current.on("error", (error) => {
      if (!mountedRef.current) return;
      console.error("Socket error:", error);

      // 메시지 전송 관련 에러는 Toast로만 표시하고 화면을 덮지 않음
      if (
        ["MESSAGE_REJECTED", "MESSAGE_ERROR", "FILE_UPLOAD_ERROR"].includes(
          error?.code
        )
      ) {
        Toast.error(error.message || "메시지 전송 중 오류가 발생했습니다.");
        return;
      }

      // 그 외의 연결 관련 치명적 에러만 상태 업데이트
      setError(error.message || "채팅 연결에 문제가 발생했습니다.");
    });
  }, [
    processMessages,
    setHasMoreMessages,
    cleanup,
    handleReactionUpdate,
    setLoadingMessages,
    setError,
    logout,
  ]);

  // ... (useRoomHandling, useEffect 등 나머지 코드는 기존과 동일)
  const {
    setupRoom,
    joinRoom,
    loadInitialMessages,
    fetchRoomData,
    handleSessionError,
  } = useRoomHandling(
    socketRef,
    currentUser,
    mountedRef,
    router,
    setRoom,
    setError,
    setMessages,
    setHasMoreMessages,
    setLoadingMessages,
    setLoading,
    setupEventListeners,
    cleanup,
    loading,
    setIsInitialized,
    initializingRef,
    setupCompleteRef,
    userRooms.current,
    processMessages
  );

  useEffect(() => {
    if (!socketRef.current || !currentUser) return;
    const handleConnect = () => {
      if (!mountedRef.current) return;
      setConnectionStatus("connected");
      setConnected(true);
      if (
        router.query.room &&
        !setupCompleteRef.current &&
        !initializingRef.current &&
        !isInitialized
      ) {
        socketInitializedRef.current = true;
        setupRoom().catch(() => setError("채팅방 연결에 실패했습니다."));
      }
    };
    const handleDisconnect = () => {
      if (mountedRef.current) {
        setConnectionStatus("disconnected");
        socketInitializedRef.current = false;
        setupCompleteRef.current = false;
      }
    };
    const handleError = () => {
      if (mountedRef.current) {
        setConnectionStatus("error");
        setError("채팅 서버와의 연결이 끊어졌습니다.");
      }
    };
    const handleReconnecting = () => {
      if (mountedRef.current) setConnectionStatus("connecting");
    };
    const handleReconnectSuccess = () => {
      if (!mountedRef.current) return;
      setConnectionStatus("connected");
      setConnected(true);
      setError("");
      if (router.query.room)
        setupRoom().catch(() => setError("채팅방 재연결에 실패했습니다."));
    };

    socketRef.current.on("connect", handleConnect);
    socketRef.current.on("disconnect", handleDisconnect);
    socketRef.current.on("connect_error", handleError);
    socketRef.current.on("reconnecting", handleReconnecting);
    socketRef.current.on("reconnect", handleReconnectSuccess);
    setConnectionStatus(
      socketRef.current.connected ? "connected" : "disconnected"
    );

    return () => {
      if (socketRef.current) {
        socketRef.current.off("connect", handleConnect);
        socketRef.current.off("disconnect", handleDisconnect);
        socketRef.current.off("connect_error", handleError);
        socketRef.current.off("reconnecting", handleReconnecting);
        socketRef.current.off("reconnect", handleReconnectSuccess);
      }
    };
  }, [
    router.query.room,
    setupRoom,
    setConnected,
    currentUser,
    isInitialized,
    setError,
  ]);

  useEffect(() => {
    const initializeChat = async () => {
      if (initializingRef.current) return;
      if (!authUser) {
        router.replace("/?redirect=" + router.asPath);
        return;
      }
      if (!currentUser) setCurrentUser(authUser);
      if (!isInitialized && router.query.room) {
        try {
          initializingRef.current = true;
          await setupRoom();
        } catch (error) {
          setError("채팅방 초기화에 실패했습니다.");
        } finally {
          initializingRef.current = false;
        }
      }
    };
    mountedRef.current = true;
    if (router.query.room) initializeChat();
    const tokenCheckInterval = setInterval(() => {
      if (!mountedRef.current) return;
      if (!authUser) {
        clearInterval(tokenCheckInterval);
        router.replace("/?redirect=" + router.asPath);
      }
    }, 60000);
    return () => {
      mountedRef.current = false;
      clearInterval(tokenCheckInterval);
      if (loadMoreTimeoutRef.current) clearTimeout(loadMoreTimeoutRef.current);
      if (
        socketRef.current?.connected &&
        router.query.room &&
        !cleanupInProgressRef.current
      )
        cleanup(CLEANUP_REASONS.UNMOUNT);
    };
  }, [
    router.query.room,
    cleanup,
    setupRoom,
    isInitialized,
    setError,
    authUser,
  ]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (socketRef.current?.connected && router.query.room)
        socketRef.current.emit("leaveRoom", router.query.room);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [router.query.room]);

  const {
    fileInputRef,
    uploading: fileUploading,
    uploadProgress: fileUploadProgress,
    uploadError: fileUploadError,
    handleFileUpload,
    handleFileSelect,
    handleFileDrop,
    removeFilePreview: removeFile,
  } = useFileHandling(socketRef, currentUser, router);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleMessageSubmit(e);
      }
    },
    [handleMessageSubmit]
  );

  return {
    room,
    messages,
    error,
    loading,
    connected,
    currentUser,
    message,
    showEmojiPicker,
    showMentionList,
    mentionFilter,
    mentionIndex,
    filePreview,
    uploading,
    uploadProgress,
    uploadError,
    hasMoreMessages,
    loadingMessages,
    fileInputRef,
    messageInputRef,
    socketRef,
    handleMessageChange,
    handleMessageSubmit,
    handleEmojiToggle,
    handleKeyDown,
    handleConnectionError,
    handleReconnect,
    getFilteredParticipants,
    insertMention,
    removeFilePreview,
    handleReactionAdd,
    handleReactionRemove,
    handleLoadMore,
    cleanup,
    setMessage,
    setShowEmojiPicker,
    setShowMentionList,
    setMentionFilter,
    setMentionIndex,
    setError,
    connectionStatus: getConnectionState(),
    cacheHydrated,
    messageLoadError,
    retryMessageLoad: useCallback(() => {
      if (mountedRef.current) {
        messageLoadAttemptRef.current = 0;
        previousMessagesRef.current.clear();
        processedMessageIds.current.clear();
        initialLoadCompletedRef.current = false;
        loadInitialMessages(router.query.room);
      }
    }, [loadInitialMessages, router.query.room]),
  };
};

export default useChatRoom;
