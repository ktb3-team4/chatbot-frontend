import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import { LikeIcon, AttachFileOutlineIcon, SendIcon } from "@vapor-ui/icons";
import { IconButton, VStack, HStack, Box, Textarea } from "@vapor-ui/core";
import EmojiPicker from "./EmojiPicker";
import MentionDropdown from "./MentionDropdown";
import FilePreview from "./FilePreview";
import fileService from "@/services/fileService";

const ChatInput = forwardRef(
  (
    {
      message = "",
      onMessageChange = () => {},
      onSubmit = () => {},
      onEmojiToggle = () => {},
      onFileSelect = () => {},
      fileInputRef,
      disabled = false,
      uploading: externalUploading = false,
      showEmojiPicker = false,
      showMentionList = false,
      mentionFilter = "",
      mentionIndex = 0,
      getFilteredParticipants = () => [],
      setMessage = () => {},
      setShowEmojiPicker = () => {},
      setShowMentionList = () => {},
      setMentionFilter = () => {},
      setMentionIndex = () => {},
      room = null,
    },
    ref
  ) => {
    const emojiPickerRef = useRef(null);
    const emojiButtonRef = useRef(null);
    const dropZoneRef = useRef(null);
    const internalInputRef = useRef(null);
    const messageInputRef = ref || internalInputRef;
    const filesRef = useRef([]);
    const [files, setFiles] = useState([]);
    // [수정] 로컬 uploading 상태 제거 (props로 전달받은 externalUploading 사용)
    const [uploadError, setUploadError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    // ... (handleFileValidationAndPreview, handleFileRemove, handleFileDrop 로직 동일)
    const handleFileValidationAndPreview = useCallback(
      async (file) => {
        if (!file) return;

        try {
          await fileService.validateFile(file);

          const filePreview = {
            file,
            url: URL.createObjectURL(file),
            name: file.name,
            type: file.type,
            size: file.size,
          };

          setFiles((prev) => [...prev, filePreview]);
          filesRef.current = [...filesRef.current, filePreview];
          setUploadError(null);
          onFileSelect?.(file);
        } catch (error) {
          console.error("File validation error:", error);
          setUploadError(error.message);
        } finally {
          if (fileInputRef?.current) {
            fileInputRef.current.value = "";
          }
        }
      },
      [onFileSelect]
    );

    const handleFileRemove = useCallback((fileToRemove) => {
      setFiles((prev) =>
        prev.filter((file) => file.name !== fileToRemove.name)
      );
      filesRef.current = filesRef.current.filter(
        (file) => file.name !== fileToRemove.name
      );
      URL.revokeObjectURL(fileToRemove.url);
      setUploadError(null);
    }, []);

    const handleFileDrop = useCallback(
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        try {
          await handleFileValidationAndPreview(droppedFiles[0]);
        } catch (error) {
          console.error("File drop error:", error);
        }
      },
      [handleFileValidationAndPreview]
    );

    const handleSubmit = useCallback(
      async (e) => {
        e?.preventDefault();

        // [수정] await 및 성공 여부 확인 후 초기화
        if (files.length > 0) {
          try {
            const file = files[0];
            if (!file || !file.file) {
              throw new Error("파일이 선택되지 않았습니다.");
            }

            const success = await onSubmit({
              type: "file",
              content: message.trim(),
              fileData: file,
            });

            if (success) {
              setMessage("");
              setFiles([]);
            }
          } catch (error) {
            console.error("File submit error:", error);
            setUploadError(error.message);
          }
        } else if (message.trim()) {
          const success = await onSubmit({
            type: "text",
            content: message.trim(),
          });

          if (success) {
            setMessage("");
          }
        }
      },
      [files, message, onSubmit, setMessage]
    );

    // ... (useEffect, handleInputChange, handleMentionSelect, handleKeyDown 등 나머지 로직 동일)

    useEffect(() => {
      const handleClickOutside = (event) => {
        if (
          showEmojiPicker &&
          !emojiPickerRef.current?.contains(event.target) &&
          !emojiButtonRef.current?.contains(event.target)
        ) {
          setShowEmojiPicker(false);
        }
      };

      const handlePaste = async (event) => {
        if (!messageInputRef?.current?.contains(event.target)) return;

        const items = event.clipboardData?.items;
        if (!items) return;

        const fileItem = Array.from(items).find(
          (item) =>
            item.kind === "file" &&
            (item.type.startsWith("image/") ||
              item.type.startsWith("video/") ||
              item.type.startsWith("audio/") ||
              item.type === "application/pdf")
        );

        if (!fileItem) return;

        const file = fileItem.getAsFile();
        if (!file) return;

        try {
          await handleFileValidationAndPreview(file);
          event.preventDefault();
        } catch (error) {
          console.error("File paste error:", error);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("paste", handlePaste);

      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("paste", handlePaste);
      };
    }, [
      showEmojiPicker,
      setShowEmojiPicker,
      messageInputRef,
      handleFileValidationAndPreview,
    ]);

    useEffect(() => {
      filesRef.current = files;
    }, [files]);

    useEffect(() => {
      return () => {
        filesRef.current.forEach((file) => URL.revokeObjectURL(file.url));
      };
    }, []);

    const mentionPosition = useMemo(() => ({ top: -250, left: 0 }), []);

    const handleInputChange = useCallback(
      (e) => {
        const value = e.target.value;
        const cursorPosition = e.target.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf("@");

        onMessageChange(e);

        if (lastAtSymbol !== -1) {
          const textAfterAt = textBeforeCursor.slice(lastAtSymbol + 1);
          const hasSpaceAfterAt = textAfterAt.includes(" ");

          if (!hasSpaceAfterAt) {
            setMentionFilter(textAfterAt.toLowerCase());
            setShowMentionList(true);
            setMentionIndex(0);

            return;
          }
        }

        setShowMentionList(false);
      },
      [onMessageChange, setMentionFilter, setShowMentionList, setMentionIndex]
    );

    const handleMentionSelect = useCallback(
      (user) => {
        if (!messageInputRef?.current) return;

        const cursorPosition = messageInputRef.current.selectionStart;
        const textBeforeCursor = message.slice(0, cursorPosition);
        const textAfterCursor = message.slice(cursorPosition);
        const lastAtSymbol = textBeforeCursor.lastIndexOf("@");

        if (lastAtSymbol !== -1) {
          const newMessage =
            message.slice(0, lastAtSymbol) + `@${user.name} ` + textAfterCursor;

          setMessage(newMessage);
          setShowMentionList(false);

          setTimeout(() => {
            if (messageInputRef.current) {
              const newPosition = lastAtSymbol + user.name.length + 2;
              messageInputRef.current.focus();
              messageInputRef.current.setSelectionRange(
                newPosition,
                newPosition
              );
            }
          }, 0);
        }
      },
      [message, setMessage, setShowMentionList, messageInputRef]
    );

    const filteredParticipants = useMemo(
      () => getFilteredParticipants(room),
      [getFilteredParticipants, room, mentionFilter]
    );

    const handleKeyDown = useCallback(
      (e) => {
        if (showMentionList) {
          const participantsCount = filteredParticipants.length;

          switch (e.key) {
            case "ArrowDown":
              e.preventDefault();
              setMentionIndex((prev) =>
                prev < participantsCount - 1 ? prev + 1 : 0
              );
              break;

            case "ArrowUp":
              e.preventDefault();
              setMentionIndex((prev) =>
                prev > 0 ? prev - 1 : participantsCount - 1
              );
              break;

            case "Tab":
            case "Enter":
              e.preventDefault();
              if (participantsCount > 0) {
                handleMentionSelect(filteredParticipants[mentionIndex]);
              }
              break;

            case "Escape":
              e.preventDefault();
              setShowMentionList(false);
              break;

            default:
              return;
          }
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (message.trim() || files.length > 0) {
            handleSubmit(e);
          }
        } else if (e.key === "Escape" && showEmojiPicker) {
          setShowEmojiPicker(false);
        }
      },
      [
        message,
        files,
        showMentionList,
        showEmojiPicker,
        mentionIndex,
        filteredParticipants,
        handleMentionSelect,
        handleSubmit,
        setMentionIndex,
        setShowMentionList,
        setShowEmojiPicker,
        room,
      ]
    );

    const handleEmojiSelect = useCallback(
      (emoji) => {
        if (!messageInputRef?.current) return;

        const cursorPosition =
          messageInputRef.current.selectionStart || message.length;
        const newMessage =
          message.slice(0, cursorPosition) +
          emoji.native +
          message.slice(cursorPosition);

        setMessage(newMessage);
        setShowEmojiPicker(false);

        setTimeout(() => {
          if (messageInputRef.current) {
            const newCursorPosition = cursorPosition + emoji.native.length;
            messageInputRef.current.focus();
            messageInputRef.current.setSelectionRange(
              newCursorPosition,
              newCursorPosition
            );
          }
        }, 0);
      },
      [message, setMessage, setShowEmojiPicker, messageInputRef]
    );

    const toggleEmojiPicker = useCallback(() => {
      setShowEmojiPicker((prev) => !prev);
    }, [setShowEmojiPicker]);

    // [수정] externalUploading(props)만 사용
    const isDisabled = disabled || externalUploading;

    return (
      <>
        <Box
          ref={dropZoneRef}
          className="relative"
          padding="$200 $400"
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDrop={handleFileDrop}
        >
          {files.length > 0 && (
            <Box className="absolute bottom-full left-0 right-0 mb-2 z-1000">
              <FilePreview
                files={files}
                uploading={externalUploading} // [수정] externalUploading 전달
                uploadProgress={0} // 진행률은 별도 prop으로 받거나 단순 로딩 처리
                uploadError={uploadError}
                onRemove={handleFileRemove}
                onRetry={() => setUploadError(null)}
                showFileName={true}
                showFileSize={true}
                variant="default"
              />
            </Box>
          )}

          <VStack gap="$100" width="100%">
            <VStack gap="$025" className="relative">
              <HStack gap="$200">
                <Textarea
                  ref={messageInputRef}
                  value={message}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isDragging
                      ? "파일을 여기에 놓아주세요."
                      : "메시지를 입력하세요... (@를 입력하여 멘션, Shift + Enter로 줄바꿈)"
                  }
                  disabled={isDisabled}
                  rows={1}
                  autoComplete="off"
                  spellCheck="true"
                  size="xl"
                  autoResize={true}
                  data-testid="chat-message-input"
                />

                <IconButton
                  size="xl"
                  onClick={handleSubmit}
                  disabled={
                    isDisabled || (!message.trim() && files.length === 0)
                  }
                  aria-label="메시지 보내기"
                  data-testid="chat-send-button"
                >
                  <SendIcon />
                </IconButton>
              </HStack>

              <HStack gap="$100">
                <IconButton
                  ref={emojiButtonRef}
                  colorPalette="contrast"
                  variant="ghost"
                  size="md"
                  onClick={toggleEmojiPicker}
                  disabled={isDisabled}
                  aria-label="이모티콘"
                >
                  <LikeIcon />
                </IconButton>
                <IconButton
                  colorPalette="contrast"
                  variant="ghost"
                  size="md"
                  onClick={() => fileInputRef?.current?.click()}
                  disabled={isDisabled}
                  aria-label="파일 첨부"
                >
                  <AttachFileOutlineIcon />
                </IconButton>
              </HStack>

              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) =>
                  handleFileValidationAndPreview(e.target.files?.[0])
                }
                style={{ display: "none" }}
                accept="image/*,application/pdf"
                data-testid="file-upload-input"
              />

              {showEmojiPicker && (
                <Box
                  ref={emojiPickerRef}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full left-0 z-1000"
                >
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    emojiSize={20}
                    emojiButtonSize={36}
                    perLine={8}
                    maxFrequentRows={4}
                  />
                </Box>
              )}
            </VStack>
          </VStack>
        </Box>

        {showMentionList && (
          <Box
            className="fixed z-9999"
            style={{
              top: `${mentionPosition.top}px`,
              left: `${mentionPosition.left}px`,
            }}
          >
            <MentionDropdown
              participants={filteredParticipants}
              activeIndex={mentionIndex}
              onSelect={handleMentionSelect}
              onMouseEnter={(index) => setMentionIndex(index)}
            />
          </Box>
        )}
      </>
    );
  }
);

ChatInput.displayName = "ChatInput";

export default ChatInput;
