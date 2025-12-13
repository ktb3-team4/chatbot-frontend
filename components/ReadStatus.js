import React, { useMemo, useEffect, useState, useCallback } from "react";
import { ConfirmOutlineIcon } from "@vapor-ui/icons";
import { Text, HStack } from "@vapor-ui/core";

const ReadStatus = ({
  messageType = "text",
  participants = [],
  readers = [],
  className = "",
  socketRef = null,
  messageId = null,
  messageRef = null,
  currentUserId = null,
}) => {
  const [hasMarkedAsRead, setHasMarkedAsRead] = useState(false);

  const unreadParticipants = useMemo(() => {
    if (messageType === "system") return [];

    return participants.filter(
      (participant) =>
        !readers.some(
          (reader) =>
            // ID 비교를 문자열로 통일하여 안전하게 처리
            String(reader.userId) === String(participant._id) ||
            String(reader.userId) === String(participant.id)
        )
    );
  }, [participants, readers, messageType]);

  const unreadCount = useMemo(() => {
    if (messageType === "system") return 0;
    return unreadParticipants.length;
  }, [unreadParticipants.length, messageType]);

  const markMessageAsRead = useCallback(async () => {
    if (
      !messageId ||
      !currentUserId ||
      hasMarkedAsRead ||
      messageType === "system" ||
      !socketRef?.current
    ) {
      return;
    }

    try {
      socketRef.current.emit("markMessagesAsRead", {
        messageIds: [messageId],
      });
      setHasMarkedAsRead(true);
    } catch (error) {
      console.error("Error marking message as read:", error);
    }
  }, [messageId, currentUserId, hasMarkedAsRead, messageType, socketRef]);

  // [핵심 수정] 무거운 IntersectionObserver 대신 useEffect로 즉시 처리
  useEffect(() => {
    // 시스템 메시지거나 이미 읽음 처리된 상태면 스킵
    if (messageType === "system" || hasMarkedAsRead || !currentUserId) return;

    // 내가 이미 읽은 메시지인지 확인
    const isAlreadyRead = readers.some(
      (reader) => String(reader.userId) === String(currentUserId)
    );

    if (isAlreadyRead) {
      setHasMarkedAsRead(true);
      return;
    }

    markMessageAsRead();
  }, [messageType, hasMarkedAsRead, currentUserId, readers, markMessageAsRead]);

  // UI 렌더링 부분은 동일
  if (messageType === "system") return null;

  if (unreadCount === 0) {
    return (
      <HStack
        className={className}
        gap="$050"
        alignItems="center"
        role="status"
        aria-label="모두 읽음"
        data-testid="read-status-all-read"
      >
        <HStack alignItems="center">
          <ConfirmOutlineIcon size={12} className="text-v-success-100" />
          <ConfirmOutlineIcon
            size={12}
            className="-ml-1.5 text-v-success-100"
          />
        </HStack>
        <Text typography="subtitle2" className="text-v-hint-200">
          모두 읽음
        </Text>
      </HStack>
    );
  }

  return (
    <HStack
      className={className}
      gap="$050"
      alignItems="center"
      role="status"
      aria-label={`${unreadCount}명 안 읽음`}
      data-testid="read-status-unread"
    >
      <ConfirmOutlineIcon size={12} className="text-v-hint-200" />
      {unreadCount > 0 && (
        <Text typography="subtitle2" className="text-v-hint-200">
          {unreadCount}명 안 읽음
        </Text>
      )}
    </HStack>
  );
};

export default React.memo(ReadStatus);
