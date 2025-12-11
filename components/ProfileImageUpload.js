import React, { useState, useRef, useEffect } from "react";
import { CameraIcon, CloseOutlineIcon } from "@vapor-ui/icons";
import { Button, Text, Callout, VStack, HStack } from "@vapor-ui/core";
import { useAuth } from "@/contexts/AuthContext";
import CustomAvatar from "@/components/CustomAvatar";
import { Toast } from "@/components/Toast";
import fileService from "@/services/fileService";
import authService from "@/services/authService";

const ProfileImageUpload = ({ currentImage, onImageChange }) => {
  const { user } = useAuth();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // 프로필 이미지 URL 생성
  const getProfileImageUrl = (imagePath) => {
    return fileService.getFileUrl(imagePath);
  };

  useEffect(() => {
    const imageUrl = getProfileImageUrl(currentImage);
    setPreviewUrl(imageUrl);
  }, [currentImage]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError("");

      // 미리보기 즉시 표시
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // 1. S3(CloudFront) 직접 업로드
      const uploadResponse = await fileService.uploadFile(file);

      if (!uploadResponse.success) {
        throw new Error(uploadResponse.message);
      }

      const s3Url = uploadResponse.data.url;

      // 2. 백엔드 프로필 업데이트
      // [Fix] 400 에러 방지를 위해 name 필드도 함께 전송 (백엔드 유효성 검사 대응)
      const updatedUser = await authService.updateProfile(
        {
          name: user.name,
          profileImage: s3Url,
        },
        user.token,
        user.sessionId
      );

      // 3. 로컬 상태 업데이트
      const newUserState = {
        ...user,
        ...updatedUser,
        profileImage: s3Url,
      };
      localStorage.setItem("user", JSON.stringify(newUserState));

      // 4. 완료 처리
      onImageChange(s3Url);
      Toast.success("프로필 이미지가 변경되었습니다.");
      window.dispatchEvent(new Event("userProfileUpdate"));
    } catch (error) {
      console.error("Image upload error:", error);
      setError(error.message || "이미지 업로드에 실패했습니다.");

      // 실패 시 원래 이미지로 복구
      setPreviewUrl(getProfileImageUrl(currentImage));
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = async () => {
    try {
      setUploading(true);
      setError("");

      // [Fix] 삭제 시에도 name 필드 포함
      const updatedUser = await authService.updateProfile(
        {
          name: user.name,
          profileImage: "",
        },
        user.token,
        user.sessionId
      );

      const newUserState = {
        ...user,
        ...updatedUser,
        profileImage: "",
      };
      localStorage.setItem("user", JSON.stringify(newUserState));

      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(null);
      onImageChange("");

      Toast.success("프로필 이미지가 삭제되었습니다.");
      window.dispatchEvent(new Event("userProfileUpdate"));
    } catch (error) {
      console.error("Image removal error:", error);
      setError(error.message || "이미지 삭제에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return (
    <VStack gap="$300" alignItems="center">
      <CustomAvatar
        user={user}
        size="xl"
        persistent={true}
        showInitials={true}
        data-testid="profile-image-avatar"
      />

      <HStack gap="$200" justifyContent="center">
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="profile-image-upload-button"
        >
          <CameraIcon />
          이미지 변경
        </Button>

        {previewUrl && (
          <Button
            type="button"
            variant="fill"
            colorPalette="danger"
            onClick={handleRemoveImage}
            disabled={uploading}
            data-testid="profile-image-delete-button"
          >
            <CloseOutlineIcon />
            이미지 삭제
          </Button>
        )}
      </HStack>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={handleFileSelect}
        data-testid="profile-image-file-input"
      />

      {error && (
        <Callout.Root colorPalette="danger" data-testid="upload-error">
          <HStack gap="$200" alignItems="center">
            <Text>{error}</Text>
          </HStack>
        </Callout.Root>
      )}

      {uploading && (
        <Text typography="body3" color="$hint-100">
          이미지 처리 중...
        </Text>
      )}
    </VStack>
  );
};

export default ProfileImageUpload;
