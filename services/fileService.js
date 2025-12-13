import axiosInstance from "./axios";
import { Toast } from "../components/Toast";

const S3_CONFIG = {
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  bucket: process.env.NEXT_PUBLIC_BUCKET,
};

const CLOUDFRONT_DOMAIN = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN;

class FileService {
  constructor() {
    this.bucket = S3_CONFIG.bucket;
    this.uploadLimit = 50 * 1024 * 1024; // 50MB

    this.allowedTypes = {
      image: {
        extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
        mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
        maxSize: 10 * 1024 * 1024,
        name: "이미지",
      },
      document: {
        extensions: [".pdf"],
        mimeTypes: ["application/pdf"],
        maxSize: 20 * 1024 * 1024,
        name: "PDF 문서",
      },
    };
  }

  // 파일 유효성 검사
  async validateFile(file) {
    if (!file) {
      const msg = "파일이 선택되지 않았습니다.";
      Toast.error(msg);
      return { success: false, message: msg };
    }

    if (file.size > this.uploadLimit) {
      const msg = `파일 크기는 ${this.formatFileSize(
        this.uploadLimit
      )}를 초과할 수 없습니다.`;
      Toast.error(msg);
      return { success: false, message: msg };
    }

    let isAllowedType = false;
    for (const config of Object.values(this.allowedTypes)) {
      if (config.mimeTypes.includes(file.type)) {
        isAllowedType = true;
        break;
      }
    }

    if (!isAllowedType) {
      const msg = "지원하지 않는 파일 형식입니다.";
      Toast.error(msg);
      return { success: false, message: msg };
    }

    return { success: true };
  }

  async uploadFile(file, onProgress) {
    const validationResult = await this.validateFile(file);
    if (!validationResult.success) {
      return validationResult;
    }

    try {
      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const key = `images/${timestamp}_${safeFileName}`;

      const region = S3_CONFIG.region;
      const bucket = this.bucket;
      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

      if (onProgress) onProgress(10);

      const response = await fetch(s3Url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!response.ok) {
        throw new Error(`S3 업로드 실패: ${response.status} ${response.statusText}`);
      }

      if (onProgress) onProgress(100);

      // CloudFront URL 생성
      const cloudFrontUrl = `https://${CLOUDFRONT_DOMAIN}/${key}`;

      try {
        await axiosInstance.post("/api/files/uploads", {
          filename: key,
          url: cloudFrontUrl,
          mimetype: file.type,
          dummy: true,
        });
      } catch (e) {
        console.warn("Test dummy request failed (Ignore if not testing):", e);
      }

      if (onProgress) onProgress(100);

      return {
        success: true,
        data: {
          filename: key,
          originalname: file.name,
          mimetype: file.type,
          size: file.size,
          url: cloudFrontUrl,
        },
      };
    } catch (error) {
      console.error("S3 Upload Error:", error);
      return {
        success: false,
        message: "파일 업로드 실패: " + error.message,
      };
    }
  }

  // URL 생성 헬퍼
  getFileUrl(filenameOrUrl) {
    if (!filenameOrUrl || typeof filenameOrUrl !== "string") return "";

    const normalized = filenameOrUrl.trim();

    // 절대 URL이면 그대로 사용
    if (/^https?:\/\//i.test(normalized)) return normalized;

    const hasLeadingSlash = normalized.startsWith("/");
    const cleanPath = normalized.replace(/^\/+/, "");

    // [수정됨] images 뿐만 아니라 profiles 경로도 CloudFront로 처리
    if (
      hasLeadingSlash &&
      (cleanPath.startsWith("images/") || cleanPath.startsWith("profiles/"))
    ) {
      return `https://${CLOUDFRONT_DOMAIN}/${cleanPath}`;
    }

    // 기존 API 상대 경로 호환
    if (hasLeadingSlash) {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      return `${apiBase}/${cleanPath}`;
    }

    // S3 Key인 경우 CloudFront URL로 변환
    const key = cleanPath.startsWith("images/")
      ? cleanPath
      : `images/${cleanPath}`;

    return `https://${CLOUDFRONT_DOMAIN}/${key}`;
  }

  // 미리보기 URL (인증 불필요)
  getPreviewUrl(file) {
    if (file?.url) return file.url;
    if (file?.filename) return this.getFileUrl(file.filename);
    return "";
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }
}

export default new FileService();
