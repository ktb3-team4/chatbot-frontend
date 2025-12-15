import { useState, useEffect, useRef, useCallback } from "react";
import { Toast } from "../components/Toast";
import fileService from "../services/fileService";

export const useFileHandling = (
  socketRef,
  currentUser,
  router,
  handleSessionError
) => {
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileUpload = useCallback(
    async (file, content = "") => {
      if (!socketRef.current || !currentUser) {
        Toast.error("채팅 서버와 연결이 끊어졌습니다.");
        return;
      }

      const roomId = router?.query?.room;
      if (!roomId) {
        Toast.error("채팅방 정보를 찾을 수 없습니다.");
        return;
      }

      try {
        setUploading(true);
        setUploadError(null);
        setUploadProgress(0);

        // [수정] S3 직접 업로드 (토큰 불필요)
        const uploadResponse = await fileService.uploadFile(file, (progress) =>
          setUploadProgress(progress)
        );

        if (!uploadResponse.success) {
          throw new Error(
            uploadResponse.message || "파일 업로드에 실패했습니다."
          );
        }

        // [수정] 소켓 전송 시 url 포함, _id 제거
        await socketRef.current.emit("chatMessage", {
          room: roomId,
          type: "file",
          content: content,
          fileData: {
            filename: uploadResponse.data.filename,
            originalname: uploadResponse.data.originalname,
            mimetype: uploadResponse.data.mimetype,
            size: uploadResponse.data.size,
            url: uploadResponse.data.url,
          },
        });

        setFilePreview(null);
        setUploading(false);
        setUploadProgress(0);
      } catch (error) {
        console.error("File upload error:", error);
        setUploadError(error.message || "파일 업로드에 실패했습니다.");
        Toast.error(error.message || "파일 업로드에 실패했습니다.");
      } finally {
        setUploading(false);
      }
    },
    [socketRef, currentUser, router]
  );

  const handleFileSelect = useCallback(async (file) => {
    try {
      const validationResult = await fileService.validateFile(file);
      if (!validationResult.success) {
        throw new Error(validationResult.message);
      }

      const preview = {
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        type: file.type,
        size: file.size,
      };

      setFilePreview(preview);
      setUploadError(null);
    } catch (error) {
      console.error("File selection error:", error);
      Toast.error(error.message);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, []);

  const handleFileDrop = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      try {
        await handleFileSelect(files[0]);
      } catch (error) {
        console.error("File drop error:", error);
      }
    },
    [handleFileSelect]
  );

  const removeFilePreview = useCallback(() => {
    if (filePreview?.url) {
      URL.revokeObjectURL(filePreview.url);
    }
    setFilePreview(null);
    setUploadError(null);
    setUploadProgress(0);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [filePreview]);

  const handlePaste = useCallback(
    async (e) => {
      const items = e.clipboardData?.items;
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
        await handleFileSelect(file);
        e.preventDefault();
      } catch (error) {
        console.error("File paste error:", error);
      }
    },
    [handleFileSelect]
  );

  useEffect(() => {
    return () => {
      if (filePreview?.url) {
        URL.revokeObjectURL(filePreview.url);
      }
    };
  }, [filePreview]);

  return {
    filePreview,
    uploading,
    uploadProgress,
    uploadError,
    fileInputRef,
    setFilePreview,
    setUploading,
    setUploadProgress,
    setUploadError,
    handleFileUpload,
    handleFileSelect,
    handleFileDrop,
    handlePaste,
    removeFilePreview,
  };
};

export default useFileHandling;
